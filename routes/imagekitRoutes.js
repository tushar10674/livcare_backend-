const express = require('express');
const multer = require('multer');

const { getAuthParams, uploadFile } = require('../controllers/imagekitController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ok = /^image\//i.test(String(file.mimetype || ''));
    if (!ok) return cb(new Error('Only image files are allowed'));
    return cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get('/auth', requireAuth, requireRole('admin'), getAuthParams);
router.post('/upload', requireAuth, requireRole('admin'), upload.single('file'), uploadFile);

module.exports = router;
