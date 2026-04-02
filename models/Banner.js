const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, default: '' },
    subtitle: { type: String, trim: true, default: '' },
    imageUrl: { type: String, required: true, trim: true },

    ctaText: { type: String, trim: true, default: '' },
    ctaLink: { type: String, trim: true, default: '' },

    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    publishedAt: { type: Date },

    draft: {
      title: { type: String, trim: true, default: '' },
      subtitle: { type: String, trim: true, default: '' },
      imageUrl: { type: String, trim: true, default: '' },
      ctaText: { type: String, trim: true, default: '' },
      ctaLink: { type: String, trim: true, default: '' },
    },

    published: {
      title: { type: String, trim: true, default: '' },
      subtitle: { type: String, trim: true, default: '' },
      imageUrl: { type: String, trim: true, default: '' },
      ctaText: { type: String, trim: true, default: '' },
      ctaLink: { type: String, trim: true, default: '' },
    },

    sortRank: { type: Number, default: 0, index: true },

    schedule: {
      startAt: { type: Date },
      endAt: { type: Date },
    },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

bannerSchema.index({ status: 1, sortRank: -1, createdAt: -1 });

module.exports = mongoose.model('Banner', bannerSchema);
