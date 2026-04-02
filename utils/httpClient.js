const http = require('http');
const https = require('https');

const buildBasicAuth = (username, password) =>
  `Basic ${Buffer.from(`${String(username || '')}:${String(password || '')}`).toString('base64')}`;

const httpRequest = async (url, { method = 'GET', headers, body } = {}) => {
  const target = new URL(url);
  const transport = target.protocol === 'http:' ? http : https;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      target,
      {
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const contentType = String(res.headers['content-type'] || '').toLowerCase();
          let payload = raw;
          if (contentType.includes('application/json') && raw) {
            try {
              payload = JSON.parse(raw);
            } catch {
              payload = raw;
            }
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(payload);
            return;
          }

          const message =
            (payload && typeof payload === 'object' && (payload.message || payload.error || payload.msg)) ||
            (typeof payload === 'string' && payload) ||
            `HTTP ${res.statusCode}`;
          const err = new Error(String(message));
          err.status = res.statusCode;
          err.payload = payload;
          reject(err);
        });
      },
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
};

module.exports = {
  buildBasicAuth,
  httpRequest,
};
