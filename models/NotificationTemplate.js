const mongoose = require('mongoose');

const notificationTemplateSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ['email', 'sms', 'whatsapp', 'push'], required: true, index: true },
    key: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },

    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    publishedAt: { type: Date },

    draft: {
      subject: { type: String, trim: true },
      body: { type: String, default: '' },
      html: { type: String, default: '' },
    },

    published: {
      subject: { type: String, trim: true },
      body: { type: String, default: '' },
      html: { type: String, default: '' },
    },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

notificationTemplateSchema.index({ channel: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('NotificationTemplate', notificationTemplateSchema);
