const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true },
    fullName: { type: String, trim: true },
    mobile: { type: String, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    landmark: { type: String, trim: true },
    city: { type: String, required: true, trim: true, index: true },
    state: { type: String, required: true, trim: true, index: true },
    pincode: { type: String, required: true, trim: true, index: true },
    country: { type: String, trim: true, default: 'India' },
    isDefault: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    mobile: { type: String, trim: true },
    organization: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true, index: true },
    state: { type: String, trim: true, index: true },
    pincode: { type: String, trim: true, index: true },
    password: { type: String, required: true, select: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
    isActive: { type: Boolean, default: true },

    addresses: { type: [addressSchema], default: [] },

    gst: {
      number: { type: String, trim: true },
      legalName: { type: String, trim: true },
      organization: { type: String, trim: true },
    },

    settings: {
      notifications: {
        email: { type: Boolean, default: true },
        sms: { type: Boolean, default: true },
        whatsapp: { type: Boolean, default: false },
      },
      security: {
        twoFactorEnabled: { type: Boolean, default: false },
      },
      marketingOptIn: { type: Boolean, default: false },
    },

    deletedAt: { type: Date, index: true },
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    lastFailedLoginAt: { type: Date },
    lastFailedLoginIp: { type: String },
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String },
    lastLoginUserAgent: { type: String },

    isEmailVerified: { type: Boolean, default: false, index: true },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpiresAt: { type: Date, select: false },
    twoFactorCodeHash: { type: String, select: false },
    twoFactorChallengeHash: { type: String, select: false },
    twoFactorExpiresAt: { type: Date, select: false },

    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
  },
  { timestamps: true },
);

userSchema.pre('save', async function preSave(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  return next();
});

userSchema.methods.comparePassword = async function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
