const express = require('express');
const multer = require('multer');

const { uploadImage } = require('../controllers/uploadController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const fileFilter = (req, file, cb) => {
  const ok = /^image\//i.test(String(file.mimetype || ''));
  if (!ok) return cb(new Error('Only image files are allowed'));
  return cb(null, true);
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.post('/image', requireAuth, requireRole('admin'), upload.single('file'), uploadImage);

module.exports = router;
