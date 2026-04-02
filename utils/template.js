const renderTemplate = (input, vars = {}) => {
  const str = String(input || '');
  return str.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const parts = String(key).split('.');
    let cur = vars;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
      else return '';
    }
    return cur == null ? '' : String(cur);
  });
};

module.exports = { renderTemplate };
