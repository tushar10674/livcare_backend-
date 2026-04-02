const mongoose = require('mongoose');

const deviceTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, trim: true },
    platform: { type: String, enum: ['web', 'android', 'ios', 'unknown'], default: 'unknown', index: true },
    userAgent: { type: String, trim: true },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    revokedAt: { type: Date, index: true },
  },
  { timestamps: true },
);

deviceTokenSchema.index({ userId: 1, token: 1 }, { unique: true });

deviceTokenSchema.pre('save', function preSave(next) {
  this.lastSeenAt = new Date();
  next();
});

module.exports = mongoose.model('DeviceToken', deviceTokenSchema);
