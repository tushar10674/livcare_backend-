const crypto = require('crypto');

const verifyRazorpayWebhookSignature = ({ body, signature, secret }) => {
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return expected === signature;
};

const verifyRazorpayPaymentSignature = ({ razorpayOrderId, razorpayPaymentId, razorpaySignature, secret }) => {
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return expected === razorpaySignature;
};

module.exports = {
  verifyRazorpayWebhookSignature,
  verifyRazorpayPaymentSignature,
};
