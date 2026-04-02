const { sendError } = require('../utils/response');

const notFound = (req, res) => {
  return sendError(res, {
    statusCode: 404,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    error: 'NotFound',
  });
};

module.exports = { notFound };
