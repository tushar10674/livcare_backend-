const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedByTokenId: { type: String },
    createdByIp: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ userId: 1, tokenId: 1 }, { unique: true });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
