function sanitizeCanonicalStoryText(rawText, options = {}) {
  const maxChars = Math.max(200, Number(options.maxChars || 12000));
  const raw = String(rawText || '').replace(/\r/g, '\n').trim();
  if (!raw) return '';

  const lines = raw
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .map((line) => {
      if (/^(story|article|source)\s*text\s*:/i.test(line)) {
        return line.replace(/^(story|article|source)\s*text\s*:/i, '').trim();
      }
      if (/^(summary|description)\s*:/i.test(line)) {
        return line.replace(/^(summary|description)\s*:/i, '').trim();
      }
      return line;
    })
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !/^(error|warning|status|debug|trace|stack|exception|provider(?: used)?|panel errors?)\s*:/i.test(line))
    .filter((line) => !/^no summary available\.?$/i.test(line))
    .filter((line) => !/^\[[A-Z _-]{2,40}\]\s*/.test(line));

  const out = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!out) return '';
  return out.length > maxChars ? `${out.slice(0, maxChars)}...` : out;
}

module.exports = {
  sanitizeCanonicalStoryText
};
