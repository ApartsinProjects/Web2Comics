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

function normalizeUrlCandidate(value) {
  return String(value || '')
    .trim()
    .replace(/[)\].,!?;:]+$/, '');
}

function extractFirstUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/https?:\/\/[^\s<>"'`]+/i);
  if (!match || !match[0]) return '';
  const candidate = normalizeUrlCandidate(match[0]);
  return looksLikeUrl(candidate) ? candidate : '';
}

function classifyMessageInput(text) {
  const value = String(text || '').trim();
  if (!value) return { kind: 'empty', value: '' };
  if (looksLikeUrl(value)) return { kind: 'url', value: normalizeUrlCandidate(value) };
  const firstUrl = extractFirstUrl(value);
  if (firstUrl) return { kind: 'url', value: firstUrl };
  return { kind: 'text', value };
}

module.exports = {
  looksLikeUrl,
  extractFirstUrl,
  classifyMessageInput
};
