const mongoose = require('mongoose');

const contentPageSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['policy', 'page'],
      default: 'policy',
      index: true,
    },
    key: {
      // e.g. privacyPolicy, termsConditions, shippingPolicy
      type: String,
      required: true,
      trim: true,
      lowercase: false,
      index: true,
      unique: true,
    },
    title: { type: String, required: true, trim: true },

    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    publishedAt: { type: Date },

    // Draft content
    draft: {
      body: { type: String, default: '' },
    },

    // Published snapshot
    published: {
      body: { type: String, default: '' },
    },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

contentPageSchema.index({ type: 1, status: 1 });

module.exports = mongoose.model('ContentPage', contentPageSchema);
