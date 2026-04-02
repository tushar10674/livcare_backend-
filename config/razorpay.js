const Razorpay = require('razorpay');
const { requireEnv } = require('./env');

const getRazorpayClient = () => {
  const key_id = requireEnv('RAZORPAY_KEY_ID');
  const key_secret = requireEnv('RAZORPAY_KEY_SECRET');

  return new Razorpay({ key_id, key_secret });
};

module.exports = { getRazorpayClient };
