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

function isLikelyMediaUrl(value) {
  const url = String(value || '').trim().toLowerCase();
  if (!url) return false;
  return /\.(png|jpe?g|gif|webp|bmp|svg|mp4|mov|avi|mkv|webm|m4v|wmv|flv)(\?.*)?$/.test(url);
}

function isLikelyWebPageUrl(value) {
  const candidate = normalizeUrlCandidate(value);
  if (!looksLikeUrl(candidate)) return false;
  return !isLikelyMediaUrl(candidate);
}

function inferLikelyWebUrlFromText(value) {
  const raw = normalizeUrlCandidate(value);
  if (!raw) return '';
  if (isLikelyWebPageUrl(raw)) return raw;
  if (/\s/.test(raw)) return '';

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    if (/^www\./i.test(candidate) || /^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(candidate)) {
      candidate = `https://${candidate}`;
    } else {
      return '';
    }
  }

  try {
    const parsed = new URL(candidate);
    const host = String(parsed.hostname || '').toLowerCase();
    if (!host) return '';
    if (!(host.includes('.') || host === 'localhost')) return '';
    return isLikelyWebPageUrl(parsed.toString()) ? parsed.toString() : '';
  } catch (_) {
    return '';
  }
}

function extractTextFallbackFromUrlMessage(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withoutUrls = raw.replace(/https?:\/\/[^\s<>"'`]+/gi, ' ').replace(/\s+/g, ' ').trim();
  if (withoutUrls) return withoutUrls;
  return raw;
}

function classifyMessageInput(text) {
  const value = String(text || '').trim();
  if (!value) return { kind: 'empty', value: '' };
  if (looksLikeUrl(value)) {
    const candidate = normalizeUrlCandidate(value);
    if (isLikelyWebPageUrl(candidate)) return { kind: 'url', value: candidate };
    return { kind: 'text', value };
  }
  const firstUrl = extractFirstUrl(value);
  if (firstUrl && isLikelyWebPageUrl(firstUrl)) return { kind: 'url', value: firstUrl };
  return { kind: 'text', value };
}

module.exports = {
  looksLikeUrl,
  extractFirstUrl,
  classifyMessageInput,
  isLikelyWebPageUrl,
  extractTextFallbackFromUrlMessage,
  inferLikelyWebUrlFromText
};
