const { validationResult } = require('express-validator');
const { AppError } = require('../utils/AppError');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const details = errors.array().map((e) => ({
    field: e.path,
    message: e.msg,
  }));

  const message = details.map((entry) => `${entry.field}: ${entry.message}`).join(', ');
  return next(new AppError(`Validation failed: ${message}`, 422, details));
};

module.exports = { validate };
