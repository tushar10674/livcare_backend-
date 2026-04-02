const AuditLog = require('../models/AuditLog');

const DEFAULT_SENSITIVE_KEYS = ['password', 'token', 'refreshToken', 'razorpaySignature', 'jwt', 'secret'];

const sanitizeBody = (body) => {
  if (!body || typeof body !== 'object') return body;

  const clone = Array.isArray(body) ? body.slice(0, 50) : { ...body };

  DEFAULT_SENSITIVE_KEYS.forEach((k) => {
    if (clone && typeof clone === 'object' && k in clone) clone[k] = '[REDACTED]';
  });

  return clone;
};

const createAuditEntry = ({ req, action, entityType, entityId, meta, statusCode }) => ({
  actorUserId: req.auth?.userId,
  actorRole: req.auth?.role,
  action,
  entityType,
  entityId: entityId ? String(entityId) : undefined,
  method: req.method,
  path: req.originalUrl,
  statusCode,
  ip: req.ip,
  userAgent: req.get('user-agent') || undefined,
  requestBody: sanitizeBody(req.body),
  meta,
});

const deriveAdminAction = (req) => {
  const pathKey = String(req.originalUrl || '')
    .split('?')[0]
    .replace(/^\/+api\/+/, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '.')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  return `admin.${String(req.method || 'get').toLowerCase()}.${pathKey || 'root'}`;
};

const audit = async ({ req, action, entityType, entityId, meta }) => {
  try {
    await AuditLog.create(createAuditEntry({ req, action, entityType, entityId, meta, statusCode: resStatusFromReq(req) }));
  } catch {
    // swallow audit failures
  }
};

const resStatusFromReq = (req) => {
  // best-effort: set by middleware below
  return req._auditStatusCode;
};

const auditMiddleware = (action, { entityType, entityIdFromReq, metaBuilder } = {}) => {
  return (req, res, next) => {
    req._hasRouteAudit = true;
    res.on('finish', () => {
      req._auditStatusCode = res.statusCode;

      const entityId = typeof entityIdFromReq === 'function' ? entityIdFromReq(req, res) : undefined;
      const meta = typeof metaBuilder === 'function' ? metaBuilder(req, res) : undefined;

      AuditLog.create(createAuditEntry({ req, action, entityType, entityId, meta, statusCode: res.statusCode })).catch(() => {});
    });

    next();
  };
};

const auditAdminMutations = (req, res, next) => {
  res.on('finish', () => {
    if (req._hasRouteAudit) return;
    if (!req.auth?.userId || req.auth?.role !== 'admin') return;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase())) return;

    AuditLog.create(
      createAuditEntry({
        req,
        action: deriveAdminAction(req),
        entityType: 'AdminAction',
        entityId: req.params?.id,
        meta: { autoAudit: true },
        statusCode: res.statusCode,
      }),
    ).catch(() => {});
  });
  next();
};

module.exports = { audit, auditMiddleware, auditAdminMutations, sanitizeBody };
