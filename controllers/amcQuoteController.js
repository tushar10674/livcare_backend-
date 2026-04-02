const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const AmcQuote = require('../models/AmcQuote');
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

const createAmcQuote = async (req, res, next) => {
  try {
    const normalizedPriority = normalizeSupportPriority(req.body.priority);
    const slaDeadline = computeSlaDeadline({ priority: normalizedPriority });

    const doc = await AmcQuote.create({
      ...req.body,
      status: 'new',
      priority: normalizedPriority,
      slaDeadline,
      slaDueAt: slaDeadline,
      activityTimeline: [
        createActivityEntry({
          type: 'created',
          status: 'new',
          message: 'AMC quote request submitted',
          meta: { source: 'public_form' },
        }),
      ],
    });

    await Promise.all([
      notifySupportEvent({
        moduleKey: 'amc_quote',
        eventKey: 'created',
        recordId: doc._id,
        email: doc.email,
        mobile: doc.mobile,
        subject: `AMC quote request received: ${doc.plan}`,
        body: `Hi ${doc.fullName}, your AMC quote request has been received.`,
      }),
      notifySupportEvent({
        moduleKey: 'amc_quote',
        eventKey: 'new_admin_alert',
        recordId: doc._id,
        email: SUPPORT_EMAIL,
        subject: `New AMC quote request: ${doc.organization}`,
        body: `${doc.fullName} requested an AMC quote for ${doc.organization}.`,
      }),
    ]);

    return sendSuccess(res, { statusCode: 201, message: 'AMC quote request submitted', data: doc });
  } catch (err) {
    return next(err);
  }
};

const listAmcQuotes = async (req, res, next) => {
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
        { fullName: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
        { mobile: new RegExp(q, 'i') },
        { organization: new RegExp(q, 'i') },
        { city: new RegExp(q, 'i') },
        { plan: new RegExp(q, 'i') },
      ];
    }

    const [items, total] = await Promise.all([
      AmcQuote.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      AmcQuote.countDocuments(filter),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

const updateAmcQuote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, assignedTo, priority } = req.body;

    const doc = await AmcQuote.findById(id);
    if (!doc) return next(new AppError('AMC quote not found', 404));

    if (typeof priority !== 'undefined') doc.priority = normalizeSupportPriority(priority);
    if (typeof assignedTo !== 'undefined') {
      applyAssignment({
        doc,
        assignedTo,
        actorUserId: req.auth?.userId,
        actorRole: req.auth?.role,
        message: 'AMC quote assigned',
      });
    }
    if (typeof status !== 'undefined') {
      applyStatusChange({
        doc,
        status,
        actorUserId: req.auth?.userId,
        actorRole: req.auth?.role,
        message: `AMC quote moved to ${normalizeSupportStatus(status)}`,
      });
    }

    syncSlaFields(doc);
    await doc.save();

    if (assignedTo) {
      const assignee = await resolveUserRecipient(assignedTo);
      await notifySupportEvent({
        moduleKey: 'amc_quote',
        eventKey: 'assigned',
        recordId: doc._id,
        email: assignee?.email,
        mobile: assignee?.mobile,
        subject: `AMC quote assigned: ${doc.organization}`,
        body: `AMC quote request from ${doc.fullName} has been assigned to you.`,
      });
    }

    await notifySupportEvent({
      moduleKey: 'amc_quote',
      eventKey: 'status_update',
      recordId: doc._id,
      email: doc.email,
      mobile: doc.mobile,
      subject: `AMC quote update: ${doc.organization}`,
      body: `Hi ${doc.fullName}, your AMC quote request is now ${doc.status}.`,
    });

    return sendSuccess(res, { message: 'AMC quote updated', data: doc });
  } catch (err) {
    return next(err);
  }
};

module.exports = { createAmcQuote, listAmcQuotes, updateAmcQuote };
