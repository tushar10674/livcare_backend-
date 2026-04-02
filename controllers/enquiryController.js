const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const Enquiry = require('../models/Enquiry');
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

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL_TO || process.env.SMTP_FROM;

const createEnquiry = async (req, res, next) => {
  try {
    const { productId, fullName, email, mobile, organization, city, qty, requirements, priority } = req.body;

    let productSnapshot;
    if (productId) {
      const product = await Product.findById(productId);
      if (!product) return next(new AppError('Invalid productId', 400));
      productSnapshot = {
        name: product.name,
        sku: product.sku,
        brand: product.brand,
        category: product.category,
        mode: product.mode,
      };
    }

    const normalizedPriority = normalizeSupportPriority(priority);
    const slaDeadline = computeSlaDeadline({ priority: normalizedPriority });

    const enquiry = await Enquiry.create({
      productId: productId || undefined,
      productSnapshot,
      fullName,
      email,
      mobile,
      organization,
      city,
      qty,
      requirements,
      status: 'new',
      priority: normalizedPriority,
      slaDeadline,
      slaDueAt: slaDeadline,
      activityTimeline: [
        createActivityEntry({
          type: 'created',
          status: 'new',
          message: 'Enquiry created',
          meta: { source: 'public_form' },
        }),
      ],
    });

    await Promise.all([
      notifySupportEvent({
        moduleKey: 'enquiry',
        eventKey: 'created',
        recordId: enquiry._id,
        email,
        mobile,
        subject: `Enquiry received: ${fullName}`,
        body: `Hi ${fullName}, your enquiry has been received. Our team will respond shortly.`,
      }),
      notifySupportEvent({
        moduleKey: 'enquiry',
        eventKey: 'new_admin_alert',
        recordId: enquiry._id,
        email: SUPPORT_EMAIL,
        subject: `New enquiry: ${fullName}`,
        body: `${fullName} submitted an enquiry${productSnapshot?.name ? ` for ${productSnapshot.name}` : ''}.`,
      }),
    ]);

    return sendSuccess(res, {
      statusCode: 201,
      message: 'Enquiry created',
      data: enquiry,
    });
  } catch (err) {
    return next(err);
  }
};

const listEnquiries = async (req, res, next) => {
  try {
    const { status, q, assignedTo, overdue, sort, priority } = req.query;
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
        { 'productSnapshot.name': new RegExp(q, 'i') },
        { 'productSnapshot.sku': new RegExp(q, 'i') },
      ];
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      sla_soon: { slaDeadline: 1, createdAt: -1 },
      priority: { priority: 1, createdAt: -1 },
    };
    const sortSpec = sortMap[String(sort || '').toLowerCase()] || { createdAt: -1 };

    const [items, total] = await Promise.all([
      Enquiry.find(filter).sort(sortSpec).skip(skip).limit(limit),
      Enquiry.countDocuments(filter),
    ]);

    return sendSuccess(res, {
      data: items,
      meta: { page, limit, total },
    });
  } catch (err) {
    return next(err);
  }
};

const updateEnquiryStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const enquiry = await Enquiry.findById(id);
    if (!enquiry) return next(new AppError('Enquiry not found', 404));

    applyStatusChange({
      doc: enquiry,
      status,
      actorUserId: req.auth?.userId,
      actorRole: req.auth?.role,
      message: `Enquiry moved to ${normalizeSupportStatus(status)}`,
    });
    syncSlaFields(enquiry);
    await enquiry.save();

    if (['resolved', 'closed'].includes(enquiry.status)) {
      await notifySupportEvent({
        moduleKey: 'enquiry',
        eventKey: 'status_update',
        recordId: enquiry._id,
        email: enquiry.email,
        mobile: enquiry.mobile,
        subject: `Enquiry ${enquiry.status}: ${enquiry.fullName}`,
        body: `Hi ${enquiry.fullName}, your enquiry is now marked as ${enquiry.status}.`,
      });
    }

    return sendSuccess(res, { message: 'Enquiry updated', data: enquiry });
  } catch (err) {
    return next(err);
  }
};

const assignEnquiry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assignedTo } = req.body;

    const enquiry = await Enquiry.findById(id);
    if (!enquiry) return next(new AppError('Enquiry not found', 404));

    applyAssignment({
      doc: enquiry,
      assignedTo,
      actorUserId: req.auth?.userId,
      actorRole: req.auth?.role,
      message: 'Enquiry assigned',
    });
    syncSlaFields(enquiry);
    await enquiry.save();

    const assignee = await resolveUserRecipient(assignedTo);
    await notifySupportEvent({
      moduleKey: 'enquiry',
      eventKey: 'assigned',
      recordId: enquiry._id,
      email: assignee?.email,
      mobile: assignee?.mobile,
      subject: `Enquiry assigned: ${enquiry.fullName}`,
      body: `A new enquiry from ${enquiry.fullName} has been assigned to you.`,
    });

    return sendSuccess(res, { message: 'Enquiry assigned', data: enquiry });
  } catch (err) {
    return next(err);
  }
};

const markFirstResponse = async (req, res, next) => {
  try {
    const { id } = req.params;
    const enquiry = await Enquiry.findById(id);
    if (!enquiry) return next(new AppError('Enquiry not found', 404));

    if (!enquiry.firstResponseAt) {
      enquiry.firstResponseAt = new Date();
      if (normalizeSupportStatus(enquiry.status) === 'new') {
        enquiry.status = enquiry.assignedTo ? 'assigned' : 'in_progress';
      }
      appendActivity(
        enquiry,
        createActivityEntry({
          type: 'first_response',
          actorUserId: req.auth?.userId,
          actorRole: req.auth?.role,
          status: enquiry.status,
          message: 'First response recorded',
        }),
      );
      syncSlaFields(enquiry);
      await enquiry.save();
    }

    return sendSuccess(res, { message: 'First response recorded', data: enquiry });
  } catch (err) {
    return next(err);
  }
};

module.exports = { createEnquiry, listEnquiries, updateEnquiryStatus, assignEnquiry, markFirstResponse };
