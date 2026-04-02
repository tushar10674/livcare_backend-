const jwt = require('jsonwebtoken');

const signAccessToken = ({ userId, role }, { secret, expiresIn }) => {
  return jwt.sign({ sub: userId, role, typ: 'access' }, secret, { expiresIn });
};

const signRefreshToken = ({ userId, role, tokenId }, { secret, expiresIn }) => {
  return jwt.sign({ sub: userId, role, jti: tokenId, typ: 'refresh' }, secret, { expiresIn });
};

const verifyToken = (token, { secret }) => {
  return jwt.verify(token, secret);
};

module.exports = { signAccessToken, signRefreshToken, verifyToken };
