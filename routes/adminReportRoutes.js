const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  adminDashboardMetrics,
  salesReport,
  conversionReport,
  productAnalytics,
  enquiryAnalytics,
} = require('../controllers/adminReportController');

const router = express.Router();

router.get('/metrics', requireAuth, requireRole('admin'), adminDashboardMetrics);
router.get('/sales', requireAuth, requireRole('admin'), salesReport);
router.get('/conversion', requireAuth, requireRole('admin'), conversionReport);
router.get('/products', requireAuth, requireRole('admin'), productAnalytics);
router.get('/enquiries', requireAuth, requireRole('admin'), enquiryAnalytics);

module.exports = router;
