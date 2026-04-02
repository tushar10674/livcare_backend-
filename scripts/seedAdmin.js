const mongoose = require('mongoose');

const { connectDB } = require('../config/db');
const { env, requireEnv } = require('../config/env');
const User = require('../models/User');

const run = async () => {
  const email = process.argv[2] || 'admin@livcare.local';
  const password = process.argv[3] || 'Admin@123';
  const fullName = process.argv[4] || 'Livcare Admin';

  requireEnv('MONGODB_URI');
  requireEnv('JWT_SECRET');

  await connectDB(env.mongoUri);

  const existing = await User.findOne({ email: String(email).toLowerCase() }).select('+password');

  if (!existing) {
    await User.create({
      fullName,
      email: String(email).toLowerCase(),
      password,
      role: 'admin',
      isActive: true,
      isEmailVerified: true,
    });

    // eslint-disable-next-line no-console
    console.log(`Created admin user: ${email}`);
  } else {
    existing.fullName = fullName;
    existing.password = password;
    existing.role = 'admin';
    existing.isActive = true;
    existing.isEmailVerified = true;

    await existing.save();

    // eslint-disable-next-line no-console
    console.log(`Updated existing user to admin: ${email}`);
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('seedAdmin failed:', err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
