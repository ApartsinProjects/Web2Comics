function looksLikeUrl(value) {
  const text = String(value || '').trim();
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function classifyMessageInput(text) {
  const value = String(text || '').trim();
  if (!value) return { kind: 'empty', value: '' };
  if (looksLikeUrl(value)) return { kind: 'url', value };
  return { kind: 'text', value };
}

module.exports = {
  looksLikeUrl,
  classifyMessageInput
};
