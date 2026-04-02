const crypto = require('crypto');

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const createRandomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

module.exports = { sha256, createRandomToken };
