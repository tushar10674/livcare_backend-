const { sendSuccess } = require('../utils/response');
const { parseDate, startOfDay, endOfDay } = require('../utils/date');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Enquiry = require('../models/Enquiry');
const Product = require('../models/Product');
const Ticket = require('../models/Ticket');
const ServiceRequest = require('../models/ServiceRequest');

const getRange = (req) => {
  const now = new Date();
  const to = endOfDay(parseDate(req.query.to, now));
  const from = startOfDay(parseDate(req.query.from, new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)));
  return { from, to };
};

const adminDashboardMetrics = async (req, res, next) => {
  try {
    const { from, to } = getRange(req);

    const dateMatch = { createdAt: { $gte: from, $lte: to } };

    const [
      orderCount,
      paidOrderCount,
      revenueAgg,
      enquiryCount,
      overdueEnquiries,
      ticketCount,
      overdueTickets,
      serviceReqCount,
      productCount,
    ] = await Promise.all([
      Order.countDocuments(dateMatch),
      Order.countDocuments({ ...dateMatch, status: { $in: ['paid', 'processing', 'shipped', 'delivered'] } }),
      Order.aggregate([
        { $match: { ...dateMatch, status: { $in: ['paid', 'processing', 'shipped', 'delivered'] } } },
        { $group: { _id: null, revenue: { $sum: '$grandTotal' }, gst: { $sum: '$gstTotal' }, subtotal: { $sum: '$subtotal' } } },
      ]),
      Enquiry.countDocuments(dateMatch),
      Enquiry.countDocuments({ ...dateMatch, status: { $ne: 'closed' }, slaDueAt: { $lt: new Date() }, firstResponseAt: { $exists: false } }),
      Ticket.countDocuments(dateMatch),
      Ticket.countDocuments({ ...dateMatch, status: { $nin: ['resolved', 'closed'] }, slaDueAt: { $lt: new Date() }, firstResponseAt: { $exists: false } }),
      ServiceRequest.countDocuments(dateMatch),
      Product.countDocuments({}),
    ]);

    const rev = revenueAgg[0] || { revenue: 0, gst: 0, subtotal: 0 };

    return sendSuccess(res, {
      data: {
        range: { from, to },
        orders: {
          total: orderCount,
          paidOrBeyond: paidOrderCount,
          revenue: rev.revenue || 0,
          subtotal: rev.subtotal || 0,
          gst: rev.gst || 0,
        },
        enquiries: { total: enquiryCount, overdue: overdueEnquiries },
        tickets: { total: ticketCount, overdue: overdueTickets },
        serviceRequests: { total: serviceReqCount },
        products: { total: productCount },
      },
    });
  } catch (err) {
    return next(err);
  }
};

const salesReport = async (req, res, next) => {
  try {
    const { from, to } = getRange(req);

    const matchPaid = {
      createdAt: { $gte: from, $lte: to },
      status: { $in: ['paid', 'processing', 'shipped', 'delivered'] },
    };

    const [daily, topItems, topBrands, topCategories] = await Promise.all([
      Order.aggregate([
        { $match: matchPaid },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            orders: { $sum: 1 },
            revenue: { $sum: '$grandTotal' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: matchPaid },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.name',
            qty: { $sum: '$items.qty' },
            revenue: { $sum: '$items.lineTotal' },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
      ]),
      Order.aggregate([
        { $match: matchPaid },
        { $unwind: '$items' },
        { $group: { _id: '$items.brand', revenue: { $sum: '$items.lineTotal' }, qty: { $sum: '$items.qty' } } },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
      ]),
      Order.aggregate([
        { $match: matchPaid },
        { $unwind: '$items' },
        { $group: { _id: '$items.category', revenue: { $sum: '$items.lineTotal' }, qty: { $sum: '$items.qty' } } },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
      ]),
    ]);

    return sendSuccess(res, {
      data: {
        range: { from, to },
        daily,
        topProducts: topItems.map((x) => ({ name: x._id, qty: x.qty, revenue: x.revenue })),
        topBrands: topBrands.map((x) => ({ brand: x._id || 'Unknown', qty: x.qty, revenue: x.revenue })),
        topCategories: topCategories.map((x) => ({ category: x._id || 'Unknown', qty: x.qty, revenue: x.revenue })),
      },
    });
  } catch (err) {
    return next(err);
  }
};

const conversionReport = async (req, res, next) => {
  try {
    const { from, to } = getRange(req);

    const [enquiries, orders, paid] = await Promise.all([
      Enquiry.countDocuments({ createdAt: { $gte: from, $lte: to } }),
      Order.countDocuments({ createdAt: { $gte: from, $lte: to } }),
      Order.countDocuments({ createdAt: { $gte: from, $lte: to }, status: { $in: ['paid', 'processing', 'shipped', 'delivered'] } }),
    ]);

    const enquiryToOrder = enquiries ? Number((orders / enquiries) * 100).toFixed(2) : '0.00';
    const orderToPaid = orders ? Number((paid / orders) * 100).toFixed(2) : '0.00';

    return sendSuccess(res, {
      data: {
        range: { from, to },
        funnel: {
          enquiries,
          orders,
          paidOrders: paid,
          enquiryToOrderRate: Number(enquiryToOrder),
          orderToPaidRate: Number(orderToPaid),
        },
      },
    });
  } catch (err) {
    return next(err);
  }
};

const productAnalytics = async (req, res, next) => {
  try {
    const { from, to } = getRange(req);

    const [mix, lowStock, topOrdered] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: from, $lte: to }, status: { $in: ['paid', 'processing', 'shipped', 'delivered'] } } },
        { $unwind: '$items' },
        { $group: { _id: '$items.mode', revenue: { $sum: '$items.lineTotal' }, qty: { $sum: '$items.qty' } } },
      ]),
      Product.find({ stock: 'out' }).select('name sku brand category stock stockQty mode visible').limit(50),
      Order.aggregate([
        { $match: { createdAt: { $gte: from, $lte: to }, status: { $in: ['paid', 'processing', 'shipped', 'delivered'] } } },
        { $unwind: '$items' },
        { $group: { _id: '$items.productId', name: { $first: '$items.name' }, qty: { $sum: '$items.qty' }, revenue: { $sum: '$items.lineTotal' } } },
        { $sort: { revenue: -1 } },
        { $limit: 20 },
      ]),
    ]);

    return sendSuccess(res, {
      data: {
        range: { from, to },
        modeMix: mix.map((m) => ({ mode: m._id || 'Unknown', qty: m.qty, revenue: m.revenue })),
        lowStock: lowStock,
        topOrdered,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const enquiryAnalytics = async (req, res, next) => {
  try {
    const { from, to } = getRange(req);

    const [daily, statusBreakdown, overdue, assignedBreakdown] = await Promise.all([
      Enquiry.aggregate([
        { $match: { createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Enquiry.aggregate([
        { $match: { createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Enquiry.countDocuments({ createdAt: { $gte: from, $lte: to }, status: { $ne: 'closed' }, slaDueAt: { $lt: new Date() }, firstResponseAt: { $exists: false } }),
      Enquiry.aggregate([
        { $match: { createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    return sendSuccess(res, {
      data: {
        range: { from, to },
        daily,
        statusBreakdown: statusBreakdown.map((s) => ({ status: s._id || 'unknown', count: s.count })),
        overdue,
        assignedBreakdown: assignedBreakdown.map((a) => ({ assignedTo: a._id, count: a.count })),
      },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  adminDashboardMetrics,
  salesReport,
  conversionReport,
  productAnalytics,
  enquiryAnalytics,
};
