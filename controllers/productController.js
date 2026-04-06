const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const Product = require('../models/Product');
const AppSetting = require('../models/AppSetting');

const normalizeMode = (value) => Product.normalizeMode(value);

const applyCatalogVisibility = async (items) => {
  const settings = await AppSetting.getSiteSettings();
  if (settings.catalog?.mrpVisible) return items;

  const mapItem = (item) => {
    const plain = typeof item?.toObject === 'function' ? item.toObject() : { ...item };
    delete plain.mrp;
    return plain;
  };

  return Array.isArray(items) ? items.map(mapItem) : mapItem(items);
};

const parseMultiValue = (value) => {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => String(entry || '').split(','))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const sanitizeString = (value) => String(value || '').trim();

const normalizeCategoryLabel = (value) => {
  const raw = sanitizeString(value);
  if (!raw) return '';
  const collapsed = raw.replace(/\s+/g, ' ');
  const key = collapsed.toLowerCase();
  if (key === 'ics') return 'ICU';
  if (key === 'icu') return 'ICU';
  if (key === 'icu equipment') return 'ICU Equipment';
  return collapsed;
};

const sanitizeProductPayload = (payload = {}, { partial = false } = {}) => {
  const input = payload && typeof payload === 'object' ? payload : {};
  const out = {};
  const errors = [];

  const applyString = (key, { required = false } = {}) => {
    if (typeof input[key] === 'undefined') {
      if (!partial && required) errors.push(`${key} is required`);
      return;
    }
    const value = sanitizeString(input[key]);
    if (!value) {
      errors.push(`${key} is required`);
      return;
    }
    out[key] = value;
  };

  applyString('name', { required: true });
  applyString('category', { required: true });

  if (typeof input.price === 'undefined') {
    if (!partial) errors.push('price is required');
  } else {
    const price = Number(input.price);
    if (!Number.isFinite(price) || price <= 0) errors.push('price must be greater than 0');
    else out.price = price;
  }

  if (typeof input.mode === 'undefined') {
    if (!partial) errors.push('mode is required');
  } else {
    const mode = normalizeMode(input.mode);
    if (!mode || !['retail', 'wholesale'].includes(mode)) errors.push('mode must be retail or wholesale');
    else out.mode = mode;
  }

  ['sku', 'hsnCode', 'brand', 'sub', 'description', 'shortDescription', 'priceLabel', 'subtitle'].forEach((key) => {
    if (typeof input[key] === 'undefined') return;
    const value = sanitizeString(input[key]);
    if (!value) return;
    out[key] = value;
  });

  if (typeof input.visible !== 'undefined') out.visible = Boolean(input.visible);

  if (typeof input.stockQty !== 'undefined') {
    const stockQty = Number(input.stockQty);
    if (!Number.isFinite(stockQty) || stockQty < 0) errors.push('stockQty must be 0 or greater');
    else out.stockQty = stockQty;
  }

  if (typeof input.stock !== 'undefined') {
    const stock = sanitizeString(input.stock).toLowerCase();
    if (!['in', 'out'].includes(stock)) errors.push('stock must be in or out');
    else out.stock = stock;
  }

  if (typeof input.mrp !== 'undefined') {
    const mrp = Number(input.mrp);
    if (!Number.isFinite(mrp) || mrp < 0) errors.push('mrp must be 0 or greater');
    else out.mrp = mrp;
  }

  const isValidUrl = (value) => /^https?:\/\/.+/i.test(String(value || '').trim());

  if (typeof input.imageUrl !== 'undefined') {
    const imageUrl = sanitizeString(input.imageUrl);
    if (imageUrl && !isValidUrl(imageUrl)) errors.push('imageUrl must be a valid URL');
    else if (imageUrl) out.imageUrl = imageUrl;
  }

  if (typeof input.images !== 'undefined') {
    if (!Array.isArray(input.images)) errors.push('images must be an array');
    else {
      const images = input.images.map((entry) => sanitizeString(entry)).filter(Boolean);
      if (images.some((entry) => !isValidUrl(entry))) errors.push('images must contain valid URLs');
      else out.images = images;
    }
  }

  if (typeof input.certifications !== 'undefined') {
    if (!Array.isArray(input.certifications)) errors.push('certifications must be an array');
    else out.certifications = input.certifications.map((entry) => sanitizeString(entry)).filter(Boolean);
  }

  if (typeof input.certs !== 'undefined') {
    if (!Array.isArray(input.certs)) errors.push('certs must be an array');
    else out.certs = input.certs.map((entry) => sanitizeString(entry)).filter(Boolean);
  }

  if (typeof input.specs !== 'undefined') {
    if (!Array.isArray(input.specs)) errors.push('specs must be an array');
    else {
      const specs = input.specs
        .map((row) => ({
          key: sanitizeString(row?.key),
          value: sanitizeString(row?.value),
        }))
        .filter((row) => row.key && row.value);
      out.specs = specs;
    }
  }

  if (typeof input.sortRank !== 'undefined') {
    const sortRank = Number(input.sortRank);
    if (!Number.isFinite(sortRank)) errors.push('sortRank must be numeric');
    else out.sortRank = sortRank;
  }

  if (typeof out.stockQty !== 'undefined') {
    out.stock = out.stockQty > 0 ? 'in' : 'out';
  }

  return { data: out, errors };
};

const assertMergedProductValidity = (existing, patch = {}) => {
  const merged = {
    name: typeof patch.name === 'undefined' ? existing?.name : patch.name,
    category: typeof patch.category === 'undefined' ? existing?.category : patch.category,
    price: typeof patch.price === 'undefined' ? existing?.price : patch.price,
    mode: typeof patch.mode === 'undefined' ? existing?.mode : patch.mode,
  };

  const errors = [];
  if (!sanitizeString(merged.name)) errors.push('name is required');
  if (!sanitizeString(merged.category)) errors.push('category is required');
  if (!Number.isFinite(Number(merged.price)) || Number(merged.price) <= 0) errors.push('price must be greater than 0');
  if (!['retail', 'wholesale'].includes(normalizeMode(merged.mode))) errors.push('mode must be retail or wholesale');

  if (errors.length) throw new AppError(`Validation failed: ${errors.join(', ')}`, 422);
};

const listProducts = async (req, res, next) => {
  try {
    const { q, category, brand, mode, visible, stock, minPrice, maxPrice, cert, sort } = req.query;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const filter = {};

    if (typeof visible !== 'undefined') {
      filter.visible = String(visible) === 'true';
    }

    const categories = parseMultiValue(category);
    const brands = parseMultiValue(brand);
    const modes = parseMultiValue(mode).map((entry) => normalizeMode(entry)).filter(Boolean);
    const stocks = parseMultiValue(stock);

    if (categories.length) {
      filter.category = categories.length === 1 ? categories[0] : { $in: categories };
    }
    if (brands.length) {
      filter.brand = brands.length === 1 ? brands[0] : { $in: brands };
    }
    if (modes.length) {
      filter.mode = modes.length === 1 ? modes[0] : { $in: modes };
    }
    if (stocks.length) {
      filter.stock = stocks.length === 1 ? stocks[0] : { $in: stocks };
    }

    if (cert) {
      filter.$or = [{ certifications: cert }, { certs: cert }];
    }

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    if (q) {
      filter.$text = { $search: q };
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      rank: { sortRank: -1, createdAt: -1 },
    };
    const sortSpec = sortMap[String(sort || '').toLowerCase()] || { sortRank: -1, createdAt: -1 };

    const [items, total] = await Promise.all([
      Product.find(filter)
        .sort(sortSpec)
        .skip(skip)
        .limit(limit),
      Product.countDocuments(filter),
    ]);

    const visibleItems = await applyCatalogVisibility(items);

    return sendSuccess(res, {
      data: visibleItems,
      meta: { page, limit, total },
    });
  } catch (err) {
    return next(err);
  }
};

const getProductMeta = async (req, res, next) => {
  try {
    const [categories, brands, modes, stockStatuses] = await Promise.all([
      Product.distinct('category', { category: { $ne: null }, visible: true }),
      Product.distinct('brand', { brand: { $ne: null }, visible: true }),
      Product.distinct('mode', { mode: { $ne: null }, visible: true }),
      Product.distinct('stock', { stock: { $ne: null }, visible: true }),
    ]);

    const normalizedCategories = [];
    const seenCategoryKeys = new Set();
    (Array.isArray(categories) ? categories : [])
      .map((entry) => normalizeCategoryLabel(entry))
      .filter(Boolean)
      .forEach((label) => {
        const dedupeKey = label.toLowerCase();
        if (seenCategoryKeys.has(dedupeKey)) return;
        seenCategoryKeys.add(dedupeKey);
        normalizedCategories.push(label);
      });

    return sendSuccess(res, {
      data: {
        categories: normalizedCategories.sort((a, b) => a.localeCompare(b)),
        brands: brands.filter(Boolean).sort(),
        purchaseTypes: modes.filter(Boolean).sort(),
        availability: stockStatuses.filter(Boolean).sort(),
      },
    });
  } catch (err) {
    return next(err);
  }
};

const adminListProducts = async (req, res, next) => {
  try {
    const { q, category, brand, mode, visible, stock, sort } = req.query;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const skip = (page - 1) * limit;

    const filter = {};
    if (typeof visible !== 'undefined') filter.visible = String(visible) === 'true';
    if (category) filter.category = category;
    if (brand) filter.brand = brand;
    if (mode) {
      const normalizedMode = normalizeMode(mode);
      filter.mode = normalizedMode || mode;
    }
    if (stock) filter.stock = stock;
    if (q) {
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { brand: new RegExp(q, 'i') },
        { category: new RegExp(q, 'i') },
        { sku: new RegExp(q, 'i') },
        { sub: new RegExp(q, 'i') },
      ];
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      rank: { sortRank: -1, createdAt: -1 },
    };
    const sortSpec = sortMap[String(sort || '').toLowerCase()] || { sortRank: -1, createdAt: -1 };

    const [items, total] = await Promise.all([
      Product.find(filter).sort(sortSpec).skip(skip).limit(limit),
      Product.countDocuments(filter),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

const adminGetProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);
    if (!product) return next(new AppError('Product not found', 404));
    return sendSuccess(res, { data: product });
  } catch (err) {
    return next(err);
  }
};

const getProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);
    if (!product) return next(new AppError('Product not found', 404));
    const visibleProduct = await applyCatalogVisibility(product);
    return sendSuccess(res, { data: visibleProduct });
  } catch (err) {
    return next(err);
  }
};

const createProduct = async (req, res, next) => {
  try {
    const { data, errors } = sanitizeProductPayload(req.body, { partial: false });
    if (errors.length) return next(new AppError(`Validation failed: ${errors.join(', ')}`, 422));

    const product = await Product.create(data);
    return sendSuccess(res, {
      statusCode: 201,
      message: 'Product created',
      data: product,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return next(new AppError('Duplicate key', 409, err.keyValue));
    }
    return next(err);
  }
};

const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await Product.findById(id);
    if (!existing) return next(new AppError('Product not found', 404));

    const { data, errors } = sanitizeProductPayload(req.body, { partial: true });
    if (errors.length) return next(new AppError(`Validation failed: ${errors.join(', ')}`, 422));
    if (!Object.keys(data).length) return next(new AppError('Validation failed: no valid fields provided', 422));

    assertMergedProductValidity(existing, data);

    Object.assign(existing, data);
    const product = await existing.save();
    if (!product) return next(new AppError('Product not found', 404));
    return sendSuccess(res, { message: 'Product updated', data: product });
  } catch (err) {
    if (err && err.code === 11000) {
      return next(new AppError('Duplicate key', 409, err.keyValue));
    }
    return next(err);
  }
};

const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findByIdAndDelete(id);
    if (!product) return next(new AppError('Product not found', 404));
    return sendSuccess(res, { message: 'Product deleted' });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  listProducts,
  getProductMeta,
  adminListProducts,
  adminGetProduct,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
};
