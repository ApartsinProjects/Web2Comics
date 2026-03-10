function looksLikeUrl(value) {
  const text = String(value || '').trim();
  if (!text || /\s/.test(text)) return false;
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function normalizeUrlCandidate(value) {
  let out = String(value || '')
    .trim()
    .replace(/[)\].,!?;:]+$/, '');
  if (/^https?:[\\/]+/i.test(out)) {
    out = out.replace(/^([a-z]+):[\\/]+/i, '$1://');
  }
  if (/^https?:\/\//i.test(out)) {
    out = out.replace(/\\/g, '/');
  }
  return out;
}

function extractFirstUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/https?:[\\/]{2}[^\s<>"'`]+/i);
  if (!match || !match[0]) return '';
  const candidate = normalizeUrlCandidate(match[0]);
  return looksLikeUrl(candidate) ? candidate : '';
}

function extractFirstUrlLikeToken(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const tokens = text.split(/\s+/).map((t) => normalizeUrlCandidate(t)).filter(Boolean);
  for (const token of tokens) {
    const inferred = inferLikelyWebUrlFromText(token);
    if (inferred) return inferred;
  }
  return '';
}

function stripUrls(value) {
  return String(value || '').replace(/https?:\/\/[^\s<>"'`]+/gi, ' ');
}

function isLongStoryText(value) {
  const cleaned = stripUrls(value).replace(/\s+/g, ' ').trim();
  if (!cleaned) return false;
  return cleaned.length >= LONG_STORY_TEXT_MIN_CHARS;
}

function isLikelyMediaUrl(value) {
  const url = String(value || '').trim().toLowerCase();
  if (!url) return false;
  return /\.(png|jpe?g|gif|webp|bmp|svg|mp4|mov|avi|mkv|webm|m4v|wmv|flv|mp3|wav|ogg|m4a|aac|flac|opus)(\?.*)?$/.test(url);
}

function isLikelyImageUrl(value) {
  const url = String(value || '').trim().toLowerCase();
  if (!url) return false;
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/.test(url);
}

function isLikelyAudioUrl(value) {
  const url = String(value || '').trim().toLowerCase();
  if (!url) return false;
  return /\.(mp3|wav|ogg|m4a|aac|flac|opus)(\?.*)?$/.test(url);
}

function isLikelyPdfUrl(value) {
  const candidate = normalizeUrlCandidate(value);
  if (!looksLikeUrl(candidate)) return false;
  try {
    const parsed = new URL(candidate);
    const joined = `${parsed.pathname || ''}${parsed.search || ''}`.toLowerCase();
    if (joined.includes('.pdf')) return true;
    const mimeHint = String(parsed.searchParams.get('format') || '').toLowerCase();
    return mimeHint === 'pdf' || mimeHint === 'application/pdf';
  } catch (_) {
    return /\.pdf(\?.*)?$/i.test(candidate);
  }
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
  let candidate = raw
    .replace(/https?:\/\/[^\s<>"'`]+/gi, ' ')
    .replace(/\bwww\.[^\s<>"'`]+\b/gi, ' ');

  // Remove plain domain tokens (with optional path) so URL-only messages like
  // "cnn.com" or "cnn.com/news" don't get treated as fallback story text.
  const tokens = candidate.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => !inferLikelyWebUrlFromText(t));
  candidate = kept.join(' ').replace(/\s+/g, ' ').trim();
  return candidate;
}

function extractFirstPdfUrlLikeToken(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const explicit = extractFirstUrl(text);
  if (explicit && isLikelyPdfUrl(explicit)) return explicit;
  const tokens = text.split(/\s+/).map((t) => normalizeUrlCandidate(t)).filter(Boolean);
  for (const token of tokens) {
    const inferred = inferLikelyWebUrlFromText(token);
    if (inferred && isLikelyPdfUrl(inferred)) return inferred;
  }
  return '';
}

function extractFirstImageUrlLikeToken(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const explicit = extractFirstUrl(text);
  if (explicit && isLikelyImageUrl(explicit)) return explicit;
  const tokens = text.split(/\s+/).map((t) => normalizeUrlCandidate(t)).filter(Boolean);
  for (const token of tokens) {
    const inferred = inferLikelyWebUrlFromText(token);
    if (inferred && isLikelyImageUrl(inferred)) return inferred;
  }
  return '';
}

function extractFirstAudioUrlLikeToken(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const explicit = extractFirstUrl(text);
  if (explicit && isLikelyAudioUrl(explicit)) return explicit;
  const tokens = text.split(/\s+/).map((t) => normalizeUrlCandidate(t)).filter(Boolean);
  for (const token of tokens) {
    const inferred = inferLikelyWebUrlFromText(token);
    if (inferred && isLikelyAudioUrl(inferred)) return inferred;
    if (!inferred) {
      let candidate = token;
      if (!/^https?:\/\//i.test(candidate)) {
        if (/^www\./i.test(candidate) || /^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(candidate)) {
          candidate = `https://${candidate}`;
        } else {
          continue;
        }
      }
      try {
        const parsed = new URL(candidate);
        const normalized = parsed.toString();
        if (isLikelyAudioUrl(normalized)) return normalized;
      } catch (_) {}
    }
  }
  return '';
}

function extractLinksFromEntities(baseText, entities) {
  const text = String(baseText || '');
  const list = Array.isArray(entities) ? entities : [];
  const links = [];
  for (const entity of list) {
    const type = String(entity?.type || '').trim().toLowerCase();
    if (type === 'text_link') {
      const url = String(entity?.url || '').trim();
      if (url) links.push(url);
      continue;
    }
    if (type === 'url') {
      const offset = Number(entity?.offset || 0);
      const length = Number(entity?.length || 0);
      if (Number.isFinite(offset) && Number.isFinite(length) && length > 0 && offset >= 0) {
        const raw = text.slice(offset, offset + length).trim();
        if (raw) links.push(raw);
      }
    }
  }
  return links;
}

function extractMessageInputText(message) {
  const parts = [];
  const links = [];
  const pushPart = (value, entities) => {
    const body = String(value || '').trim();
    if (!body) return;
    parts.push(body);
    links.push(...extractLinksFromEntities(body, entities));
  };

  pushPart(message?.text, message?.entities);
  pushPart(message?.caption, message?.caption_entities);
  pushPart(message?.quote?.text, message?.quote?.entities);
  pushPart(message?.reply_to_message?.text, message?.reply_to_message?.entities);
  pushPart(message?.reply_to_message?.caption, message?.reply_to_message?.caption_entities);

  const uniq = new Set();
  return [...parts, ...links]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .filter((v) => {
      const key = v.toLowerCase();
      if (uniq.has(key)) return false;
      uniq.add(key);
      return true;
    })
    .join('\n')
    .trim();
}

function classifyMessageInput(text) {
  const value = String(text || '').trim();
  if (!value) return { kind: 'empty', value: '' };
  if (looksLikeUrl(value)) {
    const candidate = normalizeUrlCandidate(value);
    if (isLikelyWebPageUrl(candidate)) return { kind: 'url', value: candidate };
    return { kind: 'text', value };
  }
  const inferredDirect = inferLikelyWebUrlFromText(value);
  if (inferredDirect && !isLongStoryText(value)) {
    return { kind: 'url', value: inferredDirect };
  }
  const tokenUrl = extractFirstUrlLikeToken(value);
  if (tokenUrl && !isLongStoryText(value)) {
    return { kind: 'url', value: tokenUrl };
  }
  const firstUrl = extractFirstUrl(value);
  if (firstUrl && isLikelyWebPageUrl(firstUrl)) {
    // If user sent a full story and included a reference URL, treat as text story.
    if (isLongStoryText(value)) return { kind: 'text', value };
    return { kind: 'url', value: firstUrl };
  }
  return { kind: 'text', value };
}

module.exports = {
  looksLikeUrl,
  extractFirstUrl,
  classifyMessageInput,
  isLikelyWebPageUrl,
  isLikelyPdfUrl,
  isLikelyImageUrl,
  isLikelyAudioUrl,
  extractTextFallbackFromUrlMessage,
  inferLikelyWebUrlFromText,
  extractMessageInputText,
  extractFirstUrlLikeToken,
  extractFirstPdfUrlLikeToken,
  extractFirstImageUrlLikeToken,
  extractFirstAudioUrlLikeToken
};
const { LONG_STORY_TEXT_MIN_CHARS } = require('./data/thresholds');
