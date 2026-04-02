const express = require('express');

const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const productRoutes = require('./productRoutes');
const enquiryRoutes = require('./enquiryRoutes');
const appointmentRoutes = require('./appointmentRoutes');
const contactRoutes = require('./contactRoutes');
const cartRoutes = require('./cartRoutes');
const orderRoutes = require('./orderRoutes');
const trackingRoutes = require('./trackingRoutes');
const ticketRoutes = require('./ticketRoutes');
const ticketCommentRoutes = require('./ticketCommentRoutes');
const serviceRequestRoutes = require('./serviceRequestRoutes');
const amcQuoteRoutes = require('./amcQuoteRoutes');
const paymentRoutes = require('./paymentRoutes');
const cmsRoutes = require('./cmsRoutes');
const notificationRoutes = require('./notificationRoutes');
const adminReportRoutes = require('./adminReportRoutes');
const auditLogRoutes = require('./auditLogRoutes');
const settingsRoutes = require('./settingsRoutes');
const uploadRoutes = require('./uploadRoutes');
const imagekitRoutes = require('./imagekitRoutes');
const firebaseRoutes = require('./firebaseRoutes');
const { auditAdminMutations } = require('../utils/audit');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ success: true, message: 'OK' });
});

router.use(auditAdminMutations);

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/products', productRoutes);
router.use('/enquiries', enquiryRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/contact', contactRoutes);
router.use('/cart', cartRoutes);
router.use('/orders', orderRoutes);
router.use('/tracking', trackingRoutes);
router.use('/tickets', ticketRoutes);
router.use('/tickets/comments', ticketCommentRoutes);
router.use('/service-requests', serviceRequestRoutes);
router.use('/amc-quotes', amcQuoteRoutes);
router.use('/payments', paymentRoutes);
router.use('/cms', cmsRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin/reports', adminReportRoutes);
router.use('/admin/audit-logs', auditLogRoutes);
router.use('/uploads', uploadRoutes);
router.use('/imagekit', imagekitRoutes);
router.use('/settings', settingsRoutes);
router.use('/firebase', firebaseRoutes);

module.exports = router;
