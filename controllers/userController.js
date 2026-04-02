const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const User = require('../models/User');

const pick = (obj, allowed) => {
  const out = {};
  allowed.forEach((k) => {
    if (typeof obj[k] !== 'undefined') out[k] = obj[k];
  });
  return out;
};

const listUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      User.find({}).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments({}),
    ]);

    return sendSuccess(res, {
      data: items,
      meta: { page, limit, total },
    });
  } catch (err) {
    return next(err);
  }
};

const getMe = async (req, res, next) => {
  try {
    return sendSuccess(res, {
      data: req.user,
    });
  } catch (err) {
    return next(err);
  }
};

const updateMe = async (req, res, next) => {
  try {
    const allowed = ['fullName', 'mobile', 'organization', 'address', 'city', 'state', 'pincode'];
    const update = pick(req.body, allowed);
    const gst = typeof req.body?.gst === 'undefined' ? undefined : String(req.body.gst || '').trim();

    const updateDoc = {
      ...(Object.keys(update).length ? update : {}),
      ...(typeof gst !== 'undefined' ? { 'gst.number': gst || undefined } : {}),
    };

    const user = await User.findByIdAndUpdate(
      req.auth.userId,
      Object.keys(updateDoc).some((key) => key.includes('.')) ? { $set: updateDoc } : updateDoc,
      { new: true, runValidators: true },
    ).select('-password');
    return sendSuccess(res, { message: 'Profile updated', data: user });
  } catch (err) {
    return next(err);
  }
};

const updateMeSettings = async (req, res, next) => {
  try {
    const patch = req.body;
    const currentUser = await User.findById(req.auth.userId).select('-password');
    if (!currentUser) return next(new AppError('User not found', 404));

    const update = {};
    if (patch.notifications) {
      if (typeof patch.notifications.email === 'boolean') update['settings.notifications.email'] = patch.notifications.email;
      if (typeof patch.notifications.sms === 'boolean') update['settings.notifications.sms'] = patch.notifications.sms;
      if (typeof patch.notifications.whatsapp === 'boolean') update['settings.notifications.whatsapp'] = patch.notifications.whatsapp;
    }
    if (patch.security) {
      if (patch.security.twoFactorEnabled === true && !currentUser.isEmailVerified) {
        return next(new AppError('Verify email before enabling two-factor authentication', 400));
      }
      if (typeof patch.security.twoFactorEnabled === 'boolean') update['settings.security.twoFactorEnabled'] = patch.security.twoFactorEnabled;
    }
    if (typeof patch.marketingOptIn === 'boolean') update['settings.marketingOptIn'] = patch.marketingOptIn;

    const user = await User.findByIdAndUpdate(req.auth.userId, { $set: update }, { new: true }).select('-password');
    return sendSuccess(res, { message: 'Settings updated', data: user.settings });
  } catch (err) {
    return next(err);
  }
};

const updateMeGst = async (req, res, next) => {
  try {
    const { number, legalName, organization } = req.body;
    const update = {
      'gst.number': number,
      'gst.legalName': legalName,
      'gst.organization': organization,
    };

    const user = await User.findByIdAndUpdate(req.auth.userId, { $set: update }, { new: true }).select('-password');
    return sendSuccess(res, { message: 'GST updated', data: user.gst });
  } catch (err) {
    return next(err);
  }
};

const listMyAddresses = async (req, res, next) => {
  try {
    return sendSuccess(res, { data: req.user.addresses || [] });
  } catch (err) {
    return next(err);
  }
};

const addMyAddress = async (req, res, next) => {
  try {
    const address = req.body;

    const user = await User.findById(req.auth.userId);
    if (!user) return next(new AppError('User not found', 404));

    if (address.isDefault) {
      user.addresses.forEach((a) => {
        a.isDefault = false;
      });
    }

    user.addresses.push(address);
    await user.save();

    return sendSuccess(res, { statusCode: 201, message: 'Address added', data: user.addresses });
  } catch (err) {
    return next(err);
  }
};

const updateMyAddress = async (req, res, next) => {
  try {
    const { addressId } = req.params;
    const patch = req.body;

    const user = await User.findById(req.auth.userId);
    if (!user) return next(new AppError('User not found', 404));

    const addr = user.addresses.id(addressId);
    if (!addr) return next(new AppError('Address not found', 404));

    if (patch.isDefault) {
      user.addresses.forEach((a) => {
        a.isDefault = false;
      });
    }

    Object.keys(patch).forEach((k) => {
      addr[k] = patch[k];
    });

    await user.save();
    return sendSuccess(res, { message: 'Address updated', data: user.addresses });
  } catch (err) {
    return next(err);
  }
};

const deleteMyAddress = async (req, res, next) => {
  try {
    const { addressId } = req.params;

    const user = await User.findById(req.auth.userId);
    if (!user) return next(new AppError('User not found', 404));

    const addr = user.addresses.id(addressId);
    if (!addr) return next(new AppError('Address not found', 404));

    addr.deleteOne();
    await user.save();

    return sendSuccess(res, { message: 'Address deleted', data: user.addresses });
  } catch (err) {
    return next(err);
  }
};

const deactivateMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.auth.userId);
    if (!user) return next(new AppError('User not found', 404));

    user.isActive = false;
    user.deletedAt = new Date();
    await user.save();

    return sendSuccess(res, { message: 'Account deactivated' });
  } catch (err) {
    return next(err);
  }
};

const updateUserRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const user = await User.findById(id);
    if (!user) return next(new AppError('User not found', 404));

    user.role = role;
    await user.save();

    return sendSuccess(res, {
      message: 'User updated',
      data: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const createAdminUser = async (req, res, next) => {
  try {
    const {
      fullName,
      email,
      password,
      role = 'user',
      mobile,
      organization,
    } = req.body || {};

    const existing = await User.findOne({ email: String(email || '').trim().toLowerCase() });
    if (existing) return next(new AppError('User already exists with this email', 409));

    const user = await User.create({
      fullName: String(fullName || '').trim(),
      email: String(email || '').trim().toLowerCase(),
      password,
      role,
      mobile: String(mobile || '').trim() || undefined,
      organization: String(organization || '').trim() || undefined,
      isActive: true,
      deletedAt: undefined,
    });

    return sendSuccess(res, {
      statusCode: 201,
      message: 'User created',
      data: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const adminDeleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (String(id) === String(req.auth?.userId || '')) {
      return next(new AppError('You cannot deactivate your own admin account here', 409));
    }

    const user = await User.findById(id);
    if (!user) return next(new AppError('User not found', 404));

    user.isActive = false;
    user.deletedAt = new Date();
    await user.save();

    return sendSuccess(res, {
      message: 'User deactivated',
      data: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  listUsers,
  createAdminUser,
  adminDeleteUser,
  updateUserRole,
  getMe,
  updateMe,
  updateMeSettings,
  updateMeGst,
  listMyAddresses,
  addMyAddress,
  updateMyAddress,
  deleteMyAddress,
  deactivateMe,
};
