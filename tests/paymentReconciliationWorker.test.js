const mongoose = require('mongoose');
const { connectTestDb, disconnectTestDb, clearTestDb } = require('./helpers/mongoTestServer');

jest.mock('../config/razorpay', () => ({
  getRazorpayClient: jest.fn(),
}));

jest.mock('../utils/paymentMonitoring', () => ({
  serializeError: jest.fn((error) => ({
    message: error?.message || String(error || ''),
  })),
  logPaymentEvent: jest.fn(),
  logPaymentAlert: jest.fn(),
}));

const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const { getRazorpayClient } = require('../config/razorpay');
const { logPaymentEvent, logPaymentAlert } = require('../utils/paymentMonitoring');
const {
  processReconciliationBatch,
  processRefundRetryBatch,
} = require('../utils/paymentReconciliationWorker');

const userId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');

const buildOrderPayload = (overrides = {}) => ({
  userId,
  orderNumber: `ORD-WORKER-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  status: 'created',
  paymentStatus: 'pending',
  paymentMethod: 'card',
  paymentProvider: 'razorpay',
  items: [
    {
      productId: new mongoose.Types.ObjectId(),
      name: 'Worker Product',
      qty: 1,
      unitPrice: 1250,
      lineTotal: 1250,
    },
  ],
  subtotal: 1250,
  gstTotal: 0,
  grandTotal: 1250,
  shippingAddress: {
    fullName: 'Worker User',
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
  await clearTestDb();
});

describe('payment reconciliation worker', () => {
  test('marks stale pending payment as paid when Razorpay says captured', async () => {
    const order = await Order.create(buildOrderPayload({ paymentStatus: 'pending' }));
    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'created',
      method: 'card',
      razorpayOrderId: 'order_captured_1',
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
      updatedAt: new Date(Date.now() - 30 * 60 * 1000),
    });

    getRazorpayClient.mockReturnValue({
      payments: {},
      orders: {
        fetch: jest.fn().mockResolvedValue({ id: payment.razorpayOrderId, status: 'paid' }),
        fetchPayments: jest.fn().mockResolvedValue({
          items: [{ id: 'pay_captured_1', status: 'captured', method: 'card' }],
        }),
      },
    });

    const results = await processReconciliationBatch({ thresholdMinutes: 15, batchSize: 10 });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('captured');

    const updatedPayment = await Payment.findById(payment._id);
    const updatedOrder = await Order.findById(order._id);
    expect(updatedPayment.status).toBe('captured');
    expect(updatedPayment.razorpayPaymentId).toBe('pay_captured_1');
    expect(updatedOrder.paymentStatus).toBe('paid');
    expect(updatedOrder.status).toBe('paid');
  });

  test('marks stale authorized payment as failed when Razorpay says failed', async () => {
    const order = await Order.create(buildOrderPayload({ paymentStatus: 'authorized' }));
    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'authorized',
      method: 'card',
      razorpayOrderId: 'order_failed_1',
      razorpayPaymentId: 'pay_failed_1',
      createdAt: new Date(Date.now() - 25 * 60 * 1000),
      updatedAt: new Date(Date.now() - 25 * 60 * 1000),
    });

    getRazorpayClient.mockReturnValue({
      payments: {
        fetch: jest.fn().mockResolvedValue({
          id: payment.razorpayPaymentId,
          status: 'failed',
          method: 'card',
          error_description: 'Bank declined payment',
        }),
      },
      orders: {},
    });

    const results = await processReconciliationBatch({ thresholdMinutes: 15, batchSize: 10 });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('failed');

    const updatedPayment = await Payment.findById(payment._id);
    const updatedOrder = await Order.findById(order._id);
    expect(updatedPayment.status).toBe('failed');
    expect(updatedPayment.lastError).toBe('Bank declined payment');
    expect(updatedOrder.paymentStatus).toBe('failed');
    expect(updatedOrder.status).toBe('created');
  });

  test('alerts when stale payment is still pending after reconciliation', async () => {
    const order = await Order.create(buildOrderPayload({ paymentStatus: 'pending' }));
    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'pending',
      method: 'card',
      razorpayOrderId: 'order_stuck_1',
      razorpayPaymentId: 'pay_stuck_1',
      createdAt: new Date(Date.now() - 40 * 60 * 1000),
      updatedAt: new Date(Date.now() - 40 * 60 * 1000),
    });

    getRazorpayClient.mockReturnValue({
      payments: {
        fetch: jest.fn().mockResolvedValue({
          id: payment.razorpayPaymentId,
          status: 'authorized',
          method: 'card',
        }),
      },
      orders: {},
    });

    const results = await processReconciliationBatch({ thresholdMinutes: 15, batchSize: 10 });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('authorized');
    expect(logPaymentEvent).toHaveBeenCalledWith(
      'warn',
      'payment.reconciliation.stuck',
      expect.objectContaining({
        orderId: String(order._id),
        paymentId: String(payment._id),
        razorpayOrderId: payment.razorpayOrderId,
        razorpayPaymentId: payment.razorpayPaymentId,
      }),
    );
    expect(logPaymentAlert).toHaveBeenCalledWith(
      'payment_stuck',
      expect.objectContaining({
        orderId: String(order._id),
        paymentId: String(payment._id),
      }),
    );
  });
});

describe('refund retry worker', () => {
  test('retries failed refund once and marks it processed', async () => {
    const order = await Order.create(buildOrderPayload({ status: 'paid', paymentStatus: 'refund_pending' }));
    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId,
      amount: 1250,
      currency: 'INR',
      status: 'refund_pending',
      method: 'card',
      razorpayOrderId: 'order_refund_retry_1',
      razorpayPaymentId: 'pay_refund_retry_1',
    });
    const refund = await Refund.create({
      provider: 'razorpay',
      paymentId: payment._id,
      orderId: order._id,
      amount: 1250,
      currency: 'INR',
      status: 'failed',
      reason: 'Temporary provider error',
      retryCount: 0,
      lastRetryAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    getRazorpayClient.mockReturnValue({
      payments: {
        refund: jest.fn().mockResolvedValue({
          id: 'rfnd_worker_1',
          status: 'processed',
        }),
      },
      orders: {},
    });

    const results = await processRefundRetryBatch({
      maxRetries: 3,
      retryDelayMinutes: 15,
      batchSize: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('processed');

    const updatedRefund = await Refund.findById(refund._id);
    const updatedPayment = await Payment.findById(payment._id);
    const updatedOrder = await Order.findById(order._id);
    expect(updatedRefund.status).toBe('processed');
    expect(updatedRefund.retryCount).toBe(1);
    expect(updatedRefund.razorpayRefundId).toBe('rfnd_worker_1');
    expect(updatedPayment.status).toBe('refunded');
    expect(updatedOrder.paymentStatus).toBe('refunded');
  });
});
