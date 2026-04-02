const { sendError } = require('../utils/response');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const safeMessage = statusCode >= 500 && isProd ? 'Server Error' : err.message || 'Server Error';

  const payload = {
    statusCode,
    message: safeMessage,
    error: err.name || 'Error',
    details: err.details || null,
  };

  if (process.env.NODE_ENV === 'development') {
    payload.stack = err.stack;
  }

  return sendError(res, payload);
};

module.exports = { errorHandler };
