const mongoose = require('mongoose');
const {
  SUPPORT_STATUSES,
  SUPPORT_PRIORITIES,
  normalizeSupportStatus,
  normalizeSupportPriority,
} = require('../utils/supportWorkflow');

const activitySchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorRole: { type: String, trim: true },
    status: { type: String, enum: SUPPORT_STATUSES },
    message: { type: String, trim: true },
    meta: { type: Object },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const amcQuoteSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    mobile: { type: String, required: true, trim: true },
    organization: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    plan: { type: String, required: true, trim: true },
    equipmentList: { type: String, required: true, trim: true },
    installationAddress: { type: String, required: true, trim: true },
    preferredStartDate: { type: String, required: true, trim: true },
    additionalRequirements: { type: String, trim: true },

    status: {
      type: String,
      enum: SUPPORT_STATUSES,
      default: 'new',
      index: true,
      set: (value) => normalizeSupportStatus(value),
    },
    priority: {
      type: String,
      enum: SUPPORT_PRIORITIES,
      default: 'medium',
      index: true,
      set: (value) => normalizeSupportPriority(value),
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    assignedAt: { type: Date },
    slaDeadline: { type: Date, index: true },
    slaDueAt: { type: Date, index: true },
    firstResponseAt: { type: Date, index: true },
    resolvedAt: { type: Date, index: true },
    closedAt: { type: Date, index: true },
    activityTimeline: { type: [activitySchema], default: [] },
  },
  { timestamps: true },
);

amcQuoteSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AmcQuote', amcQuoteSchema);
