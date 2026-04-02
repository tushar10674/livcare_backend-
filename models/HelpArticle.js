const mongoose = require('mongoose');

const helpArticleSchema = new mongoose.Schema(
  {
    category: { type: String, trim: true, index: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },

    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    publishedAt: { type: Date },

    draftBody: { type: String, default: '' },
    publishedBody: { type: String, default: '' },

    sortRank: { type: Number, default: 0, index: true },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

helpArticleSchema.index({ status: 1, category: 1, sortRank: -1 });

module.exports = mongoose.model('HelpArticle', helpArticleSchema);
