const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  getPublishedPage,
  listPublishedBanners,
  listPublishedFaq,
  listPublishedHelp,
  getPublishedHelpArticle,
  adminListPages,
  adminUpsertPageDraft,
  adminPublishPage,
  adminUnpublishPage,
  adminListFaq,
  adminCreateFaqDraft,
  adminUpdateFaqDraft,
  adminPublishFaq,
  adminUnpublishFaq,
  adminDeleteFaq,
  adminListHelp,
  adminCreateHelpDraft,
  adminUpdateHelpDraft,
  adminPublishHelp,
  adminUnpublishHelp,
  adminDeleteHelp,
  adminListBanners,
  adminCreateBannerDraft,
  adminUpdateBannerDraft,
  adminPublishBanner,
  adminUnpublishBanner,
  adminDeleteBanner,
} = require('../controllers/cmsController');

const router = express.Router();

// Public
router.get('/pages/:key', [param('key').isString().trim().isLength({ min: 2 })], validate, getPublishedPage);
router.get('/banners', listPublishedBanners);
router.get('/faq', listPublishedFaq);
router.get('/help', listPublishedHelp);
router.get('/help/:slug', [param('slug').isString().trim().isLength({ min: 2 })], validate, getPublishedHelpArticle);

// Admin (draft/publish)
router.get('/admin/pages', requireAuth, requireRole('admin'), adminListPages);
router.put(
  '/admin/pages/:key',
  requireAuth,
  requireRole('admin'),
  [
    param('key').isString().trim().isLength({ min: 2 }),
    body('title').isString().trim().isLength({ min: 2 }),
    body('body').optional().isString(),
    body('type').optional().isIn(['policy', 'page']),
  ],
  validate,
  adminUpsertPageDraft,
);
router.put('/admin/pages/:key/publish', requireAuth, requireRole('admin'), adminPublishPage);
router.put('/admin/pages/:key/unpublish', requireAuth, requireRole('admin'), adminUnpublishPage);
router.post('/admin/pages/:key/publish', requireAuth, requireRole('admin'), adminPublishPage);
router.post('/admin/pages/:key/unpublish', requireAuth, requireRole('admin'), adminUnpublishPage);

router.get('/admin/faq', requireAuth, requireRole('admin'), adminListFaq);
router.put(
  '/admin/faq',
  requireAuth,
  requireRole('admin'),
  [
    body('question').isString().trim().isLength({ min: 5 }),
    body('answer').optional().isString(),
    body('category').optional().isString().trim(),
    body('sortRank').optional().isNumeric(),
  ],
  validate,
  adminCreateFaqDraft,
);
router.post(
  '/admin/faq',
  requireAuth,
  requireRole('admin'),
  [
    body('question').isString().trim().isLength({ min: 5 }),
    body('answer').optional().isString(),
    body('category').optional().isString().trim(),
    body('sortRank').optional().isNumeric(),
  ],
  validate,
  adminCreateFaqDraft,
);
router.put(
  '/admin/faq/:id',
  requireAuth,
  requireRole('admin'),
  [
    param('id').isMongoId(),
    body('question').optional().isString().trim().isLength({ min: 5 }),
    body('answer').optional().isString(),
    body('category').optional().isString().trim(),
    body('sortRank').optional().isNumeric(),
  ],
  validate,
  adminUpdateFaqDraft,
);
router.patch(
  '/admin/faq/:id',
  requireAuth,
  requireRole('admin'),
  [
    param('id').isMongoId(),
    body('question').optional().isString().trim().isLength({ min: 5 }),
    body('answer').optional().isString(),
    body('category').optional().isString().trim(),
    body('sortRank').optional().isNumeric(),
  ],
  validate,
  adminUpdateFaqDraft,
);
router.put('/admin/faq/:id/publish', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminPublishFaq);
router.put('/admin/faq/:id/unpublish', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminUnpublishFaq);
router.post('/admin/faq/:id/publish', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminPublishFaq);
router.post('/admin/faq/:id/unpublish', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminUnpublishFaq);
router.delete('/admin/faq/:id', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminDeleteFaq);

router.get('/admin/help', requireAuth, requireRole('admin'), adminListHelp);
router.put(
  '/admin/help',
  requireAuth,
  requireRole('admin'),
  [
    body('slug').isString().trim().isLength({ min: 2 }),
    body('title').isString().trim().isLength({ min: 2 }),
    body('body').optional().isString(),
    body('category').optional().isString().trim(),
    body('sortRank').optional().isNumeric(),
  ],
  validate,
  adminCreateHelpDraft,
);
router.post(
  '/admin/help',
  requireAuth,
  requireRole('admin'),
  [
    body('slug').isString().trim().isLength({ min: 2 }),
    body('title').isString().trim().isLength({ min: 2 }),
    body('body').optional().isString(),
    body('category').optional().isString().trim(),
    body('sortRank').optional().isNumeric(),
  ],
  validate,
  adminCreateHelpDraft,
);
router.put(
  '/admin/help/:id',
  requireAuth,
  requireRole('admin'),
  [
    param('id').isMongoId(),
    body('slug').optional().isString().trim().isLength({ min: 2 }),
    body('title').optional().isString().trim().isLength({ min: 2 }),
    body('body').optional().isString(),
    body('category').optional().isString().trim(),
    body('sortRank').optional().isNumeric(),
  ],
  validate,
  adminUpdateHelpDraft,
);
router.patch(
  '/admin/help/:id',
  requireAuth,
  requireRole('admin'),
  [
    param('id').isMongoId(),
    body('slug').optional().isString().trim().isLength({ min: 2 }),
    body('title').optional().isString().trim().isLength({ min: 2 }),
    body('body').optional().isString(),
    body('category').optional().isString().trim(),
    body('sortRank').optional().isNumeric(),
  ],
  validate,
  adminUpdateHelpDraft,
);
router.put('/admin/help/:id/publish', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminPublishHelp);
router.put('/admin/help/:id/unpublish', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminUnpublishHelp);
router.post('/admin/help/:id/publish', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminPublishHelp);
router.post('/admin/help/:id/unpublish', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminUnpublishHelp);
router.delete('/admin/help/:id', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminDeleteHelp);

router.get('/admin/banners', requireAuth, requireRole('admin'), adminListBanners);
router.put(
  '/admin/banners',
  requireAuth,
  requireRole('admin'),
  [
    body('imageUrl').isString().trim().isLength({ min: 3 }),
    body('title').optional().isString(),
    body('subtitle').optional().isString(),
    body('ctaText').optional().isString(),
    body('ctaLink').optional().isString(),
    body('sortRank').optional().isNumeric(),
    body('schedule').optional().isObject(),
    body('schedule.startAt').optional().isISO8601(),
    body('schedule.endAt').optional().isISO8601(),
  ],
  validate,
  adminCreateBannerDraft,
);
router.post(
  '/admin/banners',
  requireAuth,
  requireRole('admin'),
  [
    body('imageUrl').isString().trim().isLength({ min: 3 }),
    body('title').optional().isString(),
    body('subtitle').optional().isString(),
    body('ctaText').optional().isString(),
    body('ctaLink').optional().isString(),
    body('sortRank').optional().isNumeric(),
    body('schedule').optional().isObject(),
    body('schedule.startAt').optional().isISO8601(),
    body('schedule.endAt').optional().isISO8601(),
  ],
  validate,
  adminCreateBannerDraft,
);
router.put(
  '/admin/banners/:id',
  requireAuth,
  requireRole('admin'),
  [
    param('id').isMongoId(),
    body('imageUrl').optional().isString().trim().isLength({ min: 3 }),
    body('title').optional().isString(),
    body('subtitle').optional().isString(),
    body('ctaText').optional().isString(),
    body('ctaLink').optional().isString(),
    body('sortRank').optional().isNumeric(),
    body('schedule').optional().isObject(),
    body('schedule.startAt').optional().isISO8601(),
    body('schedule.endAt').optional().isISO8601(),
  ],
  validate,
  adminUpdateBannerDraft,
);
router.patch(
  '/admin/banners/:id',
  requireAuth,
  requireRole('admin'),
  [
    param('id').isMongoId(),
    body('imageUrl').optional().isString().trim().isLength({ min: 3 }),
    body('title').optional().isString(),
    body('subtitle').optional().isString(),
    body('ctaText').optional().isString(),
    body('ctaLink').optional().isString(),
    body('sortRank').optional().isNumeric(),
    body('schedule').optional().isObject(),
    body('schedule.startAt').optional().isISO8601(),
    body('schedule.endAt').optional().isISO8601(),
  ],
  validate,
  adminUpdateBannerDraft,
);
router.put('/admin/banners/:id/publish', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminPublishBanner);
router.put('/admin/banners/:id/unpublish', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminUnpublishBanner);
router.post('/admin/banners/:id/publish', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminPublishBanner);
router.post('/admin/banners/:id/unpublish', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminUnpublishBanner);
router.delete('/admin/banners/:id', requireAuth, requireRole('admin'), [param('id').isMongoId()], validate, adminDeleteBanner);

module.exports = router;
