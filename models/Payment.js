const mongoose = require('mongoose');

const paymentEventSchema = new mongoose.Schema(
  {
    type: { type: String, trim: true },
    payload: { type: Object },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const paymentSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['razorpay', 'cod'], required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    status: {
      type: String,
      enum: ['pending', 'created', 'authorized', 'captured', 'failed', 'refund_pending', 'refunded', 'cancelled'],
      default: 'pending',
      index: true,
    },

    method: { type: String, trim: true, index: true },

    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    refundStatus: { type: String, enum: ['pending', 'processed', 'failed'], default: null, index: true },
    refundAmount: { type: Number, min: 0, default: 0 },
    lastError: { type: String, trim: true },
    webhookEventKeys: { type: [String], default: [] },

    events: { type: [paymentEventSchema], default: [] },
  },
  { timestamps: true },
);

paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ razorpayPaymentId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ orderId: 1, provider: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
