const mongoose = require('mongoose');

const faqSchema = new mongoose.Schema(
  {
    category: { type: String, trim: true, index: true },
    question: { type: String, required: true, trim: true },

    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    publishedAt: { type: Date },

    draftAnswer: { type: String, default: '' },
    publishedAnswer: { type: String, default: '' },

    sortRank: { type: Number, default: 0, index: true },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

faqSchema.index({ status: 1, category: 1, sortRank: -1 });

module.exports = mongoose.model('Faq', faqSchema);
