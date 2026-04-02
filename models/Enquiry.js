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

const enquirySchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productSnapshot: {
      name: { type: String, trim: true },
      sku: { type: String, trim: true },
      brand: { type: String, trim: true },
      category: { type: String, trim: true },
      mode: { type: String, trim: true },
    },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    mobile: { type: String, required: true, trim: true },
    organization: { type: String, trim: true },
    city: { type: String, trim: true },
    qty: { type: Number, default: 1, min: 1 },
    requirements: { type: String, trim: true },
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

enquirySchema.index({ createdAt: -1 });
enquirySchema.index({ status: 1, slaDeadline: 1 });

module.exports = mongoose.model('Enquiry', enquirySchema);
