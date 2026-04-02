const { sendSuccess } = require('../utils/response');
const AuditLog = require('../models/AuditLog');

const listAuditLogs = async (req, res, next) => {
  try {
    const { action, actorUserId, entityType, entityId, statusCode } = req.query;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const skip = (page - 1) * limit;

    const filter = {};
    if (action) filter.action = action;
    if (actorUserId) filter.actorUserId = actorUserId;
    if (entityType) filter.entityType = entityType;
    if (entityId) filter.entityId = String(entityId);
    if (statusCode) filter.statusCode = Number(statusCode);

    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      AuditLog.countDocuments(filter),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

module.exports = { listAuditLogs };
