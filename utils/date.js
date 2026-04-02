const parseDate = (value, fallback) => {
  if (!value) return fallback;
  const d = new Date(value);
  // eslint-disable-next-line no-restricted-globals
  if (isNaN(d.getTime())) return fallback;
  return d;
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

module.exports = { parseDate, startOfDay, endOfDay };
