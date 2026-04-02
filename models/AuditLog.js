const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    actorRole: { type: String, trim: true, index: true },

    action: { type: String, required: true, trim: true, index: true },
    entityType: { type: String, trim: true, index: true },
    entityId: { type: String, trim: true, index: true },

    method: { type: String, trim: true },
    path: { type: String, trim: true },
    statusCode: { type: Number, index: true },

    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },

    requestBody: { type: Object },
    meta: { type: Object },
  },
  { timestamps: true },
);

auditLogSchema.index({ createdAt: -1 });

auditLogSchema.index({ actorUserId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
