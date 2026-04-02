const mongoose = require('mongoose');

const appSettingHistorySchema = new mongoose.Schema(
  {
    settingKey: { type: String, required: true, trim: true, index: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    oldValue: { type: Object, required: true },
    newValue: { type: Object, required: true },
    changes: { type: [String], default: [] },
  },
  { timestamps: true },
);

appSettingHistorySchema.index({ settingKey: 1, createdAt: -1 });

module.exports = mongoose.model('AppSettingHistory', appSettingHistorySchema);
