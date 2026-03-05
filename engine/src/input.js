const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function collapseWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

const ARTICLE_CANDIDATE_SELECTORS = [
  'article',
  'main article',
  '[itemprop="articleBody"]',
  '[data-component-name="article-body"]',
  '[data-article-body]',
  '.article',
  '.article-body',
  '.article__content',
  '[class*="article-"]',
  '[class*="story-"]',
  'main',
  '[role="main"]',
  'body'
];

const BOILERPLATE_PATTERNS = [
  /values your feedback/i,
  /how relevant is this ad/i,
  /did you encounter any technical issues/i,
  /video player was slow to load content/i,
  /video content never loaded/i,
  /ad froze or did not finish loading/i,
  /audio on ad was too loud/i,
  /ad never loaded/i,
  /accept all cookies/i,
  /manage privacy settings/i
];

function isBoilerplateChunk(chunk) {
  return BOILERPLATE_PATTERNS.some((re) => re.test(chunk));
}

function stripBoilerplate(text) {
  const raw = collapseWhitespace(text);
  if (!raw) return '';
  const chunks = raw
    .split(/(?<=[.!?])\s+|(?<=\b(?:issues|loaded|loud|settings))\s+/i)
    .map((c) => collapseWhitespace(c))
    .filter(Boolean);
  const kept = chunks.filter((chunk) => !isBoilerplateChunk(chunk));
  const fallback = kept.length ? kept.join(' ') : raw;
  return collapseWhitespace(
    fallback
      .replace(/\b(CNN values your feedback|How relevant is this ad to you\??|Did you encounter any technical issues\??)\b/gi, ' ')
      .replace(/\b(No|Other issues|Ad never loaded)\b/gi, ' ')
  );
}

function scoreCandidate(text) {
  const normalized = collapseWhitespace(text);
  if (!normalized) return -Infinity;
  const wordCount = normalized.split(' ').filter(Boolean).length;
  const boilerplateHits = BOILERPLATE_PATTERNS.reduce((acc, re) => acc + (re.test(normalized) ? 1 : 0), 0);
  return wordCount - (boilerplateHits * 120);
}

function chooseBestContentNode(doc) {
  let bestNode = doc.body;
  let bestScore = -Infinity;
  for (const selector of ARTICLE_CANDIDATE_SELECTORS) {
    const nodes = doc.querySelectorAll(selector);
    nodes.forEach((node) => {
      const text = collapseWhitespace(node?.textContent || '');
      const score = scoreCandidate(stripBoilerplate(text));
      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    });
  }
  return bestNode || doc.body;
}

function extractFromHtml(html, options = {}) {
  const dom = new JSDOM(String(html || ''));
  const doc = dom.window.document;
  const selectors = Array.isArray(options.strip_selectors) ? options.strip_selectors : [];
  selectors.forEach((selector) => {
    doc.querySelectorAll(selector).forEach((el) => el.remove());
  });
  doc.querySelectorAll('script,style,noscript,template,svg').forEach((el) => el.remove());

  const title = collapseWhitespace(doc.querySelector('title')?.textContent || doc.querySelector('h1')?.textContent || 'Untitled Source');
  const main = chooseBestContentNode(doc);
  const text = stripBoilerplate(main?.textContent || '');
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
