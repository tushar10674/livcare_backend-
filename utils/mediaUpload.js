const path = require('path');
const fs = require('fs');

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

const looksLikeImage = (buf) => {
  if (!buf || buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
  return false;
};

const getFileBuffer = async (file) => {
  if (!file) return null;
  if (Buffer.isBuffer(file.buffer)) return file.buffer;
  if (file.path) return fs.promises.readFile(file.path);
  return null;
};

const assertValidImageFile = async (file) => {
  if (!file) {
    const err = new Error('file is required');
    err.statusCode = 422;
    throw err;
  }

  const mimeType = String(file.mimetype || '').toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    const err = new Error('Only JPEG, PNG, GIF, and WebP images are allowed');
    err.statusCode = 422;
    throw err;
  }

  const size = Number(file.size || 0);
  if (size <= 0 || size > MAX_IMAGE_SIZE_BYTES) {
    const err = new Error('Image size must be between 1 byte and 10MB');
    err.statusCode = 422;
    throw err;
  }

  const buffer = await getFileBuffer(file);
  if (!buffer || !looksLikeImage(buffer)) {
    const err = new Error('Invalid image file');
    err.statusCode = 422;
    throw err;
  }

  return buffer;
};

const ensureUploadDir = async () => {
  const uploadDir = path.join(__dirname, '..', 'uploads');
  await fs.promises.mkdir(uploadDir, { recursive: true });
  return uploadDir;
};

const makeSafeFileName = (originalName = 'upload') => {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '';
  return `img_${Date.now()}_${Math.round(Math.random() * 1e9)}${safeExt}`;
};

module.exports = {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  assertValidImageFile,
  ensureUploadDir,
  getFileBuffer,
  makeSafeFileName,
};
