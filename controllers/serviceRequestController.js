const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const ServiceRequest = require('../models/ServiceRequest');
const Product = require('../models/Product');
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

const createServiceRequest = async (req, res, next) => {
  try {
    const { productId, priority } = req.body;

    const authenticatedUserId = req.auth?.userId ? String(req.auth.userId) : '';
    const contact = req.body?.contact && typeof req.body.contact === 'object' ? req.body.contact : null;

    if (!authenticatedUserId) {
      const fullName = String(contact?.fullName || '').trim();
      const email = String(contact?.email || '').trim();
      const mobile = String(contact?.mobile || '').trim();
      if (!fullName || !email || !mobile) {
        return next(new AppError('Contact details are required', 400));
      }
    }

    let productSnapshot;
    if (productId) {
      const p = await Product.findById(productId);
      if (!p) return next(new AppError('Invalid productId', 400));
      productSnapshot = {
        name: p.name,
        sku: p.sku,
        brand: p.brand,
        category: p.category,
      };
    }

    const normalizedPriority = normalizeSupportPriority(priority);
    const slaDeadline = computeSlaDeadline({ priority: normalizedPriority });

    const doc = await ServiceRequest.create({
      ...req.body,
      userId: authenticatedUserId || undefined,
      productSnapshot,
      status: 'new',
      priority: normalizedPriority,
      slaDeadline,
      slaDueAt: slaDeadline,
      activityTimeline: [
        createActivityEntry({
          type: 'created',
          actorUserId: authenticatedUserId || undefined,
          actorRole: req.auth?.role,
          status: 'new',
          message: 'Service request created',
          meta: authenticatedUserId
            ? undefined
            : {
                contact: {
                  fullName: String(contact?.fullName || '').trim(),
                  email: String(contact?.email || '').trim(),
                  mobile: String(contact?.mobile || '').trim(),
                },
              },
        }),
      ],
    });

    const owner = authenticatedUserId ? await resolveUserRecipient(authenticatedUserId) : null;
    await notifySupportEvent({
      moduleKey: 'service_request',
      eventKey: 'created',
      recordId: doc._id,
      email: owner?.email || String(contact?.email || '').trim() || undefined,
      mobile: owner?.mobile || String(contact?.mobile || '').trim() || undefined,
      subject: `Service request created: ${doc.type}`,
      body: `Your ${doc.type} request has been submitted successfully.`,
    });

    return sendSuccess(res, { statusCode: 201, message: 'Service request created', data: doc });
  } catch (err) {
    return next(err);
  }
};

const listMyServiceRequests = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      ServiceRequest.find({ userId: req.auth.userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
      ServiceRequest.countDocuments({ userId: req.auth.userId }),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

const adminListServiceRequests = async (req, res, next) => {
  try {
    const { status, type, assignedTo, priority, overdue, q } = req.query;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const filter = {};
    if (status) filter.status = normalizeSupportStatus(status);
    if (type) filter.type = type;
    if (priority) filter.priority = normalizeSupportPriority(priority);
    if (assignedTo) filter.assignedTo = assignedTo;
    if (String(overdue) === 'true') {
      filter.status = { $nin: ['resolved', 'closed'] };
      filter.slaDeadline = { $lt: new Date() };
      filter.firstResponseAt = { $exists: false };
    }
    if (q) {
      filter.$or = [
        { type: new RegExp(q, 'i') },
        { 'productSnapshot.name': new RegExp(q, 'i') },
        { notes: new RegExp(q, 'i') },
        { 'address.city': new RegExp(q, 'i') },
      ];
    }

    const [items, total] = await Promise.all([
      ServiceRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      ServiceRequest.countDocuments(filter),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

const adminUpdateServiceRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, scheduledAt, assignedTo, priority } = req.body;

    const doc = await ServiceRequest.findById(id);
    if (!doc) return next(new AppError('Service request not found', 404));

    if (typeof priority !== 'undefined') doc.priority = normalizeSupportPriority(priority);
    if (typeof status !== 'undefined') {
      applyStatusChange({
        doc,
        status,
        actorUserId: req.auth?.userId,
        actorRole: req.auth?.role,
        message: `Service request moved to ${normalizeSupportStatus(status)}`,
      });
    }
    if (typeof assignedTo !== 'undefined') {
      applyAssignment({
        doc,
        assignedTo,
        actorUserId: req.auth?.userId,
        actorRole: req.auth?.role,
        message: 'Service request assigned',
      });
    }
    if (typeof scheduledAt !== 'undefined') {
      doc.scheduledAt = scheduledAt ? new Date(scheduledAt) : undefined;
      appendActivity(
        doc,
        createActivityEntry({
          type: 'scheduled',
          actorUserId: req.auth?.userId,
          actorRole: req.auth?.role,
          status: doc.status,
          message: scheduledAt ? 'Service visit scheduled' : 'Service visit schedule cleared',
          meta: { scheduledAt: doc.scheduledAt },
        }),
      );
    }

    if (['resolved', 'closed'].includes(doc.status)) doc.completedAt = doc.completedAt || new Date();

    syncSlaFields(doc);
    await doc.save();

    const owner = await resolveUserRecipient(doc.userId);
    await notifySupportEvent({
      moduleKey: 'service_request',
      eventKey: 'status_update',
      recordId: doc._id,
      email: owner?.email,
      mobile: owner?.mobile,
      subject: `Service request update: ${doc.type}`,
      body: `Your service request is now ${doc.status}.`,
    });

    return sendSuccess(res, { message: 'Service request updated', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminDeleteServiceRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await ServiceRequest.findById(id);
    if (!doc) return next(new AppError('Service request not found', 404));

    await ServiceRequest.deleteOne({ _id: doc._id });
    return sendSuccess(res, { message: 'Service request deleted' });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createServiceRequest,
  listMyServiceRequests,
  adminListServiceRequests,
  adminUpdateServiceRequest,
  adminDeleteServiceRequest,
};
