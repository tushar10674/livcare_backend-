const mongoose = require('mongoose');

const zoneChargeSchema = new mongoose.Schema(
  {
    zoneKey: { type: String, required: true, trim: true },
    label: { type: String, trim: true },
    states: { type: [String], default: [] },
    cities: { type: [String], default: [] },
    shippingCharge: { type: Number, default: 0, min: 0 },
    freeShippingMinOrder: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const serviceableCitySchema = new mongoose.Schema(
  {
    city: { type: String, required: true, trim: true },
    state: { type: String, trim: true, default: '' },
    zoneKey: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

const contactSchema = new mongoose.Schema(
  {
    supportPhone: { type: String, trim: true, default: '+91 1800-123-4567' },
    supportEmail: { type: String, trim: true, default: 'support@livcare.com' },
    whatsappNumber: { type: String, trim: true, default: '9118001234567' },
    supportHours: { type: String, trim: true, default: 'Mon-Sat, 9 AM - 6 PM' },
  },
  { _id: false },
);

const shippingSchema = new mongoose.Schema(
  {
    defaultEtaDaysMin: { type: Number, default: 3, min: 0 },
    defaultEtaDaysMax: { type: Number, default: 7, min: 0 },
    freeShippingMinOrder: { type: Number, default: 0, min: 0 },
    defaultShippingCharge: { type: Number, default: 0, min: 0 },
    businessCity: { type: String, trim: true, default: 'Mumbai' },
    businessState: { type: String, trim: true, default: 'Maharashtra' },
    zoneCharges: { type: [zoneChargeSchema], default: [] },
    serviceableCities: { type: [serviceableCitySchema], default: [] },
  },
  { _id: false },
);

const featureFlagsSchema = new mongoose.Schema(
  {
    codEnabled: { type: Boolean, default: true },
    onlinePaymentEnabled: { type: Boolean, default: true },
    maintenanceMode: { type: Boolean, default: false },
  },
  { _id: false },
);

const appSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'site' },
    site: {
      siteName: { type: String, trim: true, default: 'Livcare Medical Systems' },
      logoUrl: { type: String, trim: true, default: '' },
      bannerUrl: { type: String, trim: true, default: '' },
      footerText: { type: String, trim: true, default: '' },
    },
    catalog: {
      mrpVisible: { type: Boolean, default: true },
    },
    contact: { type: contactSchema, default: () => ({}) },
    shipping: { type: shippingSchema, default: () => ({}) },
    featureFlags: { type: featureFlagsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

appSettingSchema.statics.getSiteSettings = async function getSiteSettings() {
  const doc = await this.findOneAndUpdate(
    { key: 'site' },
    { $setOnInsert: { key: 'site' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return doc;
};

module.exports = mongoose.model('AppSetting', appSettingSchema);
