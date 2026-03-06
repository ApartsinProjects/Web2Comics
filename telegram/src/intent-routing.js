const { classifyMessageInput, inferLikelyWebUrlFromText } = require('./message-utils');

const NON_TEXT_SOURCE_TYPES = new Set([
  'html_url',
  'pdf_url',
  'pdf_file',
  'image_url',
  'image_file',
  'audio_url',
  'audio_file'
]);

function decideInputIntent({ incomingKind, text, sourceType, shortPromptMaxChars }) {
  const normalizedText = String(text || '').trim();
  const normalizedSource = String(sourceType || '').trim().toLowerCase();
  const isNonTextSource = NON_TEXT_SOURCE_TYPES.has(normalizedSource);
  const parsed = classifyMessageInput(normalizedText);
  const isShortText = !isNonTextSource
    && String(incomingKind || '').trim().toLowerCase() === 'text'
    && normalizedText.length > 0
    && normalizedText.length <= Math.max(1, Number(shortPromptMaxChars || 120));

  let inferredUrl = '';
  if (isShortText && parsed.kind !== 'url') {
    inferredUrl = String(inferLikelyWebUrlFromText(normalizedText) || '').trim();
  }

  let route = 'text';
  let reason = 'default_text';
  if (isNonTextSource) {
    route = 'source_extraction';
    reason = `non_text_source:${normalizedSource}`;
  } else if (parsed.kind === 'url' || inferredUrl) {
    route = 'url';
    reason = parsed.kind === 'url' ? 'input_contains_url' : 'short_text_url_inferred';
  } else if (isShortText) {
    route = 'invent';
    reason = 'short_text_needs_story_expansion';
  }

  return {
    route,
    reason,
    parsedKind: parsed.kind,
    parsedValue: String(parsed.value || ''),
    isShortText,
    isNonTextSource,
    inferredUrl
  };
}

module.exports = {
  NON_TEXT_SOURCE_TYPES,
  decideInputIntent
};

