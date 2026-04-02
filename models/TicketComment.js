const mongoose = require('mongoose');

const ticketCommentSchema = new mongoose.Schema(
  {
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    body: { type: String, required: true, trim: true },
    isInternal: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

ticketCommentSchema.index({ createdAt: 1 });

module.exports = mongoose.model('TicketComment', ticketCommentSchema);
