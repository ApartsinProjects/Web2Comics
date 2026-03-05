const { OPTION_MAP, SECRET_KEYS } = require('./data/options');

function getOptions(pathKey) {
  return OPTION_MAP[String(pathKey || '')] || [];
}

function allOptionPaths() {
  return Object.keys(OPTION_MAP);
}

function parseUserValue(pathKey, raw) {
  const key = String(pathKey || '');
  const v = String(raw || '').trim();
  if (!v) return '';
  if (/panel_count|_concurrency|retries|output\.width|panel_height|caption_height|timeout_ms|padding|gap|header_height|footer_height/.test(key)) {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) throw new Error(`Expected integer for ${key}`);
    return n;
  }
  if (/invent_temperature/.test(key)) {
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n)) throw new Error(`Expected number for ${key}`);
    return n;
  }
  if (/generation\.consistency|generation\.panel_watermark/.test(key)) {
    const low = v.toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(low)) return true;
    if (['0', 'false', 'no', 'off'].includes(low)) return false;
    throw new Error(`Expected boolean on/off for ${key}`);
  }
  return v;
}

function formatOptionsMessage(pathKey, current) {
  const options = getOptions(pathKey);
  if (!options.length) {
    return `No predefined options for \`${pathKey}\`. Current: \`${String(current)}\`\nUse a dedicated command (for example /objective, /panels, /mode, /vendor, /models).`;
  }
  const lines = [`Options for \`${pathKey}\``, `Current: \`${String(current)}\``, ''];
  options.forEach((opt, idx) => {
    const mark = String(opt) === String(current) ? ' (current)' : '';
    lines.push(`${idx + 1}. ${opt}${mark}`);
  });
  lines.push('');
  lines.push('Set with the dedicated command for this path.');
  return lines.join('\n');
}

module.exports = {
  SECRET_KEYS,
  getOptions,
  allOptionPaths,
  parseUserValue,
  formatOptionsMessage
};
