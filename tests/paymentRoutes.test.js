const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const paymentRoutes = require('../routes/paymentRoutes');
const { errorHandler } = require('../middleware/errorHandler');
const { connectTestDb, disconnectTestDb, clearTestDb } = require('./helpers/mongoTestServer');

jest.mock('../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    req.auth = { userId: '507f1f77bcf86cd799439011', role: 'admin' };
    req.user = { _id: '507f1f77bcf86cd799439011', role: 'admin', isActive: true };
    next();
  },
  requireRole:
    (...roles) =>
    (req, res, next) =>
      roles.includes(req.auth?.role) ? next() : next(new Error('Forbidden')),
}));

jest.mock('../config/razorpay', () => ({
  getRazorpayClient: jest.fn(),
}));

jest.mock('../utils/razorpaySignatures', () => ({
  verifyRazorpayWebhookSignature: jest.fn(),
  verifyRazorpayPaymentSignature: jest.fn(),
}));

const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const { getRazorpayClient } = require('../config/razorpay');
const {
  verifyRazorpayWebhookSignature,
  verifyRazorpayPaymentSignature,
} = require('../utils/razorpaySignatures');

const createApp = () => {
  const app = express();
  app.use('/api/payments/webhooks/razorpay', express.raw({ type: '*/*' }));
  const jsonParser = express.json();
  app.use((req, res, next) => (req.path === '/api/payments/webhooks/razorpay' ? next() : jsonParser(req, res, next)));
  app.use('/api/payments', paymentRoutes);
  app.use(errorHandler);
  return app;
};

const userId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');

const buildOrderPayload = (overrides = {}) => ({
  userId,
  orderNumber: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  status: 'created',
  paymentStatus: 'pending',
  paymentMethod: 'card',
  paymentProvider: 'razorpay',
  items: [
    {
      productId: new mongoose.Types.ObjectId(),
      name: 'Test Product',
      qty: 1,
      unitPrice: 1250,
      lineTotal: 1250,
    },
  ],
  subtotal: 1250,
  gstTotal: 0,
  grandTotal: 1250,
  shippingAddress: {
    fullName: 'Test User',
    mobile: '9999999999',
    line1: 'Addr 1',
    city: 'Mumbai',
    state: 'MH',
    pincode: '400001',
    country: 'IN',
  },
  ...overrides,
});

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  jest.clearAllMocks();
  process.env.RAZORPAY_KEY_SECRET = 'secret_test';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
  process.env.RAZORPAY_KEY_ID = 'rzp_test';
  await clearTestDb();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('payment routes (integration)', () => {
  test('payment verification succeeds with valid signature', async () => {
    const app = createApp();

    const order = await Order.create(buildOrderPayload());
    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'created',
      method: 'card',
      razorpayOrderId: 'order_razorpay_1',
    });

    verifyRazorpayPaymentSignature.mockReturnValue(true);
    getRazorpayClient.mockReturnValue({
      payments: {
        fetch: jest.fn().mockResolvedValue({
          id: 'pay_1',
          order_id: payment.razorpayOrderId,
          amount: 125000,
          currency: 'INR',
          status: 'captured',
          method: 'card',
        }),
      },
      orders: {},
    });

    const response = await request(app).post('/api/payments/razorpay/verify').send({
      orderId: String(order._id),
      paymentId: String(payment._id),
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId: 'pay_1',
      razorpaySignature: 'sig_1',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const updatedPayment = await Payment.findById(payment._id);
    const updatedOrder = await Order.findById(order._id);
    expect(updatedPayment.status).toBe('captured');
    expect(updatedOrder.paymentStatus).toBe('paid');
  });

  test('payment verification fails with invalid signature', async () => {
    const app = createApp();

    const order = await Order.create(buildOrderPayload());
    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'created',
      method: 'card',
      razorpayOrderId: 'order_razorpay_1',
    });

    verifyRazorpayPaymentSignature.mockReturnValue(false);

    const response = await request(app).post('/api/payments/razorpay/verify').send({
      orderId: String(order._id),
      paymentId: String(payment._id),
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId: 'pay_1',
      razorpaySignature: 'bad_sig',
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);

    const updatedPayment = await Payment.findById(payment._id);
    const updatedOrder = await Order.findById(order._id);
    expect(updatedPayment.status).toBe('failed');
    expect(updatedOrder.paymentStatus).toBe('failed');
  });

  test('payment verify self-heals paid order state when payment is already captured', async () => {
    const app = createApp();

    const order = await Order.create(buildOrderPayload({ paymentStatus: 'pending', status: 'created' }));
    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'captured',
      method: 'card',
      razorpayOrderId: 'order_self_heal_1',
      razorpayPaymentId: 'pay_self_heal_1',
    });

    const response = await request(app).post('/api/payments/razorpay/verify').send({
      orderId: String(order._id),
      paymentId: String(payment._id),
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId: payment.razorpayPaymentId,
      razorpaySignature: 'sig_1',
    });

    expect(response.status).toBe(200);

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder.paymentStatus).toBe('paid');
    expect(updatedOrder.status).toBe('paid');
    expect(updatedOrder.paidAt).toBeTruthy();
  });

  test('payment verification returns controlled 502 when Razorpay fetch fails', async () => {
    const app = createApp();

    const order = await Order.create(buildOrderPayload());
    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'created',
      method: 'card',
      razorpayOrderId: 'order_provider_fail_1',
    });

    verifyRazorpayPaymentSignature.mockReturnValue(true);
    getRazorpayClient.mockReturnValue({
      payments: {
        fetch: jest.fn().mockRejectedValue(new Error('ETIMEDOUT')),
      },
      orders: {},
      refunds: {},
    });

    const response = await request(app).post('/api/payments/razorpay/verify').send({
      orderId: String(order._id),
      paymentId: String(payment._id),
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId: 'pay_timeout_1',
      razorpaySignature: 'sig_timeout',
    });

    expect(response.status).toBe(502);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Payment provider unavailable, please retry');
  });

  test('webhook processes valid signature and is idempotent', async () => {
    const app = createApp();
    const order = await Order.create(buildOrderPayload());
    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'created',
      method: 'card',
      razorpayOrderId: 'order_razorpay_1',
      webhookEventKeys: [],
    });

    const payload = {
      id: 'evt_1',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_1',
            order_id: payment.razorpayOrderId,
            method: 'card',
            status: 'captured',
          },
        },
      },
    };

    verifyRazorpayWebhookSignature.mockReturnValue(true);

    const first = await request(app)
      .post('/api/payments/webhooks/razorpay')
      .set('x-razorpay-signature', 'valid_sig')
      .set('Content-Type', 'application/octet-stream')
      .send(JSON.stringify(payload));

    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);

    const afterFirst = await Payment.findById(payment._id);
    expect(afterFirst.status).toBe('captured');
    expect(afterFirst.webhookEventKeys.length).toBe(1);

    const second = await request(app)
      .post('/api/payments/webhooks/razorpay')
      .set('x-razorpay-signature', 'valid_sig')
      .set('Content-Type', 'application/octet-stream')
      .send(JSON.stringify(payload));

    expect(second.status).toBe(200);

    const afterSecond = await Payment.findById(payment._id);
    const updatedOrder = await Order.findById(order._id);
    expect(afterSecond.status).toBe('captured');
    expect(afterSecond.webhookEventKeys.length).toBe(1);
    expect(updatedOrder.paymentStatus).toBe('paid');
  });

  test('webhook rejects invalid signature', async () => {
    const app = createApp();
    verifyRazorpayWebhookSignature.mockReturnValue(false);

    const response = await request(app)
      .post('/api/payments/webhooks/razorpay')
      .set('x-razorpay-signature', 'bad_sig')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ event: 'payment.failed' })));

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test('refund processed webhook syncs payment refund state and marks partial refund idempotently', async () => {
    const app = createApp();
    const order = await Order.create(buildOrderPayload({ status: 'paid', paymentStatus: 'refund_pending' }));
    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'refund_pending',
      method: 'card',
      razorpayOrderId: 'order_refund_partial_1',
      razorpayPaymentId: 'pay_refund_partial_1',
      refundAmount: 0,
      refundStatus: null,
      webhookEventKeys: [],
    });

    verifyRazorpayWebhookSignature.mockReturnValue(true);

    const payload = {
      id: 'evt_refund_1',
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_partial_1',
            payment_id: payment.razorpayPaymentId,
            amount: 50000,
            currency: 'INR',
          },
        },
      },
    };

    const first = await request(app)
      .post('/api/payments/webhooks/razorpay')
      .set('x-razorpay-signature', 'valid_sig')
      .set('Content-Type', 'application/octet-stream')
      .send(JSON.stringify(payload));

    expect(first.status).toBe(200);

    const updatedPayment = await Payment.findById(payment._id);
    const updatedOrder = await Order.findById(order._id);
    expect(updatedPayment.refundStatus).toBe('processed');
    expect(updatedPayment.refundAmount).toBe(500);
    expect(updatedOrder.paymentStatus).toBe('partially_refunded');

    const second = await request(app)
      .post('/api/payments/webhooks/razorpay')
      .set('x-razorpay-signature', 'valid_sig')
      .set('Content-Type', 'application/octet-stream')
      .send(JSON.stringify(payload));

    expect(second.status).toBe(200);

    const paymentAfterSecond = await Payment.findById(payment._id);
    expect(paymentAfterSecond.refundAmount).toBe(500);
    expect(paymentAfterSecond.webhookEventKeys.filter((key) => key.includes('evt_refund_1')).length).toBe(1);
  });

  test('refund failed webhook syncs payment refund status as failed', async () => {
    const app = createApp();
    const order = await Order.create(buildOrderPayload({ status: 'paid', paymentStatus: 'refund_pending' }));
    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'refund_pending',
      method: 'card',
      razorpayOrderId: 'order_refund_fail_1',
      razorpayPaymentId: 'pay_refund_fail_1',
      webhookEventKeys: [],
    });

    verifyRazorpayWebhookSignature.mockReturnValue(true);

    const payload = {
      id: 'evt_refund_fail_1',
      event: 'refund.failed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_fail_1',
            payment_id: payment.razorpayPaymentId,
            amount: 50000,
            currency: 'INR',
            error_description: 'Refund failed',
          },
        },
      },
    };

    const response = await request(app)
      .post('/api/payments/webhooks/razorpay')
      .set('x-razorpay-signature', 'valid_sig')
      .set('Content-Type', 'application/octet-stream')
      .send(JSON.stringify(payload));

    expect(response.status).toBe(200);

    const updatedPayment = await Payment.findById(payment._id);
    const updatedOrder = await Order.findById(order._id);
    expect(updatedPayment.refundStatus).toBe('failed');
    expect(updatedPayment.status).toBe('refund_pending');
    expect(updatedOrder.paymentStatus).toBe('refund_pending');
  });

  test('duplicate refund is prevented (409)', async () => {
    const app = createApp();
    const order = await Order.create(buildOrderPayload({ status: 'paid', paymentStatus: 'paid' }));
    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'captured',
      method: 'card',
      razorpayOrderId: 'order_razorpay_1',
      razorpayPaymentId: 'pay_1',
    });

    await Refund.create({
      provider: 'razorpay',
      paymentId: payment._id,
      orderId: order._id,
      amount: 1250,
      currency: 'INR',
      status: 'pending',
      reason: 'Existing refund',
      razorpayRefundId: 'rfnd_1',
    });

    const response = await request(app).post('/api/payments/refunds').send({
      orderId: String(order._id),
      reason: 'Duplicate attempt',
    });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
  });

  test('failed refund can be retried once and processed idempotently', async () => {
    const app = createApp();
    const order = await Order.create(buildOrderPayload({ status: 'paid', paymentStatus: 'refund_pending' }));
    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'refund_pending',
      method: 'card',
      razorpayOrderId: 'order_razorpay_retry_1',
      razorpayPaymentId: 'pay_retry_1',
    });
    const refund = await Refund.create({
      provider: 'razorpay',
      paymentId: payment._id,
      orderId: order._id,
      amount: 1250,
      currency: 'INR',
      status: 'failed',
      reason: 'Gateway error',
    });

    getRazorpayClient.mockReturnValue({
      payments: {
        refund: jest.fn().mockResolvedValue({
          id: 'rfnd_retry_1',
          status: 'processed',
        }),
      },
      orders: {},
    });

    const response = await request(app).post('/api/payments/refunds/retry').send({
      refundId: String(refund._id),
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const updatedRefund = await Refund.findById(refund._id);
    const updatedPayment = await Payment.findById(payment._id);
    const updatedOrder = await Order.findById(order._id);
    expect(updatedRefund.status).toBe('processed');
    expect(updatedRefund.retryCount).toBe(1);
    expect(updatedPayment.status).toBe('refunded');
    expect(updatedOrder.paymentStatus).toBe('refunded');

    const duplicate = await request(app).post('/api/payments/refunds/retry').send({
      refundId: String(refund._id),
    });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.success).toBe(false);
  });

  test('retry flow supersedes old payment and creates a new Payment + Razorpay order', async () => {
    const app = createApp();
    const order = await Order.create(buildOrderPayload({ paymentStatus: 'failed' }));
    const stalePayment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'authorized',
      method: 'card',
      razorpayOrderId: 'order_stale_1',
    });

    getRazorpayClient.mockReturnValue({
      orders: {
        create: jest.fn().mockResolvedValue({ id: 'order_new_1', amount: 125000, currency: 'INR' }),
      },
      payments: {},
    });

    const response = await request(app).post('/api/payments/retry').send({ orderId: String(order._id) });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.razorpayOrder.id).toBe('order_new_1');

    const staleUpdated = await Payment.findById(stalePayment._id);
    expect(staleUpdated.status).toBe('failed');

    const payments = await Payment.find({ orderId: order._id, provider: 'razorpay' }).sort({ createdAt: 1 });
    expect(payments.length).toBe(2);
    expect(payments[1].razorpayOrderId).toBe('order_new_1');
  });
});
