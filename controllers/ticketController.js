const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const Ticket = require('../models/Ticket');
const TicketComment = require('../models/TicketComment');
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

const createTicket = async (req, res, next) => {
  try {
    const { subject, message, category, priority } = req.body;
    const normalizedPriority = normalizeSupportPriority(priority);
    const slaDeadline = computeSlaDeadline({ priority: normalizedPriority });

    const ticket = await Ticket.create({
      userId: req.auth.userId,
      subject,
      message,
      category,
      priority: normalizedPriority,
      status: 'new',
      slaDeadline,
      slaDueAt: slaDeadline,
      activityTimeline: [
        createActivityEntry({
          type: 'created',
          status: 'new',
          actorUserId: req.auth.userId,
          actorRole: req.auth.role,
          message: 'Ticket created',
        }),
      ],
    });

    const userRecipient = await resolveUserRecipient(req.auth.userId);
    await Promise.all([
      notifySupportEvent({
        moduleKey: 'ticket',
        eventKey: 'created',
        recordId: ticket._id,
        email: userRecipient?.email,
        mobile: userRecipient?.mobile,
        subject: `Ticket created: ${subject}`,
        body: `Your support ticket "${subject}" has been created.`,
      }),
      notifySupportEvent({
        moduleKey: 'ticket',
        eventKey: 'new_admin_alert',
        recordId: ticket._id,
        email: SUPPORT_EMAIL,
        subject: `New ticket: ${subject}`,
        body: `A new ${category || 'support'} ticket has been created.`,
      }),
    ]);

    return sendSuccess(res, { statusCode: 201, message: 'Ticket created', data: ticket });
  } catch (err) {
    return next(err);
  }
};

const listMyTickets = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Ticket.find({ userId: req.auth.userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Ticket.countDocuments({ userId: req.auth.userId }),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

const getMyTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const ticket = await Ticket.findOne({ _id: id, userId: req.auth.userId });
    if (!ticket) return next(new AppError('Ticket not found', 404));
    return sendSuccess(res, { data: ticket });
  } catch (err) {
    return next(err);
  }
};

const adminListTickets = async (req, res, next) => {
  try {
    const { status, category, priority, assignedTo, overdue, q } = req.query;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const filter = {};
    if (status) filter.status = normalizeSupportStatus(status);
    if (category) filter.category = category;
    if (priority) filter.priority = normalizeSupportPriority(priority);
    if (assignedTo) filter.assignedTo = assignedTo;

    if (String(overdue) === 'true') {
      filter.status = { $nin: ['resolved', 'closed'] };
      filter.slaDeadline = { $lt: new Date() };
      filter.firstResponseAt = { $exists: false };
    }

    if (q) {
      filter.$or = [
        { subject: new RegExp(q, 'i') },
        { message: new RegExp(q, 'i') },
      ];
    }

    const [items, total] = await Promise.all([
      Ticket.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Ticket.countDocuments(filter),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

const adminUpdateTicketStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const ticket = await Ticket.findById(id);
    if (!ticket) return next(new AppError('Ticket not found', 404));

    applyStatusChange({
      doc: ticket,
      status,
      actorUserId: req.auth?.userId,
      actorRole: req.auth?.role,
      message: `Ticket moved to ${normalizeSupportStatus(status)}`,
    });
    syncSlaFields(ticket);
    await ticket.save();

    const owner = await resolveUserRecipient(ticket.userId);
    await notifySupportEvent({
      moduleKey: 'ticket',
      eventKey: 'status_update',
      recordId: ticket._id,
      email: owner?.email,
      mobile: owner?.mobile,
      subject: `Ticket update: ${ticket.subject}`,
      body: `Your ticket "${ticket.subject}" is now ${ticket.status}.`,
    });

    return sendSuccess(res, { message: 'Ticket updated', data: ticket });
  } catch (err) {
    return next(err);
  }
};

const adminAssignTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assignedTo } = req.body;

    const ticket = await Ticket.findById(id);
    if (!ticket) return next(new AppError('Ticket not found', 404));

    applyAssignment({
      doc: ticket,
      assignedTo,
      actorUserId: req.auth?.userId,
      actorRole: req.auth?.role,
      message: 'Ticket assigned',
    });
    syncSlaFields(ticket);
    await ticket.save();

    const assignee = await resolveUserRecipient(assignedTo);
    await notifySupportEvent({
      moduleKey: 'ticket',
      eventKey: 'assigned',
      recordId: ticket._id,
      email: assignee?.email,
      mobile: assignee?.mobile,
      subject: `Ticket assigned: ${ticket.subject}`,
      body: `Ticket "${ticket.subject}" has been assigned to you.`,
    });

    return sendSuccess(res, { message: 'Ticket assigned', data: ticket });
  } catch (err) {
    return next(err);
  }
};

const adminDeleteTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const ticket = await Ticket.findById(id);
    if (!ticket) return next(new AppError('Ticket not found', 404));

    await Promise.all([
      TicketComment.deleteMany({ ticketId: ticket._id }),
      Ticket.deleteOne({ _id: ticket._id }),
    ]);

    return sendSuccess(res, { message: 'Ticket deleted' });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createTicket,
  listMyTickets,
  getMyTicket,
  adminListTickets,
  adminUpdateTicketStatus,
  adminAssignTicket,
  adminDeleteTicket,
};
