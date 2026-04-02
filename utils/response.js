const sendSuccess = (res, { statusCode = 200, message = 'OK', data = null, meta = null } = {}) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    meta,
  });
};

const sendError = (res, { statusCode = 500, message = 'Server Error', error = null, details = null } = {}) => {
  return res.status(statusCode).json({
    success: false,
    message,
    error,
    details,
  });
};

module.exports = { sendSuccess, sendError };
