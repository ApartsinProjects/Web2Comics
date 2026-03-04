const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function collapseWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function extractFromHtml(html, options = {}) {
  const dom = new JSDOM(String(html || ''));
  const doc = dom.window.document;
  const selectors = Array.isArray(options.strip_selectors) ? options.strip_selectors : [];
  selectors.forEach((selector) => {
    doc.querySelectorAll(selector).forEach((el) => el.remove());
  });

  const title = collapseWhitespace(doc.querySelector('title')?.textContent || doc.querySelector('h1')?.textContent || 'Untitled Source');
  const main = doc.querySelector('article, main, [role="main"], body') || doc.body;
  const text = collapseWhitespace(main?.textContent || '');
  return {
    title,
    text
  };
}

function inferFormat(inputPath, hint) {
  if (hint && hint !== 'auto') return hint;
  const ext = path.extname(String(inputPath || '')).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'html';
  return 'text';
}

function loadSource(inputPath, inputConfig = {}) {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Input file not found: ${resolved}`);
  }

  const format = inferFormat(resolved, String(inputConfig.format || 'auto').toLowerCase());
  const raw = fs.readFileSync(resolved, 'utf8');
  let title = path.basename(resolved, path.extname(resolved));
  let text = '';

  if (format === 'html') {
    const extracted = extractFromHtml(raw, inputConfig);
    title = extracted.title || title;
    text = extracted.text || '';
  } else {
    text = collapseWhitespace(raw);
  }

  const maxChars = Number(inputConfig.max_chars || 12000);
  if (maxChars > 0 && text.length > maxChars) {
    text = text.slice(0, maxChars);
  }

  if (text.length < 20) {
    throw new Error(`Input text is too short after extraction (${text.length} chars)`);
  }

  return {
    inputPath: resolved,
    format,
    title,
    text,
    sourceLabel: `file://${resolved.replace(/\\/g, '/')}`
  };
}

module.exports = {
  collapseWhitespace,
  extractFromHtml,
  loadSource
};
