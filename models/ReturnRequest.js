const mongoose = require('mongoose');

const returnItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: { type: String, trim: true },
    qty: { type: Number, min: 1, default: 1 },
  },
  { _id: false },
);

const returnTimelineSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'received', 'refunded', 'closed'],
      required: true,
    },
    note: { type: String, trim: true },
    at: { type: Date, default: Date.now, required: true },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const returnRequestSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderNumber: { type: String, trim: true, index: true },
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'received', 'refunded', 'closed'],
      default: 'requested',
      index: true,
    },
    refundStatus: {
      type: String,
      enum: ['not_requested', 'pending', 'processed', 'not_applicable'],
      default: 'pending',
      index: true,
    },
    reason: { type: String, required: true, trim: true },
    details: { type: String, trim: true },
    items: { type: [returnItemSchema], default: [] },
    timeline: { type: [returnTimelineSchema], default: [] },
  },
  { timestamps: true },
);

returnRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ReturnRequest', returnRequestSchema);
