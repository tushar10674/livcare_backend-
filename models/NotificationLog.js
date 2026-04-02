const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ['email', 'sms', 'whatsapp', 'push'], required: true, index: true },
    templateKey: { type: String, trim: true, index: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'NotificationTemplate', index: true },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    targetRole: { type: String, trim: true, index: true },

    to: { type: String, required: true, trim: true, index: true },
    subject: { type: String, trim: true },
    body: { type: String, default: '' },
    html: { type: String, default: '' },

    status: { type: String, enum: ['pending', 'queued', 'sent', 'failed', 'delivered'], default: 'queued', index: true },
    deliveryStatus: { type: String, enum: ['queued', 'sent', 'failed', 'delivered'], default: 'queued', index: true },
    providerMessageId: { type: String, trim: true },
    providerResponse: { type: Object },

    attempts: { type: Number, default: 0, min: 0 },
    nextRetryAt: { type: Date, index: true },
    lastError: { type: String, trim: true },
    deliveredAt: { type: Date, index: true },
    readAt: { type: Date, index: true },

    meta: { type: Object },
  },
  { timestamps: true },
);

notificationLogSchema.index({ createdAt: -1 });
notificationLogSchema.index({ userId: 1, createdAt: -1 });
notificationLogSchema.index({ deliveryStatus: 1, nextRetryAt: 1 });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
