const DEFAULT_GST_RATE = 18;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const calcCartTotals = ({ items, shippingState, businessState = 'Maharashtra' }) => {
  const subtotal = round2(items.reduce((sum, it) => sum + it.lineTotal, 0));
  const gstTotal = round2(items.reduce((sum, it) => sum + round2((it.lineTotal * (it.gstRate || 0)) / 100), 0));
  const grandTotal = round2(subtotal + gstTotal);

  const rate = items.length ? Math.max(...items.map((i) => i.gstRate || 0)) : DEFAULT_GST_RATE;

  const isIntraState = shippingState && businessState && String(shippingState).toLowerCase() === String(businessState).toLowerCase();

  const breakdown = isIntraState
    ? {
        type: 'cgst_sgst',
        cgst: round2(gstTotal / 2),
        sgst: round2(gstTotal / 2),
        igst: 0,
        rate,
      }
    : {
        type: 'igst',
        igst: gstTotal,
        cgst: 0,
        sgst: 0,
        rate,
      };

  return { subtotal, gstTotal, grandTotal, breakdown };
};

module.exports = { DEFAULT_GST_RATE, round2, calcCartTotals };
