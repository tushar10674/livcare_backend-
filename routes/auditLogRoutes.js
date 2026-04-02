const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { listAuditLogs } = require('../controllers/auditLogController');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin'), listAuditLogs);

module.exports = router;
