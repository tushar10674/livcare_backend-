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

const ticketSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },

    category: {
      type: String,
      enum: ['support', 'installation', 'amc', 'service', 'billing', 'other'],
      default: 'support',
      index: true,
    },
    priority: {
      type: String,
      enum: SUPPORT_PRIORITIES,
      default: 'medium',
      index: true,
      set: (value) => normalizeSupportPriority(value),
    },

    status: {
      type: String,
      enum: SUPPORT_STATUSES,
      default: 'new',
      index: true,
      set: (value) => normalizeSupportStatus(value),
    },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    assignedAt: { type: Date },

    firstResponseAt: { type: Date, index: true },
    resolvedAt: { type: Date, index: true },
    closedAt: { type: Date, index: true },

    slaDeadline: { type: Date, index: true },
    slaDueAt: { type: Date, index: true },
    activityTimeline: { type: [activitySchema], default: [] },
  },
  { timestamps: true },
);

ticketSchema.index({ createdAt: -1 });

ticketSchema.virtual('ticketNumber').get(function ticketNumber() {
  return `TKT-${String(this._id).slice(-6).toUpperCase()}`;
});

module.exports = mongoose.model('Ticket', ticketSchema);
