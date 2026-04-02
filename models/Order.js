const crypto = require('crypto');
const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: { type: String, required: true, trim: true },
    sku: { type: String, trim: true },
    hsnCode: { type: String, trim: true },
    brand: { type: String, trim: true },
    category: { type: String, trim: true },
    mode: { type: String, trim: true },
    qty: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    gstRate: { type: Number, default: 0 },
  },
  { _id: false },
);

const statusEventSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['created', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'],
      required: true,
    },
    note: { type: String, trim: true },
    at: { type: Date, default: Date.now, required: true },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const shipmentEventSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['pending', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'cancelled'],
      required: true,
    },
    location: { type: String, trim: true },
    note: { type: String, trim: true },
    at: { type: Date, default: Date.now, required: true },
  },
  { _id: false },
);

const addressSnapshotSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true },
    fullName: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    mobile: { type: String, trim: true },
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    landmark: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    country: { type: String, trim: true },
  },
  { _id: false },
);

const gstBreakdownSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['igst', 'cgst_sgst'], default: 'igst' },
    igst: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    rate: { type: Number, default: 0 },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderNumber: { type: String, required: true, unique: true, index: true },
    trackingToken: { type: String, unique: true, sparse: true, index: true },
    status: { type: String, enum: ['created', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'], default: 'created', index: true },
    paymentStatus: {
      type: String,
      enum: ['pending', 'cod_pending', 'authorized', 'paid', 'failed', 'refund_pending', 'partially_refunded', 'refunded'],
      default: 'pending',
      index: true,
    },
    paidAt: { type: Date, index: true },

    statusHistory: { type: [statusEventSchema], default: [] },

    invoiceNumber: { type: String, index: true, unique: true, sparse: true },
    invoiceIssuedAt: { type: Date },

    carrier: { type: String, trim: true, index: true },
    trackingId: { type: String, trim: true, index: true },
    shipmentStatus: {
      type: String,
      enum: ['pending', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'cancelled'],
      default: 'pending',
      index: true,
    },
    eta: { type: Date },
    shipmentHistory: { type: [shipmentEventSchema], default: [] },
    shipmentWebhookKeys: { type: [String], default: [] },

    items: { type: [orderItemSchema], required: true },

    subtotal: { type: Number, required: true, min: 0 },
    gstTotal: { type: Number, required: true, min: 0 },
    grandTotal: { type: Number, required: true, min: 0 },

    gstBreakdown: { type: gstBreakdownSchema },

    shippingAddress: { type: addressSnapshotSchema, required: true },

    gstDetails: {
      number: { type: String, trim: true },
      legalName: { type: String, trim: true },
      organization: { type: String, trim: true },
    },

    paymentMethod: { type: String, trim: true },
    paymentProvider: { type: String, trim: true },
    cancelledAt: { type: Date },
    cancelReason: { type: String, trim: true },

    stockRestoredAt: { type: Date, index: true },
    stockRestoredReason: { type: String, trim: true },
    autoCancelledAt: { type: Date, index: true },
    autoCancelReason: { type: String, trim: true },
  },
  { timestamps: true },
);

orderSchema.index({ createdAt: -1 });
orderSchema.index({ trackingId: 1, carrier: 1 });

orderSchema.pre('validate', function preValidate(next) {
  if (!this.trackingToken) {
    this.trackingToken = crypto.randomBytes(24).toString('hex');
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
