const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const ContactMessage = require('../models/ContactMessage');
const { notifySupportEvent, resolveUserRecipient } = require('../utils/supportNotifications');
const {
  normalizeSupportStatus,
  normalizeSupportPriority,
  computeSlaDeadline,
  createActivityEntry,
  syncSlaFields,
  applyStatusChange,
  applyAssignment,
} = require('../utils/supportWorkflow');

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL_TO || process.env.SMTP_FROM;

const createContact = async (req, res, next) => {
  try {
    const normalizedPriority = normalizeSupportPriority(req.body.priority);
    const slaDeadline = computeSlaDeadline({ priority: normalizedPriority });

    const doc = await ContactMessage.create({
      ...req.body,
      status: 'new',
      priority: normalizedPriority,
      slaDeadline,
      slaDueAt: slaDeadline,
      activityTimeline: [
        createActivityEntry({
          type: 'created',
          status: 'new',
          message: 'Contact message submitted',
          meta: { source: 'contact_form' },
        }),
      ],
    });

    await Promise.all([
      notifySupportEvent({
        moduleKey: 'contact',
        eventKey: 'created',
        recordId: doc._id,
        email: doc.email,
        mobile: doc.phone,
        subject: `Message received: ${doc.subject || 'Support request'}`,
        body: `Hi ${doc.name}, we have received your message and will reply soon.`,
      }),
      notifySupportEvent({
        moduleKey: 'contact',
        eventKey: 'new_admin_alert',
        recordId: doc._id,
        email: SUPPORT_EMAIL,
        subject: `New contact message: ${doc.subject || doc.name}`,
        body: `${doc.name} submitted a contact message.`,
      }),
    ]);

    return sendSuccess(res, { statusCode: 201, message: 'Message received', data: doc });
  } catch (err) {
    return next(err);
  }
};

const listContacts = async (req, res, next) => {
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
        { subject: new RegExp(q, 'i') },
        { message: new RegExp(q, 'i') },
      ];
    }

    const [items, total] = await Promise.all([
      ContactMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      ContactMessage.countDocuments(filter),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

const updateContact = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, assignedTo, priority } = req.body;

    const doc = await ContactMessage.findById(id);
    if (!doc) return next(new AppError('Contact message not found', 404));

    if (typeof priority !== 'undefined') doc.priority = normalizeSupportPriority(priority);
    if (typeof assignedTo !== 'undefined') {
      applyAssignment({
        doc,
        assignedTo,
        actorUserId: req.auth?.userId,
        actorRole: req.auth?.role,
        message: 'Contact message assigned',
      });
    }
    if (typeof status !== 'undefined') {
      applyStatusChange({
        doc,
        status,
        actorUserId: req.auth?.userId,
        actorRole: req.auth?.role,
        message: `Contact message moved to ${normalizeSupportStatus(status)}`,
      });
    }

    syncSlaFields(doc);
    await doc.save();

    if (['resolved', 'closed'].includes(doc.status)) {
      await notifySupportEvent({
        moduleKey: 'contact',
        eventKey: 'status_update',
        recordId: doc._id,
        email: doc.email,
        mobile: doc.phone,
        subject: `Support update: ${doc.subject || 'Contact message'}`,
        body: `Hi ${doc.name}, your message is now ${doc.status}.`,
      });
    }

    if (assignedTo) {
      const assignee = await resolveUserRecipient(assignedTo);
      await notifySupportEvent({
        moduleKey: 'contact',
        eventKey: 'assigned',
        recordId: doc._id,
        email: assignee?.email,
        mobile: assignee?.mobile,
        subject: `Contact message assigned: ${doc.subject || doc.name}`,
        body: `A contact message from ${doc.name} has been assigned to you.`,
      });
    }

    return sendSuccess(res, { message: 'Contact message updated', data: doc });
  } catch (err) {
    return next(err);
  }
};

module.exports = { createContact, listContacts, updateContact };
