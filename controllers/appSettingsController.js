const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const AppSetting = require('../models/AppSetting');
const AppSettingHistory = require('../models/AppSettingHistory');

const normalizeStringArray = (input = []) =>
  [...new Set((Array.isArray(input) ? input : []).map((value) => String(value || '').trim()).filter(Boolean))];

const normalizeZoneCharge = (zone = {}) => ({
  zoneKey: String(zone.zoneKey || '').trim(),
  label: String(zone.label || '').trim(),
  states: normalizeStringArray(zone.states),
  cities: normalizeStringArray(zone.cities),
  shippingCharge: Number(zone.shippingCharge || 0),
  freeShippingMinOrder: Number(zone.freeShippingMinOrder || 0),
});

const normalizeServiceableCity = (entry = {}) => ({
  city: String(entry.city || '').trim(),
  state: String(entry.state || '').trim(),
  zoneKey: String(entry.zoneKey || '').trim(),
  isActive: typeof entry.isActive === 'boolean' ? entry.isActive : true,
});

const sanitizeSettingsSnapshot = (settings) => ({
  site: {
    siteName: settings.site?.siteName || '',
    logoUrl: settings.site?.logoUrl || '',
    bannerUrl: settings.site?.bannerUrl || '',
    footerText: settings.site?.footerText || '',
  },
  catalog: {
    mrpVisible: Boolean(settings.catalog?.mrpVisible),
  },
  contact: {
    supportPhone: settings.contact?.supportPhone || '',
    supportEmail: settings.contact?.supportEmail || '',
    whatsappNumber: settings.contact?.whatsappNumber || '',
    supportHours: settings.contact?.supportHours || '',
  },
  shipping: {
    defaultEtaDaysMin: Number(settings.shipping?.defaultEtaDaysMin || 0),
    defaultEtaDaysMax: Number(settings.shipping?.defaultEtaDaysMax || 0),
    freeShippingMinOrder: Number(settings.shipping?.freeShippingMinOrder || 0),
    defaultShippingCharge: Number(settings.shipping?.defaultShippingCharge || 0),
    businessCity: settings.shipping?.businessCity || '',
    businessState: settings.shipping?.businessState || '',
    zoneCharges: (settings.shipping?.zoneCharges || []).map(normalizeZoneCharge),
    serviceableCities: (settings.shipping?.serviceableCities || []).map(normalizeServiceableCity),
  },
  featureFlags: {
    codEnabled: Boolean(settings.featureFlags?.codEnabled),
    onlinePaymentEnabled: Boolean(settings.featureFlags?.onlinePaymentEnabled),
    maintenanceMode: Boolean(settings.featureFlags?.maintenanceMode),
  },
});

const toPublicSettings = (settings) => sanitizeSettingsSnapshot(settings);

const validateSettingsPatch = (patch = {}) => {
  const errors = [];

  const min = patch.shipping?.defaultEtaDaysMin;
  const max = patch.shipping?.defaultEtaDaysMax;
  if (typeof min !== 'undefined' && Number(min) < 0) errors.push('shipping.defaultEtaDaysMin must be >= 0');
  if (typeof max !== 'undefined' && Number(max) < 0) errors.push('shipping.defaultEtaDaysMax must be >= 0');
  if (typeof min !== 'undefined' && typeof max !== 'undefined' && Number(min) > Number(max)) {
    errors.push('shipping.defaultEtaDaysMin cannot be greater than shipping.defaultEtaDaysMax');
  }

  if (typeof patch.shipping?.freeShippingMinOrder !== 'undefined' && Number(patch.shipping.freeShippingMinOrder) < 0) {
    errors.push('shipping.freeShippingMinOrder must be >= 0');
  }
  if (typeof patch.shipping?.defaultShippingCharge !== 'undefined' && Number(patch.shipping.defaultShippingCharge) < 0) {
    errors.push('shipping.defaultShippingCharge must be >= 0');
  }

  const zoneCharges = Array.isArray(patch.shipping?.zoneCharges) ? patch.shipping.zoneCharges : [];
  const seenZoneKeys = new Set();
  zoneCharges.forEach((zone, index) => {
    const zoneKey = String(zone?.zoneKey || '').trim();
    if (!zoneKey) errors.push(`shipping.zoneCharges[${index}].zoneKey is required`);
    if (zoneKey && seenZoneKeys.has(zoneKey)) errors.push(`shipping.zoneCharges[${index}].zoneKey must be unique`);
    seenZoneKeys.add(zoneKey);
    if (Number(zone?.shippingCharge || 0) < 0) errors.push(`shipping.zoneCharges[${index}].shippingCharge must be >= 0`);
    if (Number(zone?.freeShippingMinOrder || 0) < 0) errors.push(`shipping.zoneCharges[${index}].freeShippingMinOrder must be >= 0`);
  });

  const serviceableCities = Array.isArray(patch.shipping?.serviceableCities) ? patch.shipping.serviceableCities : [];
  serviceableCities.forEach((entry, index) => {
    if (!String(entry?.city || '').trim()) errors.push(`shipping.serviceableCities[${index}].city is required`);
  });

  if (patch.featureFlags) {
    const { codEnabled, onlinePaymentEnabled } = patch.featureFlags;
    if (codEnabled === false && onlinePaymentEnabled === false) {
      errors.push('At least one payment method must remain enabled');
    }
  }

  if (errors.length) throw new AppError(`Validation failed: ${errors.join(', ')}`, 400);
};

const buildChangeList = ({ previous, next, prefix = '' }) => {
  const changes = [];
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
  keys.forEach((key) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const before = previous?.[key];
    const after = next?.[key];
    if (
      before &&
      after &&
      typeof before === 'object' &&
      typeof after === 'object' &&
      !Array.isArray(before) &&
      !Array.isArray(after)
    ) {
      changes.push(...buildChangeList({ previous: before, next: after, prefix: path }));
      return;
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push(path);
  });
  return changes;
};

const getPublicAppSettings = async (req, res, next) => {
  try {
    const settings = await AppSetting.getSiteSettings();
    return sendSuccess(res, { data: toPublicSettings(settings) });
  } catch (err) {
    return next(err);
  }
};

const getAdminAppSettings = async (req, res, next) => {
  try {
    const settings = await AppSetting.getSiteSettings();
    return sendSuccess(res, { data: sanitizeSettingsSnapshot(settings) });
  } catch (err) {
    return next(err);
  }
};

const getAppSettingsHistory = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      AppSettingHistory.find({ settingKey: 'site' }).sort({ createdAt: -1 }).skip(skip).limit(limit),
      AppSettingHistory.countDocuments({ settingKey: 'site' }),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

const updateAdminAppSettings = async (req, res, next) => {
  try {
    const settings = await AppSetting.getSiteSettings();
    const patch = req.body || {};
    const previous = sanitizeSettingsSnapshot(settings);

    validateSettingsPatch(patch);

    if (typeof patch.catalog?.mrpVisible === 'boolean') {
      settings.catalog.mrpVisible = patch.catalog.mrpVisible;
    }

    if (patch.contact) {
      if (typeof patch.contact.supportPhone === 'string') settings.contact.supportPhone = patch.contact.supportPhone.trim();
      if (typeof patch.contact.supportEmail === 'string') settings.contact.supportEmail = patch.contact.supportEmail.trim().toLowerCase();
      if (typeof patch.contact.whatsappNumber === 'string') settings.contact.whatsappNumber = patch.contact.whatsappNumber.trim();
      if (typeof patch.contact.supportHours === 'string') settings.contact.supportHours = patch.contact.supportHours.trim();
    }

    if (patch.site) {
      if (typeof patch.site.siteName === 'string') settings.site.siteName = patch.site.siteName.trim();
      if (typeof patch.site.logoUrl === 'string') settings.site.logoUrl = patch.site.logoUrl.trim();
      if (typeof patch.site.bannerUrl === 'string') settings.site.bannerUrl = patch.site.bannerUrl.trim();
      if (typeof patch.site.footerText === 'string') settings.site.footerText = patch.site.footerText.trim();
    }

    if (patch.shipping) {
      if (typeof patch.shipping.defaultEtaDaysMin !== 'undefined') settings.shipping.defaultEtaDaysMin = Number(patch.shipping.defaultEtaDaysMin);
      if (typeof patch.shipping.defaultEtaDaysMax !== 'undefined') settings.shipping.defaultEtaDaysMax = Number(patch.shipping.defaultEtaDaysMax);
      if (typeof patch.shipping.freeShippingMinOrder !== 'undefined') settings.shipping.freeShippingMinOrder = Number(patch.shipping.freeShippingMinOrder);
      if (typeof patch.shipping.defaultShippingCharge !== 'undefined') settings.shipping.defaultShippingCharge = Number(patch.shipping.defaultShippingCharge);
      if (typeof patch.shipping.businessCity === 'string') settings.shipping.businessCity = patch.shipping.businessCity.trim();
      if (typeof patch.shipping.businessState === 'string') settings.shipping.businessState = patch.shipping.businessState.trim();
      if (Array.isArray(patch.shipping.zoneCharges)) settings.shipping.zoneCharges = patch.shipping.zoneCharges.map(normalizeZoneCharge);
      if (Array.isArray(patch.shipping.serviceableCities)) settings.shipping.serviceableCities = patch.shipping.serviceableCities.map(normalizeServiceableCity);
    }

    if (patch.featureFlags) {
      if (typeof patch.featureFlags.codEnabled === 'boolean') settings.featureFlags.codEnabled = patch.featureFlags.codEnabled;
      if (typeof patch.featureFlags.onlinePaymentEnabled === 'boolean') settings.featureFlags.onlinePaymentEnabled = patch.featureFlags.onlinePaymentEnabled;
      if (typeof patch.featureFlags.maintenanceMode === 'boolean') settings.featureFlags.maintenanceMode = patch.featureFlags.maintenanceMode;
    }

    await settings.save();
    const next = sanitizeSettingsSnapshot(settings);
    const changes = buildChangeList({ previous, next });

    if (changes.length) {
      await AppSettingHistory.create({
        settingKey: 'site',
        changedBy: req.auth?.userId,
        oldValue: previous,
        newValue: next,
        changes,
      });
    }

    return sendSuccess(res, {
      message: 'App settings updated',
      data: next,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getPublicAppSettings,
  getAdminAppSettings,
  getAppSettingsHistory,
  updateAdminAppSettings,
  toPublicSettings,
};
