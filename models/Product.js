const mongoose = require('mongoose');

const PRODUCT_MODES = ['retail', 'wholesale'];
const PRODUCT_STOCK_STATUSES = ['in', 'out'];

const normalizeMode = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'retail') return 'retail';
  if (raw === 'wholesale') return 'wholesale';
  if (raw === 'b2b') return 'wholesale';
  return raw;
};

const slugify = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

const buildUniqueSlug = async (doc, baseSlug) => {
  const ProductModel = doc.constructor;
  const fallback = `product-${doc._id || new mongoose.Types.ObjectId().toString()}`;
  const seed = baseSlug || fallback;

  let candidate = seed;
  let suffix = 1;

  while (
    await ProductModel.exists({
      slug: candidate,
      _id: { $ne: doc._id },
    })
  ) {
    candidate = `${seed}-${suffix}`;
    suffix += 1;
  }

  return candidate;
};

const specSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    slug: { type: String, trim: true, unique: true, sparse: true, index: true },
    sub: { type: String, trim: true },
    brand: { type: String, trim: true, index: true },
    category: { type: String, required: true, trim: true, index: true },
    sku: { type: String, trim: true, unique: true, sparse: true, index: true },
    hsnCode: { type: String, trim: true, index: true },
    stock: { type: String, enum: PRODUCT_STOCK_STATUSES, default: 'in', index: true },
    stockQty: { type: Number, default: 0, min: 0 },
    mode: {
      type: String,
      required: true,
      enum: PRODUCT_MODES,
      set: normalizeMode,
      index: true,
    },
    visible: { type: Boolean, default: true, index: true },
    imageUrl: {
      type: String,
      trim: true,
      validate: {
        validator: (value) => !value || /^https?:\/\/.+/i.test(String(value)),
        message: 'imageUrl must be a valid URL',
      },
    },
    images: [
      {
        type: String,
        trim: true,
        validate: {
          validator: (value) => !value || /^https?:\/\/.+/i.test(String(value)),
          message: 'images must contain valid URLs',
        },
      },
    ],

    description: { type: String, trim: true },
    shortDescription: { type: String, trim: true },

    certifications: [{ type: String, trim: true, index: true }],
    certs: [{ type: String, trim: true }],
    specs: { type: [specSchema], default: [] },

    price: { type: Number, required: true, min: 0 },
    mrp: { type: Number },
    priceLabel: { type: String, trim: true },
    subtitle: { type: String, trim: true },

    sortRank: { type: Number, default: 0, index: true },
  },
  { timestamps: true },
);

productSchema.pre('validate', async function preValidate() {
  if (this.isModified('name')) {
    this.name = String(this.name || '').trim();
  }

  if (typeof this.category === 'string') this.category = this.category.trim();
  if (typeof this.mode !== 'undefined') this.mode = normalizeMode(this.mode);

  if (typeof this.stockQty === 'number' && Number.isFinite(this.stockQty)) {
    this.stock = this.stockQty > 0 ? 'in' : 'out';
  }

  if ((this.isModified('name') || !this.slug) && this.name) {
    this.slug = await buildUniqueSlug(this, slugify(this.name));
  }
});

productSchema.index({ name: 'text', brand: 'text', category: 'text', sku: 'text' });

productSchema.statics.normalizeMode = normalizeMode;
productSchema.statics.slugify = slugify;

module.exports = mongoose.model('Product', productSchema);
