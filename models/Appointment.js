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

const appointmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, trim: true },
    date: { type: String, required: true, trim: true },
    time: { type: String, required: true, trim: true },
    doctor: { type: String, required: true, trim: true },
    reason: { type: String, required: true, trim: true },
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
    firstResponseAt: { type: Date, index: true },
    resolvedAt: { type: Date, index: true },
    closedAt: { type: Date, index: true },
    slaDeadline: { type: Date, index: true },
    slaDueAt: { type: Date, index: true },
    activityTimeline: { type: [activitySchema], default: [] },
  },
  { timestamps: true },
);

appointmentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
