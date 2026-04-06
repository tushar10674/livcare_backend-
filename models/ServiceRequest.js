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

const serviceRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

    contact: {
      fullName: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
      mobile: { type: String, trim: true },
      organization: { type: String, trim: true },
    },

    type: { type: String, enum: ['installation', 'amc', 'service'], required: true, index: true },

    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productSnapshot: {
      name: { type: String, trim: true },
      sku: { type: String, trim: true },
      brand: { type: String, trim: true },
      category: { type: String, trim: true },
    },

    preferredDate: { type: String, trim: true },
    preferredTime: { type: String, trim: true },

    address: {
      line1: { type: String, required: true, trim: true },
      line2: { type: String, trim: true },
      city: { type: String, required: true, trim: true },
      state: { type: String, required: true, trim: true },
      pincode: { type: String, required: true, trim: true },
      country: { type: String, trim: true, default: 'India' },
    },

    notes: { type: String, trim: true },

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

    scheduledAt: { type: Date },
    completedAt: { type: Date },
    firstResponseAt: { type: Date, index: true },
    resolvedAt: { type: Date, index: true },
    closedAt: { type: Date, index: true },
    slaDeadline: { type: Date, index: true },
    slaDueAt: { type: Date, index: true },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    assignedAt: { type: Date },
    activityTimeline: { type: [activitySchema], default: [] },
  },
  { timestamps: true },
);

serviceRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema);
