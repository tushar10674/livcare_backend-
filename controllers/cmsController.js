const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const ContentPage = require('../models/ContentPage');
const Faq = require('../models/Faq');
const HelpArticle = require('../models/HelpArticle');
const Banner = require('../models/Banner');

const DEFAULT_PUBLIC_PAGES = {
  home: { key: 'home', title: 'Home Page', body: '', publishedAt: null },
  catalog: { key: 'catalog', title: 'Catalog Page', body: '', publishedAt: null },
  helpCenter: { key: 'helpCenter', title: 'Help Center', body: '', publishedAt: null },
  technicalSupport: { key: 'technicalSupport', title: 'Technical Support', body: '', publishedAt: null },
  installationServices: { key: 'installationServices', title: 'Installation Services', body: '', publishedAt: null },
  privacyPolicy: { key: 'privacyPolicy', title: 'Privacy Policy', body: '', publishedAt: null },
  termsConditions: { key: 'termsConditions', title: 'Terms & Conditions', body: '', publishedAt: null },
  shippingPolicy: { key: 'shippingPolicy', title: 'Shipping Policy', body: '', publishedAt: null },
  returnRefundPolicy: { key: 'returnRefundPolicy', title: 'Return & Refund Policy', body: '', publishedAt: null },
  warrantyInformation: { key: 'warrantyInformation', title: 'Warranty Information', body: '', publishedAt: null },
};

// ---------- Public (published) ----------

const getPublishedPage = async (req, res, next) => {
  try {
    const { key } = req.params;
    const page = await ContentPage.findOne({ key, status: 'published' }).lean();
    if (!page) {
      if (DEFAULT_PUBLIC_PAGES[key]) {
        return sendSuccess(res, {
          data: {
            ...DEFAULT_PUBLIC_PAGES[key],
            updatedAt: null,
          },
        });
      }
      return next(new AppError('Page not found', 404));
    }

    return sendSuccess(res, {
      data: {
        key: page.key,
        title: page.title,
        body: page.published?.body || '',
        publishedAt: page.publishedAt,
        updatedAt: page.updatedAt,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const listPublishedBanners = async (req, res, next) => {
  try {
    const now = new Date();
    const { slot } = req.query;
    const filter = { status: 'published' };
    if (slot) {
      const normalizedSlot = String(slot || '').trim();
      if (normalizedSlot) {
        filter.$or = [{ slot: normalizedSlot }];
        if (normalizedSlot === 'home') filter.$or.push({ slot: { $exists: false } });
      }
    }

    const items = await Banner.find(filter)
      .sort({ sortRank: -1, createdAt: -1 })
      .lean();

    const filtered = (items || []).filter((b) => {
      const start = b.schedule?.startAt ? new Date(b.schedule.startAt) : null;
      const end = b.schedule?.endAt ? new Date(b.schedule.endAt) : null;
      if (start && now < start) return false;
      if (end && now > end) return false;
      return true;
    });

    return sendSuccess(res, {
      data: filtered.map((b) => ({
        id: b._id,
        slot: b.slot || 'home',
        title: b.published?.title ?? b.title ?? '',
        subtitle: b.published?.subtitle ?? b.subtitle ?? '',
        imageUrl: b.published?.imageUrl ?? b.imageUrl,
        ctaText: b.published?.ctaText ?? b.ctaText ?? '',
        ctaLink: b.published?.ctaLink ?? b.ctaLink ?? '',
        sortRank: b.sortRank || 0,
        schedule: b.schedule || {},
        publishedAt: b.publishedAt,
        updatedAt: b.updatedAt,
      })),
    });
  } catch (err) {
    return next(err);
  }
};

const listPublishedFaq = async (req, res, next) => {
  try {
    const { category } = req.query;
    const filter = { status: 'published' };
    if (category) filter.category = category;

    const items = await Faq.find(filter).sort({ sortRank: -1, createdAt: -1 }).lean();

    return sendSuccess(res, {
      data: items.map((f) => ({
        id: f._id,
        category: f.category,
        question: f.question,
        answer: f.publishedAnswer,
      })),
    });
  } catch (err) {
    return next(err);
  }
};

const listPublishedHelp = async (req, res, next) => {
  try {
    const { category } = req.query;
    const filter = { status: 'published' };
    if (category) filter.category = category;

    const items = await HelpArticle.find(filter).sort({ sortRank: -1, createdAt: -1 }).lean();

    return sendSuccess(res, {
      data: items.map((a) => ({
        id: a._id,
        category: a.category,
        slug: a.slug,
        title: a.title,
        body: a.publishedBody,
        sortRank: a.sortRank || 0,
        publishedAt: a.publishedAt,
      })),
    });
  } catch (err) {
    return next(err);
  }
};

const getPublishedHelpArticle = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const article = await HelpArticle.findOne({ slug, status: 'published' }).lean();
    if (!article) return next(new AppError('Article not found', 404));

    return sendSuccess(res, {
      data: {
        slug: article.slug,
        title: article.title,
        category: article.category,
        body: article.publishedBody,
        publishedAt: article.publishedAt,
        updatedAt: article.updatedAt,
      },
    });
  } catch (err) {
    return next(err);
  }
};

// ---------- Admin ----------

const adminListPages = async (req, res, next) => {
  try {
    const { type, status } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;

    const items = await ContentPage.find(filter).sort({ updatedAt: -1 }).lean();
    return sendSuccess(res, { data: items });
  } catch (err) {
    return next(err);
  }
};

const adminUpsertPageDraft = async (req, res, next) => {
  try {
    const { key } = req.params;
    const { title, body, type } = req.body;

    const page = await ContentPage.findOneAndUpdate(
      { key },
      {
        $set: {
          title,
          type: type || 'policy',
          draft: { body: body || '' },
          updatedBy: req.auth.userId,
          status: 'draft',
        },
      },
      { new: true, upsert: true, runValidators: true },
    );

    return sendSuccess(res, { message: 'Draft saved', data: page });
  } catch (err) {
    return next(err);
  }
};

const adminPublishPage = async (req, res, next) => {
  try {
    const { key } = req.params;

    const page = await ContentPage.findOne({ key });
    if (!page) return next(new AppError('Page not found', 404));

    page.published = { body: page.draft?.body || '' };
    page.status = 'published';
    page.publishedAt = new Date();
    page.updatedBy = req.auth.userId;

    await page.save();

    return sendSuccess(res, { message: 'Page published', data: page });
  } catch (err) {
    return next(err);
  }
};

const adminUnpublishPage = async (req, res, next) => {
  try {
    const { key } = req.params;

    const page = await ContentPage.findOne({ key });
    if (!page) return next(new AppError('Page not found', 404));

    page.status = 'draft';
    page.updatedBy = req.auth.userId;
    await page.save();

    return sendSuccess(res, { message: 'Page unpublished', data: page });
  } catch (err) {
    return next(err);
  }
};

const adminListFaq = async (req, res, next) => {
  try {
    const { status, category } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;

    const items = await Faq.find(filter).sort({ updatedAt: -1 }).lean();
    return sendSuccess(res, { data: items });
  } catch (err) {
    return next(err);
  }
};

const adminCreateFaqDraft = async (req, res, next) => {
  try {
    const { category, question, answer, sortRank } = req.body;

    const doc = await Faq.create({
      category,
      question,
      draftAnswer: answer || '',
      sortRank: typeof sortRank === 'number' ? sortRank : 0,
      status: 'draft',
      updatedBy: req.auth.userId,
    });

    return sendSuccess(res, { statusCode: 201, message: 'FAQ draft created', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminUpdateFaqDraft = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { category, question, answer, sortRank } = req.body;

    const doc = await Faq.findById(id);
    if (!doc) return next(new AppError('FAQ not found', 404));

    if (typeof category !== 'undefined') doc.category = category;
    if (typeof question !== 'undefined') doc.question = question;
    if (typeof answer !== 'undefined') doc.draftAnswer = answer;
    if (typeof sortRank !== 'undefined') doc.sortRank = sortRank;

    doc.status = 'draft';
    doc.updatedBy = req.auth.userId;

    await doc.save();
    return sendSuccess(res, { message: 'FAQ draft updated', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminPublishFaq = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await Faq.findById(id);
    if (!doc) return next(new AppError('FAQ not found', 404));

    doc.publishedAnswer = doc.draftAnswer || '';
    doc.status = 'published';
    doc.publishedAt = new Date();
    doc.updatedBy = req.auth.userId;

    await doc.save();
    return sendSuccess(res, { message: 'FAQ published', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminUnpublishFaq = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await Faq.findById(id);
    if (!doc) return next(new AppError('FAQ not found', 404));

    doc.status = 'draft';
    doc.updatedBy = req.auth.userId;
    await doc.save();

    return sendSuccess(res, { message: 'FAQ unpublished', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminDeleteFaq = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await Faq.findByIdAndDelete(id);
    if (!doc) return next(new AppError('FAQ not found', 404));
    return sendSuccess(res, { message: 'FAQ deleted' });
  } catch (err) {
    return next(err);
  }
};

const adminListHelp = async (req, res, next) => {
  try {
    const { status, category } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;

    const items = await HelpArticle.find(filter).sort({ updatedAt: -1 }).lean();
    return sendSuccess(res, { data: items });
  } catch (err) {
    return next(err);
  }
};

const adminCreateHelpDraft = async (req, res, next) => {
  try {
    const { category, slug, title, body, sortRank } = req.body;

    const doc = await HelpArticle.create({
      category,
      slug,
      title,
      draftBody: body || '',
      sortRank: typeof sortRank === 'number' ? sortRank : 0,
      status: 'draft',
      updatedBy: req.auth.userId,
    });

    return sendSuccess(res, { statusCode: 201, message: 'Help article draft created', data: doc });
  } catch (err) {
    if (err && err.code === 11000) {
      return next(new AppError('Duplicate slug', 409));
    }
    return next(err);
  }
};

const adminUpdateHelpDraft = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { category, slug, title, body, sortRank } = req.body;

    const doc = await HelpArticle.findById(id);
    if (!doc) return next(new AppError('Help article not found', 404));

    if (typeof category !== 'undefined') doc.category = category;
    if (typeof slug !== 'undefined') doc.slug = slug;
    if (typeof title !== 'undefined') doc.title = title;
    if (typeof body !== 'undefined') doc.draftBody = body;
    if (typeof sortRank !== 'undefined') doc.sortRank = sortRank;

    doc.status = 'draft';
    doc.updatedBy = req.auth.userId;

    await doc.save();
    return sendSuccess(res, { message: 'Help article draft updated', data: doc });
  } catch (err) {
    if (err && err.code === 11000) {
      return next(new AppError('Duplicate slug', 409));
    }
    return next(err);
  }
};

const adminPublishHelp = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await HelpArticle.findById(id);
    if (!doc) return next(new AppError('Help article not found', 404));

    doc.publishedBody = doc.draftBody || '';
    doc.status = 'published';
    doc.publishedAt = new Date();
    doc.updatedBy = req.auth.userId;

    await doc.save();
    return sendSuccess(res, { message: 'Help article published', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminUnpublishHelp = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await HelpArticle.findById(id);
    if (!doc) return next(new AppError('Help article not found', 404));

    doc.status = 'draft';
    doc.updatedBy = req.auth.userId;
    await doc.save();

    return sendSuccess(res, { message: 'Help article unpublished', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminDeleteHelp = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await HelpArticle.findByIdAndDelete(id);
    if (!doc) return next(new AppError('Help article not found', 404));
    return sendSuccess(res, { message: 'Help article deleted' });
  } catch (err) {
    return next(err);
  }
};

const adminListBanners = async (req, res, next) => {
  try {
    const { status, slot } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (slot) {
      const normalizedSlot = String(slot || '').trim();
      if (normalizedSlot) {
        filter.$or = [{ slot: normalizedSlot }];
        if (normalizedSlot === 'home') filter.$or.push({ slot: { $exists: false } });
      }
    }
    const items = await Banner.find(filter).sort({ updatedAt: -1 }).lean();
    return sendSuccess(res, { data: items });
  } catch (err) {
    return next(err);
  }
};

const adminCreateBannerDraft = async (req, res, next) => {
  try {
    const { slot, title, subtitle, imageUrl, ctaText, ctaLink, sortRank, schedule } = req.body;
    const normalizedSlot = String(slot || 'home').trim() || 'home';

    const safeDraft = {
      title: title || '',
      subtitle: subtitle || '',
      imageUrl: imageUrl || '',
      ctaText: ctaText || '',
      ctaLink: ctaLink || '',
    };

    const doc = await Banner.create({
      slot: normalizedSlot,
      title: safeDraft.title,
      subtitle: safeDraft.subtitle,
      imageUrl: safeDraft.imageUrl,
      ctaText: safeDraft.ctaText,
      ctaLink: safeDraft.ctaLink,
      draft: safeDraft,
      sortRank: typeof sortRank === 'number' ? sortRank : 0,
      schedule: {
        startAt: schedule?.startAt ? new Date(schedule.startAt) : undefined,
        endAt: schedule?.endAt ? new Date(schedule.endAt) : undefined,
      },
      status: 'draft',
      updatedBy: req.auth.userId,
    });

    return sendSuccess(res, { statusCode: 201, message: 'Banner draft created', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminUpdateBannerDraft = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { slot, title, subtitle, imageUrl, ctaText, ctaLink, sortRank, schedule } = req.body;

    const doc = await Banner.findById(id);
    if (!doc) return next(new AppError('Banner not found', 404));

    if (typeof slot !== 'undefined') doc.slot = String(slot || 'home').trim() || 'home';
    if (typeof title !== 'undefined') doc.draft.title = title || '';
    if (typeof subtitle !== 'undefined') doc.draft.subtitle = subtitle || '';
    if (typeof imageUrl !== 'undefined') doc.draft.imageUrl = imageUrl || '';
    if (typeof ctaText !== 'undefined') doc.draft.ctaText = ctaText || '';
    if (typeof ctaLink !== 'undefined') doc.draft.ctaLink = ctaLink || '';
    if (typeof sortRank !== 'undefined') doc.sortRank = sortRank;
    if (typeof schedule !== 'undefined') {
      doc.schedule = {
        startAt: schedule?.startAt ? new Date(schedule.startAt) : undefined,
        endAt: schedule?.endAt ? new Date(schedule.endAt) : undefined,
      };
    }

    doc.title = doc.draft?.title || '';
    doc.subtitle = doc.draft?.subtitle || '';
    doc.imageUrl = doc.draft?.imageUrl || doc.imageUrl;
    doc.ctaText = doc.draft?.ctaText || '';
    doc.ctaLink = doc.draft?.ctaLink || '';

    doc.status = 'draft';
    doc.updatedBy = req.auth.userId;

    await doc.save();
    return sendSuccess(res, { message: 'Banner draft updated', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminPublishBanner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await Banner.findById(id);
    if (!doc) return next(new AppError('Banner not found', 404));

    doc.published = {
      title: doc.draft?.title || '',
      subtitle: doc.draft?.subtitle || '',
      imageUrl: doc.draft?.imageUrl || '',
      ctaText: doc.draft?.ctaText || '',
      ctaLink: doc.draft?.ctaLink || '',
    };
    doc.status = 'published';
    doc.publishedAt = new Date();
    doc.updatedBy = req.auth.userId;

    await doc.save();
    return sendSuccess(res, { message: 'Banner published', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminUnpublishBanner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await Banner.findById(id);
    if (!doc) return next(new AppError('Banner not found', 404));

    doc.status = 'draft';
    doc.updatedBy = req.auth.userId;
    await doc.save();

    return sendSuccess(res, { message: 'Banner unpublished', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminDeleteBanner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await Banner.findByIdAndDelete(id);
    if (!doc) return next(new AppError('Banner not found', 404));
    return sendSuccess(res, { message: 'Banner deleted' });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getPublishedPage,
  listPublishedFaq,
  listPublishedHelp,
  getPublishedHelpArticle,
  listPublishedBanners,
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
};
