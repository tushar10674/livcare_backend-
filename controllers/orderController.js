const crypto = require('crypto');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Product = require('../models/Product');
const AppSetting = require('../models/AppSetting');
const ReturnRequest = require('../models/ReturnRequest');
const { autoRefundForOrder } = require('./paymentController');
const { DEFAULT_GST_RATE, round2, calcCartTotals } = require('../utils/pricing');
const { notifyOrderEvent } = require('../utils/orderNotifications');

const createOrderNumber = () => {
  return `LIV-${new Date().getFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
};

const createInvoiceNumber = () => {
  const suffix = String(Math.floor(100000 + Math.random() * 900000));
  return `INV-${new Date().getFullYear()}-${suffix}`;
};

const formatMoney = (value) =>
  Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const buildInvoiceSellerProfile = (settings) => ({
  name: process.env.INVOICE_COMPANY_NAME || settings?.site?.siteName || 'Livcare Medical Systems',
  address:
    process.env.INVOICE_COMPANY_ADDRESS ||
    settings?.site?.footerText ||
    `${settings?.shipping?.businessCity || 'Mumbai'}, ${settings?.shipping?.businessState || 'Maharashtra'}, India`,
  gstin: process.env.INVOICE_COMPANY_GSTIN || process.env.GSTIN || 'N/A',
  phone: process.env.INVOICE_COMPANY_PHONE || settings?.contact?.supportPhone || '',
  email: process.env.INVOICE_COMPANY_EMAIL || settings?.contact?.supportEmail || '',
});

const canCancelOrderStatus = (status) => ['created', 'paid', 'processing'].includes(String(status || ''));

const normalizeAddress = (address) => ({
  label: address?.label,
  fullName: address?.fullName,
  email: address?.email,
  mobile: address?.mobile,
  line1: address?.line1,
  line2: address?.line2,
  landmark: address?.landmark,
  city: address?.city,
  state: address?.state,
  pincode: address?.pincode,
  country: address?.country,
});

const resolveShippingAddress = ({ addressId, shippingAddress, user }) => {
  if (addressId) {
    const address = (user.addresses || []).find((entry) => entry._id.toString() === String(addressId));
    if (!address) throw new AppError('Invalid addressId', 400);
    return normalizeAddress(address);
  }

  if (shippingAddress) return normalizeAddress(shippingAddress);
  throw new AppError('Shipping address is required', 422);
};

const buildUnifiedTimeline = (order) =>
  [...(order.statusHistory || []).map((entry) => ({
    type: 'order',
    status: entry.status,
    note: entry.note,
    date: entry.at,
  })), ...(order.shipmentHistory || []).map((entry) => ({
    type: 'shipment',
    status: entry.status,
    note: entry.note,
    location: entry.location,
    date: entry.at,
  }))]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

const ensureInvoiceIssued = async (order) => {
  if (!order.invoiceNumber) {
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        order.invoiceNumber = createInvoiceNumber();
        order.invoiceIssuedAt = new Date();
        await order.save();
        break;
      } catch (err) {
        if (String(err?.code || '') === '11000' && attempt < maxAttempts - 1) {
          continue;
        }
        throw err;
      }
    }
  }

  return order;
};

const restoreOrderStock = async ({ order, session }) => {
  for (const item of order.items || []) {
    const product = await Product.findById(item.productId).session(session);
    if (!product) continue;

    const qty = Math.max(1, Number(item.qty || 1));
    const nextQty = Math.max(0, Number(product.stockQty || 0)) + qty;
    product.stockQty = nextQty;
    product.stock = nextQty > 0 ? 'in' : 'out';
    await product.save({ session });
  }
};

const checkout = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const { addressId, shippingAddress, paymentMethod } = req.body || {};
    const address = resolveShippingAddress({ addressId, shippingAddress, user: req.user });
    let createdOrderId = null;
    const checkoutLockToken = crypto.randomBytes(16).toString('hex');
    const lockExpiryMs = 2 * 60 * 1000;

    const lockedCart = await Cart.findOneAndUpdate(
      {
        userId: req.auth.userId,
        'items.0': { $exists: true },
        $or: [
          { checkoutLockedAt: { $exists: false } },
          { checkoutLockedAt: null },
          { checkoutLockedAt: { $lte: new Date(Date.now() - lockExpiryMs) } },
        ],
      },
      { $set: { checkoutLockToken, checkoutLockedAt: new Date() } },
      { new: true },
    );

    if (!lockedCart) {
      throw new AppError('Checkout already in progress. Please try again.', 409);
    }

    await session.withTransaction(async () => {
      const cart = await Cart.findOne({ userId: req.auth.userId, checkoutLockToken }).session(session);
      if (!cart) throw new AppError('Checkout lock lost. Please try again.', 409);
      if (!cart.items || cart.items.length === 0) throw new AppError('Cart is empty', 400);

      const productIds = cart.items.map((item) => item.productId);
      const products = await Product.find({ _id: { $in: productIds } }).session(session);
      const productById = new Map(products.map((product) => [product._id.toString(), product]));
      const orderItems = [];

      for (const cartItem of cart.items) {
        const product = productById.get(String(cartItem.productId));
        if (!product) throw new AppError('Product not found for an item in cart', 400);
        if (!product.visible) throw new AppError(`Product not available: ${product.name}`, 400);
        if (product.stock === 'out') throw new AppError(`Out of stock: ${product.name}`, 400);

        const qty = Number(cartItem.qty || 0);
        if (!Number.isFinite(qty) || qty < 1) throw new AppError(`Invalid quantity for: ${product.name}`, 400);

        const unitPrice = Number(product.price || 0);
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
          throw new AppError(`Cannot checkout B2B/quote-only product: ${product.name}`, 400);
        }

        const trackedQty = Number(product.stockQty);
        const hasTrackedInventory = Number.isFinite(trackedQty);
        if (!hasTrackedInventory) {
          throw new AppError(`Inventory is not configured for: ${product.name}`, 409);
        }

        const updated = await Product.findOneAndUpdate(
          { _id: product._id, visible: true, stock: { $ne: 'out' }, stockQty: { $gte: qty } },
          { $inc: { stockQty: -qty } },
          { new: true, session },
        );
        if (!updated) throw new AppError(`Insufficient stock for: ${product.name}`, 409);

        updated.stock = Number(updated.stockQty || 0) > 0 ? 'in' : 'out';
        await updated.save({ session });

        orderItems.push({
          productId: product._id,
          name: product.name,
          sku: product.sku,
          hsnCode: product.hsnCode,
          brand: product.brand,
          category: product.category,
          mode: product.mode,
          qty,
          unitPrice,
          lineTotal: round2(unitPrice * qty),
          gstRate: DEFAULT_GST_RATE,
        });
      }

      const settings = await AppSetting.getSiteSettings();
      const flags = settings?.featureFlags || {};
      const codEnabled = flags.codEnabled !== false;
      const onlinePaymentEnabled = flags.onlinePaymentEnabled !== false;
      const pm = String(paymentMethod || '').trim().toLowerCase();

      if (!pm) throw new AppError('paymentMethod is required', 422);
      if (pm === 'cod' && !codEnabled) throw new AppError('Cash on delivery is currently disabled', 409);
      if (pm !== 'cod' && !onlinePaymentEnabled) throw new AppError('Online payment is currently disabled', 409);
      const businessState = settings?.shipping?.businessState || 'Maharashtra';
      const totals = calcCartTotals({ items: orderItems, shippingState: address.state, businessState });
      const paymentStatus = pm === 'cod' ? 'cod_pending' : 'pending';

      const [order] = await Order.create(
        [
          {
            userId: req.auth.userId,
            orderNumber: createOrderNumber(),
            status: 'created',
            paymentStatus,
            paymentMethod: pm || 'card',
            paymentProvider: pm === 'cod' ? 'cod' : 'razorpay',
            statusHistory: [{ status: 'created', note: 'Order placed', at: new Date(), byUserId: req.auth.userId }],
            items: orderItems,
            subtotal: totals.subtotal,
            gstTotal: totals.gstTotal,
            grandTotal: totals.grandTotal,
            gstBreakdown: totals.breakdown,
            shippingAddress: address,
            gstDetails: req.user.gst,
          },
        ],
        { session },
      );

      cart.items = [];
      cart.checkoutLockToken = undefined;
      cart.checkoutLockedAt = undefined;
      await cart.save({ session });

      createdOrderId = order._id;
    });

    const order = await Order.findById(createdOrderId);
    if (order) await notifyOrderEvent({ order, event: 'placed' });

    return sendSuccess(res, { statusCode: 201, message: 'Order created', data: order });
  } catch (err) {
    try {
      await Cart.updateOne(
        { userId: req.auth?.userId, checkoutLockToken },
        { $unset: { checkoutLockToken: '', checkoutLockedAt: '' } },
      );
    } catch {
      // swallow unlock failures
    }
    return next(err);
  } finally {
    await session.endSession();
  }
};

const getMyOrderTimeline = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findOne({ _id: id, userId: req.auth.userId }).select('status statusHistory shipmentHistory createdAt updatedAt');
    if (!order) return next(new AppError('Order not found', 404));
    return sendSuccess(res, { data: { status: order.status, timeline: buildUnifiedTimeline(order) } });
  } catch (err) {
    return next(err);
  }
};

const cancelMyOrder = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim();
    let updatedOrderId = null;
    let shouldAutoRefund = false;

    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: id, userId: req.auth.userId }).session(session);
      if (!order) throw new AppError('Order not found', 404);
      if (!canCancelOrderStatus(order.status)) throw new AppError('Order can no longer be cancelled', 409);

      await restoreOrderStock({ order, session });

      order.status = 'cancelled';
      order.cancelledAt = new Date();
      order.cancelReason = reason || 'Cancelled by customer';
      if (order.paymentStatus === 'paid') order.paymentStatus = 'refund_pending';
      if (order.paymentStatus === 'refund_pending') shouldAutoRefund = true;
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({
        status: 'cancelled',
        note: order.cancelReason,
        at: new Date(),
        byUserId: req.auth.userId,
      });
      await order.save({ session });
      updatedOrderId = order._id;
    });

    const order = await Order.findById(updatedOrderId);
    if (order && shouldAutoRefund) {
      try {
        await autoRefundForOrder({
          orderId: order._id,
          reason: order.cancelReason || 'Order cancelled',
          actorUserId: req.auth.userId,
          actorRole: req.auth.role,
        });
      } catch {
        // keep cancellation successful even if refund fails
      }
    }
    return sendSuccess(res, { message: 'Order cancelled', data: order });
  } catch (err) {
    return next(err);
  } finally {
    await session.endSession();
  }
};

const createReturnRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason, details, items } = req.body || {};

    const order = await Order.findOne({ _id: id, userId: req.auth.userId });
    if (!order) return next(new AppError('Order not found', 404));
    if (!['paid', 'processing', 'delivered'].includes(order.status)) {
      return next(new AppError('Return request is not allowed for this order status', 409));
    }

    const safeReason = String(reason || '').trim();
    if (!safeReason) return next(new AppError('reason is required', 422));

    const existingOpen = await ReturnRequest.findOne({
      orderId: order._id,
      userId: req.auth.userId,
      status: { $in: ['requested', 'approved', 'received'] },
    });
    if (existingOpen) return next(new AppError('An active return request already exists for this order', 409));

    const requestedItems =
      Array.isArray(items) && items.length
        ? items
            .map((entry) => {
              const match = (order.items || []).find((item) => String(item.productId) === String(entry?.productId));
              if (!match) return null;
              const qty = Math.max(1, Math.min(Number(entry?.qty || 1), Number(match.qty || 1)));
              return { productId: match.productId, name: match.name, qty };
            })
            .filter(Boolean)
        : (order.items || []).map((item) => ({ productId: item.productId, name: item.name, qty: item.qty }));

    const doc = await ReturnRequest.create({
      orderId: order._id,
      userId: req.auth.userId,
      orderNumber: order.orderNumber,
      status: 'requested',
      refundStatus: order.paymentStatus === 'paid' ? 'pending' : 'not_applicable',
      reason: safeReason,
      details: String(details || '').trim(),
      items: requestedItems,
      timeline: [{ status: 'requested', note: safeReason, at: new Date(), byUserId: req.auth.userId }],
    });

    return sendSuccess(res, { statusCode: 201, message: 'Return request created', data: doc });
  } catch (err) {
    return next(err);
  }
};

const listMyReturnRequests = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findOne({ _id: id, userId: req.auth.userId }).select('_id');
    if (!order) return next(new AppError('Order not found', 404));

    const items = await ReturnRequest.find({ orderId: order._id, userId: req.auth.userId }).sort({ createdAt: -1 });
    return sendSuccess(res, { data: items });
  } catch (err) {
    return next(err);
  }
};

const adminUpdateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    const order = await Order.findById(id);
    if (!order) return next(new AppError('Order not found', 404));

    order.status = status;
    if (status === 'paid') order.paymentStatus = 'paid';
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({ status, note, at: new Date(), byUserId: req.auth.userId });
    await order.save();

    if (status === 'shipped') await notifyOrderEvent({ order, event: 'shipped' });
    if (status === 'delivered') await notifyOrderEvent({ order, event: 'delivered' });

    return sendSuccess(res, { message: 'Order status updated', data: order });
  } catch (err) {
    return next(err);
  }
};

const getMyInvoiceHtml = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findOne({ _id: id, userId: req.auth.userId });
    if (!order) return next(new AppError('Order not found', 404));

    await ensureInvoiceIssued(order);
    const settings = await AppSetting.getSiteSettings();
    const seller = buildInvoiceSellerProfile(settings);
    const gstBreakdown = order.gstBreakdown || {};
    const gstin = order?.gstDetails?.number || 'Unregistered';

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Invoice ${order.invoiceNumber}</title>
    <style>
      *{box-sizing:border-box}body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
      .wrap{max-width:900px;margin:0 auto;padding:28px}
      .card{background:#fff;border:1px solid rgba(15,23,42,.12);border-radius:16px;padding:22px}
      h1{margin:0;font-size:18px}
      .muted{color:#64748b;font-size:12px;line-height:18px}
      .brand{font-size:22px;font-weight:800;color:#001b65}
      .pill{display:inline-block;padding:4px 10px;border-radius:999px;background:#e6f9ff;color:#005a70;font-size:11px;font-weight:700}
      table{width:100%;border-collapse:collapse;margin-top:14px}
      th,td{padding:10px;border-bottom:1px solid rgba(15,23,42,.08);text-align:left;font-size:12px}
      th{color:#001b65}
      .total{display:flex;justify-content:flex-end;gap:18px;margin-top:14px}
      .total div{min-width:160px}
      .k{color:#64748b;font-weight:700;font-size:12px}
      .v{color:#0f172a;font-weight:800;font-size:12px}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}
      .box{padding:14px;border:1px solid rgba(15,23,42,.08);border-radius:12px;background:#f8fafc}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div class="brand">${seller.name}</div>
            <div class="muted">${seller.address}</div>
            <div class="muted">GSTIN: ${seller.gstin}</div>
            <div class="muted">${seller.phone ? `Phone: ${seller.phone}` : ''} ${seller.email ? `| Email: ${seller.email}` : ''}</div>
            <div style="margin-top:8px" class="pill">Tax Invoice</div>
            <div class="muted">Invoice: ${order.invoiceNumber}</div>
            <div class="muted">Order: ${order.orderNumber}</div>
            <div class="muted">Date: ${new Date(order.invoiceIssuedAt || order.createdAt).toLocaleString('en-IN')}</div>
          </div>
          <div>
            <div class="muted" style="font-weight:800;color:#001b65">Ship To</div>
            <div class="muted">${order.shippingAddress.fullName || ''}</div>
            <div class="muted">${order.shippingAddress.mobile || ''}</div>
            <div class="muted">${order.shippingAddress.line1 || ''}</div>
             <div class="muted">${order.shippingAddress.line2 || ''}</div>
             <div class="muted">${order.shippingAddress.city || ''}, ${order.shippingAddress.state || ''} ${order.shippingAddress.pincode || ''}</div>
             <div class="muted">Buyer GSTIN: ${gstin}</div>
           </div>
         </div>

         <div class="grid">
           <div class="box">
             <div class="k">Place of Supply</div>
             <div class="v">${order.shippingAddress.state || settings?.shipping?.businessState || 'Maharashtra'}</div>
           </div>
           <div class="box">
             <div class="k">Payment Method</div>
             <div class="v">${String(order.paymentMethod || '').toUpperCase() || '-'}</div>
           </div>
         </div>

         <table>
           <thead>
             <tr>
               <th>Item</th>
               <th>HSN/SAC</th>
               <th>Qty</th>
               <th>Unit Price</th>
               <th>GST %</th>
               <th>Line Total</th>
             </tr>
           </thead>
           <tbody>
             ${order.items
               .map(
                 (it) => `
              <tr>
                <td>${it.name}</td>
                <td>${it.hsnCode || '-'}</td>
                <td>${it.qty}</td>
                <td>Rs ${formatMoney(it.unitPrice)}</td>
                <td>${Number(it.gstRate || 0)}%</td>
                <td>Rs ${formatMoney(it.lineTotal)}</td>
              </tr>`,
               )
               .join('')}
           </tbody>
         </table>

         <div class="total">
           <div>
             <div class="k">Subtotal</div>
             <div class="v">Rs ${formatMoney(order.subtotal)}</div>
           </div>
           <div>
             <div class="k">GST Total</div>
             <div class="v">Rs ${formatMoney(order.gstTotal)}</div>
           </div>
           <div>
             <div class="k">Grand Total</div>
             <div class="v">Rs ${formatMoney(order.grandTotal)}</div>
           </div>
         </div>
         <div class="grid">
           <div class="box">
             <div class="k">GST Breakdown</div>
             <div class="muted">IGST: Rs ${formatMoney(gstBreakdown.igst)}</div>
             <div class="muted">CGST: Rs ${formatMoney(gstBreakdown.cgst)}</div>
             <div class="muted">SGST: Rs ${formatMoney(gstBreakdown.sgst)}</div>
           </div>
           <div class="box">
             <div class="k">Declaration</div>
             <div class="muted">This is a computer-generated GST invoice for medical equipment supplied by ${seller.name}.</div>
           </div>
         </div>
       </div>
     </div>
   </body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    return next(err);
  }
};

const downloadMyInvoicePdf = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findOne({ _id: id, userId: req.auth.userId });
    if (!order) return next(new AppError('Order not found', 404));

    await ensureInvoiceIssued(order);
    const settings = await AppSetting.getSiteSettings();
    const seller = buildInvoiceSellerProfile(settings);
    const gstBreakdown = order.gstBreakdown || {};
    const buyerGstin = order?.gstDetails?.number || 'Unregistered';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${order.invoiceNumber}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    doc.fontSize(20).fillColor('#001B65').text(seller.name, { bold: true });
    doc.moveDown(0.5);
    doc.fillColor('#0F172A').fontSize(11).text(`Tax Invoice`);
    doc.fontSize(12).text(`Invoice: ${order.invoiceNumber}`);
    doc.text(`Order: ${order.orderNumber}`);
    doc.text(`Date: ${new Date(order.invoiceIssuedAt || order.createdAt).toLocaleString('en-IN')}`);
    doc.text(`Seller GSTIN: ${seller.gstin}`);
    if (seller.address) doc.text(`Seller Address: ${seller.address}`);
    if (seller.phone || seller.email) doc.text(`Contact: ${[seller.phone, seller.email].filter(Boolean).join(' | ')}`);
    doc.moveDown();

    doc.fontSize(12).text('Ship To:', { underline: true });
    const a = order.shippingAddress;
    doc.text(`${a.fullName || ''} ${a.mobile ? `(${a.mobile})` : ''}`.trim());
    doc.text(a.line1 || '');
    if (a.line2) doc.text(a.line2);
    doc.text(`${a.city || ''}, ${a.state || ''} ${a.pincode || ''}`.trim());
    doc.text(`Buyer GSTIN: ${buyerGstin}`);
    doc.moveDown();

    doc.fontSize(12).text('Items:', { underline: true });
    order.items.forEach((it) => {
      doc.text(`${it.name} | HSN: ${it.hsnCode || '-'} | Qty: ${it.qty} | Rate: Rs ${formatMoney(it.unitPrice)} | GST: ${Number(it.gstRate || 0)}% | Total: Rs ${formatMoney(it.lineTotal)}`);
    });

    doc.moveDown();
    doc.fontSize(12).text(`Subtotal: Rs ${formatMoney(order.subtotal)}`);
    doc.text(`IGST: Rs ${formatMoney(gstBreakdown.igst)}`);
    doc.text(`CGST: Rs ${formatMoney(gstBreakdown.cgst)}`);
    doc.text(`SGST: Rs ${formatMoney(gstBreakdown.sgst)}`);
    doc.text(`GST Total: Rs ${formatMoney(order.gstTotal)}`);
    doc.fontSize(13).text(`Grand Total: Rs ${formatMoney(order.grandTotal)}`);
    doc.moveDown();
    doc.fontSize(10).fillColor('#475569').text(`This is a computer-generated GST compliant invoice issued by ${seller.name}.`);

    doc.end();
  } catch (err) {
    return next(err);
  }
};

const listMyOrders = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Order.find({ userId: req.auth.userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Order.countDocuments({ userId: req.auth.userId }),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

const getMyOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findOne({ _id: id, userId: req.auth.userId });
    if (!order) return next(new AppError('Order not found', 404));
    return sendSuccess(res, { data: order });
  } catch (err) {
    return next(err);
  }
};

const adminListOrders = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;
    const { status, paymentStatus, q } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;
    if (q) {
      filter.$or = [
        { orderNumber: new RegExp(q, 'i') },
        { trackingId: new RegExp(q, 'i') },
        { invoiceNumber: new RegExp(q, 'i') },
        { 'shippingAddress.fullName': new RegExp(q, 'i') },
        { 'shippingAddress.mobile': new RegExp(q, 'i') },
        { 'items.name': new RegExp(q, 'i') },
        { 'items.sku': new RegExp(q, 'i') },
      ];
    }

    const [items, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Order.countDocuments(filter),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

const adminListReturnRequests = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;
    const { status, q } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (q) {
      filter.$or = [{ orderNumber: new RegExp(q, 'i') }, { reason: new RegExp(q, 'i') }];
    }

    const [items, total] = await Promise.all([
      ReturnRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      ReturnRequest.countDocuments(filter),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

const adminUpdateReturnRequestStatus = async (req, res, next) => {
  try {
    const { returnId } = req.params;
    const { status, note, refundStatus } = req.body || {};

    const doc = await ReturnRequest.findById(returnId);
    if (!doc) return next(new AppError('Return request not found', 404));

    doc.status = status;
    if (refundStatus) doc.refundStatus = refundStatus;
    doc.timeline = doc.timeline || [];
    doc.timeline.push({ status, note, at: new Date(), byUserId: req.auth.userId });
    await doc.save();

    if (String(status || '').toLowerCase() === 'approved') {
      try {
        const order = await Order.findById(doc.orderId);
        if (order && order.paymentProvider === 'razorpay' && String(order.paymentStatus || '') === 'paid') {
          const refund = await autoRefundForOrder({
            orderId: order._id,
            reason: note || 'Return approved',
            actorUserId: req.auth.userId,
            actorRole: req.auth.role,
          });

          if (refund) {
            doc.refundStatus = refund.status === 'processed' ? 'processed' : 'pending';
            if (refund.status === 'processed') {
              doc.status = 'refunded';
              doc.timeline = doc.timeline || [];
              doc.timeline.push({ status: 'refunded', note: 'Refund processed', at: new Date(), byUserId: req.auth.userId });
            }
            await doc.save();
          }
        }
      } catch {
        // return approval should still succeed even if refund fails
      }
    }

    return sendSuccess(res, { message: 'Return request updated', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminGetOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);
    if (!order) return next(new AppError('Order not found', 404));
    return sendSuccess(res, { data: order });
  } catch (err) {
    return next(err);
  }
};

const adminDeleteOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);
    if (!order) return next(new AppError('Order not found', 404));

    const paymentState = String(order.paymentStatus || '');
    const orderState = String(order.status || '');
    const canDelete =
      ['created', 'cancelled'].includes(orderState) &&
      !['paid', 'authorized', 'refund_pending', 'refunded', 'partially_refunded'].includes(paymentState);

    if (!canDelete) {
      return next(new AppError('Only unpaid created or cancelled orders can be deleted', 409));
    }

    await Order.deleteOne({ _id: order._id });
    return sendSuccess(res, { message: 'Order deleted' });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  checkout,
  listMyOrders,
  adminListOrders,
  adminGetOrder,
  getMyOrder,
  getMyOrderTimeline,
  cancelMyOrder,
  createReturnRequest,
  listMyReturnRequests,
  adminListReturnRequests,
  adminUpdateReturnRequestStatus,
  adminUpdateOrderStatus,
  adminDeleteOrder,
  getMyInvoiceHtml,
  downloadMyInvoicePdf,
};
