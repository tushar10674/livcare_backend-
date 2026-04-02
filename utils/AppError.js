class AppError extends Error {
  constructor(message, statusCode, details) {
    super(message);
    this.statusCode = statusCode || 500;
    this.details = details;
  }
}

module.exports = { AppError };
