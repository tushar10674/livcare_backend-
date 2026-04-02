const mongoose = require('mongoose');

const refundSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['razorpay'], required: true, index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['pending', 'processed', 'failed'], default: 'pending', index: true },
    reason: { type: String, trim: true },
    retryCount: { type: Number, default: 0 },
    lastRetryAt: { type: Date },
    lastError: { type: String, trim: true },

    razorpayRefundId: { type: String },
    raw: { type: Object },
  },
  { timestamps: true },
);

refundSchema.index({ createdAt: -1 });
refundSchema.index({ razorpayRefundId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Refund', refundSchema);
