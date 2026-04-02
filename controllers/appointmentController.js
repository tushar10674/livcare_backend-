const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const Appointment = require('../models/Appointment');
const { notifySupportEvent, resolveUserRecipient } = require('../utils/supportNotifications');
const {
  normalizeSupportStatus,
  normalizeSupportPriority,
  computeSlaDeadline,
  createActivityEntry,
  appendActivity,
  syncSlaFields,
  applyStatusChange,
  applyAssignment,
} = require('../utils/supportWorkflow');

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL_TO || process.env.SMTP_FROM;

const createAppointment = async (req, res, next) => {
  try {
    const normalizedPriority = normalizeSupportPriority(req.body.priority);
    const slaDeadline = computeSlaDeadline({ priority: normalizedPriority });

    const appointment = await Appointment.create({
      ...req.body,
      status: 'new',
      priority: normalizedPriority,
      slaDeadline,
      slaDueAt: slaDeadline,
      activityTimeline: [
        createActivityEntry({
          type: 'created',
          status: 'new',
          message: 'Appointment created',
          meta: { source: 'public_form' },
        }),
      ],
    });

    await Promise.all([
      notifySupportEvent({
        moduleKey: 'appointment',
        eventKey: 'created',
        recordId: appointment._id,
        email: appointment.email,
        mobile: appointment.phone,
        subject: `Appointment request received: ${appointment.doctor}`,
        body: `Hi ${appointment.name}, your appointment request has been received.`,
      }),
      notifySupportEvent({
        moduleKey: 'appointment',
        eventKey: 'new_admin_alert',
        recordId: appointment._id,
        email: SUPPORT_EMAIL,
        subject: `New appointment request: ${appointment.name}`,
        body: `${appointment.name} requested an appointment with ${appointment.doctor}.`,
      }),
    ]);

    return sendSuccess(res, { statusCode: 201, message: 'Appointment created', data: appointment });
  } catch (err) {
    return next(err);
  }
};

const listAppointments = async (req, res, next) => {
  try {
    const { status, q, priority, assignedTo, overdue } = req.query;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const filter = {};
    if (status) filter.status = normalizeSupportStatus(status);
    if (priority) filter.priority = normalizeSupportPriority(priority);
    if (assignedTo) filter.assignedTo = assignedTo;
    if (String(overdue) === 'true') {
      filter.status = { $nin: ['resolved', 'closed'] };
      filter.slaDeadline = { $lt: new Date() };
      filter.firstResponseAt = { $exists: false };
    }
    if (q) {
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
        { phone: new RegExp(q, 'i') },
        { doctor: new RegExp(q, 'i') },
      ];
    }

    const [items, total] = await Promise.all([
      Appointment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Appointment.countDocuments(filter),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

const updateAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, assignedTo, priority } = req.body;

    const appointment = await Appointment.findById(id);
    if (!appointment) return next(new AppError('Appointment not found', 404));

    if (typeof priority !== 'undefined') appointment.priority = normalizeSupportPriority(priority);
    if (typeof assignedTo !== 'undefined') {
      applyAssignment({
        doc: appointment,
        assignedTo,
        actorUserId: req.auth?.userId,
        actorRole: req.auth?.role,
        message: 'Appointment assigned',
      });
    }
    if (typeof status !== 'undefined') {
      applyStatusChange({
        doc: appointment,
        status,
        actorUserId: req.auth?.userId,
        actorRole: req.auth?.role,
        message: `Appointment moved to ${normalizeSupportStatus(status)}`,
      });
    }

    if (req.body.date || req.body.time) {
      if (req.body.date) appointment.date = req.body.date;
      if (req.body.time) appointment.time = req.body.time;
      appendActivity(
        appointment,
        createActivityEntry({
          type: 'rescheduled',
          actorUserId: req.auth?.userId,
          actorRole: req.auth?.role,
          status: appointment.status,
          message: 'Appointment schedule updated',
          meta: { date: appointment.date, time: appointment.time },
        }),
      );
    }

    syncSlaFields(appointment);
    await appointment.save();

    if (assignedTo) {
      const assignee = await resolveUserRecipient(assignedTo);
      await notifySupportEvent({
        moduleKey: 'appointment',
        eventKey: 'assigned',
        recordId: appointment._id,
        email: assignee?.email,
        mobile: assignee?.mobile,
        subject: `Appointment assigned: ${appointment.name}`,
        body: `Appointment request from ${appointment.name} has been assigned to you.`,
      });
    }

    await notifySupportEvent({
      moduleKey: 'appointment',
      eventKey: 'status_update',
      recordId: appointment._id,
      email: appointment.email,
      mobile: appointment.phone,
      subject: `Appointment update: ${appointment.doctor}`,
      body: `Hi ${appointment.name}, your appointment request is now ${appointment.status}.`,
    });

    return sendSuccess(res, { message: 'Appointment updated', data: appointment });
  } catch (err) {
    return next(err);
  }
};

module.exports = { createAppointment, listAppointments, updateAppointment };
