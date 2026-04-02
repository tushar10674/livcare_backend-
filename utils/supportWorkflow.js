const SUPPORT_STATUSES = ['new', 'assigned', 'in_progress', 'resolved', 'closed'];
const SUPPORT_PRIORITIES = ['low', 'medium', 'high'];

const LEGACY_STATUS_MAP = {
  open: 'new',
  contacted: 'in_progress',
  quoted: 'in_progress',
  replied: 'resolved',
  confirmed: 'assigned',
  scheduled: 'assigned',
  completed: 'resolved',
  cancelled: 'closed',
};

const LEGACY_PRIORITY_MAP = {
  urgent: 'high',
};

const PRIORITY_SLA_HOURS = {
  high: 4,
  medium: 24,
  low: 72,
};

const normalizeSupportStatus = (value, fallback = 'new') => {
  if (!value) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (SUPPORT_STATUSES.includes(normalized)) return normalized;
  if (LEGACY_STATUS_MAP[normalized]) return LEGACY_STATUS_MAP[normalized];
  return fallback;
};

const normalizeSupportPriority = (value, fallback = 'medium') => {
  if (!value) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (SUPPORT_PRIORITIES.includes(normalized)) return normalized;
  if (LEGACY_PRIORITY_MAP[normalized]) return LEGACY_PRIORITY_MAP[normalized];
  return fallback;
};

const computeSlaDeadline = ({ priority = 'medium', createdAt = new Date(), overrideHours } = {}) => {
  const normalizedPriority = normalizeSupportPriority(priority);
  const hours = Number.isFinite(Number(overrideHours))
    ? Number(overrideHours)
    : PRIORITY_SLA_HOURS[normalizedPriority];
  return new Date(new Date(createdAt).getTime() + hours * 60 * 60 * 1000);
};

const createActivityEntry = ({ type, actorUserId, actorRole, status, message, meta, at } = {}) => ({
  type: String(type || 'updated').trim(),
  actorUserId: actorUserId || undefined,
  actorRole: actorRole || undefined,
  status: status ? normalizeSupportStatus(status, undefined) : undefined,
  message: message ? String(message).trim() : undefined,
  meta: meta && typeof meta === 'object' ? meta : undefined,
  at: at ? new Date(at) : new Date(),
});

const appendActivity = (doc, entry) => {
  if (!doc) return;
  if (!Array.isArray(doc.activityTimeline)) doc.activityTimeline = [];
  doc.activityTimeline.push(entry);
  doc.activityTimeline.sort((left, right) => new Date(left.at) - new Date(right.at));
};

const syncSlaFields = (doc) => {
  if (!doc) return;
  if (doc.slaDeadline) doc.slaDueAt = doc.slaDeadline;
};

const applyStatusChange = ({ doc, status, actorUserId, actorRole, message, meta } = {}) => {
  if (!doc) return false;

  const nextStatus = normalizeSupportStatus(status, doc.status || 'new');
  const previousStatus = normalizeSupportStatus(doc.status || 'new');
  const now = new Date();

  if (nextStatus === previousStatus) return false;

  doc.status = nextStatus;

  if (!doc.firstResponseAt && ['assigned', 'in_progress', 'resolved', 'closed'].includes(nextStatus)) {
    doc.firstResponseAt = now;
  }

  if (nextStatus === 'resolved') {
    doc.resolvedAt = doc.resolvedAt || now;
    doc.closedAt = undefined;
  } else if (nextStatus === 'closed') {
    doc.resolvedAt = doc.resolvedAt || now;
    doc.closedAt = now;
  } else {
    if (previousStatus === 'resolved') doc.resolvedAt = undefined;
    if (previousStatus === 'closed') {
      doc.closedAt = undefined;
      doc.resolvedAt = undefined;
    }
  }

  appendActivity(
    doc,
    createActivityEntry({
      type: 'status_change',
      actorUserId,
      actorRole,
      status: nextStatus,
      message: message || `Status changed from ${previousStatus} to ${nextStatus}`,
      meta: { previousStatus, ...(meta || {}) },
      at: now,
    }),
  );

  return true;
};

const applyAssignment = ({ doc, assignedTo, actorUserId, actorRole, message, meta } = {}) => {
  if (!doc || typeof assignedTo === 'undefined') return false;

  const normalizedAssignedTo = assignedTo || undefined;
  const previousAssignee = doc.assignedTo ? String(doc.assignedTo) : undefined;
  const nextAssignee = normalizedAssignedTo ? String(normalizedAssignedTo) : undefined;
  const now = new Date();

  if (previousAssignee === nextAssignee) return false;

  doc.assignedTo = normalizedAssignedTo;
  doc.assignedAt = normalizedAssignedTo ? now : undefined;

  if (normalizedAssignedTo && normalizeSupportStatus(doc.status || 'new') === 'new') {
    doc.status = 'assigned';
  }

  if (normalizedAssignedTo && !doc.firstResponseAt) {
    doc.firstResponseAt = now;
  }

  appendActivity(
    doc,
    createActivityEntry({
      type: normalizedAssignedTo ? 'assigned' : 'unassigned',
      actorUserId,
      actorRole,
      status: doc.status,
      message:
        message || (normalizedAssignedTo ? 'Record assigned to support owner' : 'Record unassigned from support owner'),
      meta: { previousAssignee, nextAssignee, ...(meta || {}) },
      at: now,
    }),
  );

  return true;
};

module.exports = {
  SUPPORT_STATUSES,
  SUPPORT_PRIORITIES,
  PRIORITY_SLA_HOURS,
  normalizeSupportStatus,
  normalizeSupportPriority,
  computeSlaDeadline,
  createActivityEntry,
  appendActivity,
  syncSlaFields,
  applyStatusChange,
  applyAssignment,
};
