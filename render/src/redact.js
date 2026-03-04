function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactSensitiveText(input, sensitiveValues) {
  let out = String(input == null ? '' : input);
  const values = (Array.isArray(sensitiveValues) ? sensitiveValues : [])
    .map((v) => String(v || '').trim())
    .filter((v) => v.length >= 6);

  values.forEach((value) => {
    const pattern = new RegExp(escapeRegExp(value), 'g');
    out = out.replace(pattern, '[REDACTED]');
  });

  return out;
}

module.exports = {
  redactSensitiveText
};
