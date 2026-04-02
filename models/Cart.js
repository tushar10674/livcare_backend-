const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    qty: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

const cartSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    items: { type: [cartItemSchema], default: [] },
    currency: { type: String, default: 'INR' },
    checkoutLockToken: { type: String, trim: true, index: true },
    checkoutLockedAt: { type: Date, index: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Cart', cartSchema);
