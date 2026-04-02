const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const AppSetting = require('../models/AppSetting');
const { DEFAULT_GST_RATE, round2, calcCartTotals } = require('../utils/pricing');

const buildCartView = async ({ cart, shippingState }) => {
  const items = cart.items || [];
  const productIds = items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds } });

  const productById = new Map(products.map((p) => [p._id.toString(), p]));

  const normalizedItems = items
    .map((i) => {
      const p = productById.get(String(i.productId));
      if (!p) return null;

      const unitPrice = typeof p.price === 'number' ? p.price : 0;
      const gstRate = DEFAULT_GST_RATE;
      const lineTotal = round2(unitPrice * i.qty);

      return {
        productId: p._id,
        qty: i.qty,
        unitPrice,
        gstRate,
        lineTotal,
        product: {
          id: p._id,
          name: p.name,
          brand: p.brand,
          category: p.category,
          sku: p.sku,
          imageUrl: p.imageUrl,
          mode: p.mode,
          stock: p.stock,
          visible: p.visible,
        },
      };
    })
    .filter(Boolean);

  const settings = await AppSetting.getSiteSettings();
  const businessState = settings?.shipping?.businessState || 'Maharashtra';

  const totals = calcCartTotals({
    items: normalizedItems,
    shippingState,
    businessState,
  });

  return {
    id: cart._id,
    items: normalizedItems,
    totals,
    currency: cart.currency,
    updatedAt: cart.updatedAt,
  };
};

const getMyCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ userId: req.auth.userId });
    if (!cart) {
      return sendSuccess(res, {
        data: { items: [], totals: { subtotal: 0, gstTotal: 0, grandTotal: 0, breakdown: { type: 'igst', igst: 0, cgst: 0, sgst: 0, rate: DEFAULT_GST_RATE } } },
      });
    }

    const defaultAddr = (req.user.addresses || []).find((a) => a.isDefault) || (req.user.addresses || [])[0];
    const view = await buildCartView({ cart, shippingState: defaultAddr?.state });
    return sendSuccess(res, { data: view });
  } catch (err) {
    return next(err);
  }
};

const addToCart = async (req, res, next) => {
  try {
    const { productId, qty } = req.body;
    const quantity = Number(qty || 1);
    if (!Number.isFinite(quantity) || quantity < 1) return next(new AppError('qty must be >= 1', 422));

    const product = await Product.findById(productId);
    if (!product) return next(new AppError('Product not found', 404));
    if (!product.visible) return next(new AppError('Product not available', 400));
    if (product.stock === 'out') return next(new AppError('Product out of stock', 400));

    let cart = await Cart.findOne({ userId: req.auth.userId });
    if (!cart) cart = await Cart.create({ userId: req.auth.userId, items: [] });

    const existing = cart.items.find((i) => String(i.productId) === String(productId));
    if (existing) {
      existing.qty += quantity;
    } else {
      cart.items.push({ productId, qty: quantity });
    }

    await cart.save();

    const defaultAddr = (req.user.addresses || []).find((a) => a.isDefault) || (req.user.addresses || [])[0];
    const view = await buildCartView({ cart, shippingState: defaultAddr?.state });

    return sendSuccess(res, { message: 'Added to cart', data: view });
  } catch (err) {
    return next(err);
  }
};

const updateCartItem = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { qty } = req.body;

    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity < 1) return next(new AppError('qty must be >= 1', 422));

    const cart = await Cart.findOne({ userId: req.auth.userId });
    if (!cart) return next(new AppError('Cart is empty', 404));

    const item = cart.items.find((i) => String(i.productId) === String(productId));
    if (!item) return next(new AppError('Item not found in cart', 404));

    item.qty = quantity;
    await cart.save();

    const defaultAddr = (req.user.addresses || []).find((a) => a.isDefault) || (req.user.addresses || [])[0];
    const view = await buildCartView({ cart, shippingState: defaultAddr?.state });

    return sendSuccess(res, { message: 'Cart updated', data: view });
  } catch (err) {
    return next(err);
  }
};

const removeCartItem = async (req, res, next) => {
  try {
    const { productId } = req.params;

    const cart = await Cart.findOne({ userId: req.auth.userId });
    if (!cart) return next(new AppError('Cart is empty', 404));

    cart.items = (cart.items || []).filter((i) => String(i.productId) !== String(productId));
    await cart.save();

    const defaultAddr = (req.user.addresses || []).find((a) => a.isDefault) || (req.user.addresses || [])[0];
    const view = await buildCartView({ cart, shippingState: defaultAddr?.state });

    return sendSuccess(res, { message: 'Item removed', data: view });
  } catch (err) {
    return next(err);
  }
};

const clearCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ userId: req.auth.userId });
    if (!cart) return sendSuccess(res, { message: 'Cart cleared' });

    cart.items = [];
    await cart.save();

    return sendSuccess(res, { message: 'Cart cleared' });
  } catch (err) {
    return next(err);
  }
};

module.exports = { getMyCart, addToCart, updateCartItem, removeCartItem, clearCart };
