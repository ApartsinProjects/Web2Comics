const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

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

const ACCESS_BLOCK_PATTERNS = [
  /just a moment/i,
  /verification successful/i,
  /waiting for .* to respond/i,
  /you've been blocked by network security/i,
  /access denied/i,
  /enable javascript and cookies/i,
  /checking if the site connection is secure/i,
  /cf-browser-verification/i
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

function collectReadableBlocks(node) {
  if (!node || typeof node.querySelectorAll !== 'function') return [];
  const blocks = [];
  const selectors = ['p', 'article p', 'main p', '[itemprop="articleBody"] p', '.article-body p', 'li'];
  selectors.forEach((selector) => {
    node.querySelectorAll(selector).forEach((el) => {
      const text = collapseWhitespace(el?.textContent || '');
      if (text.length < 40) return;
      blocks.push(text);
    });
  });
  return blocks;
}

function scoreCandidate(text, paragraphCount = 0) {
  const normalized = collapseWhitespace(stripBoilerplate(text));
  if (!normalized) return -Infinity;
  const wordCount = normalized.split(' ').filter(Boolean).length;
  const boilerplateHits = BOILERPLATE_PATTERNS.reduce((acc, re) => acc + (re.test(normalized) ? 1 : 0), 0);
  const sentenceCount = (normalized.match(/[.!?]\s/g) || []).length;
  return wordCount + (paragraphCount * 12) + (sentenceCount * 6) - (boilerplateHits * 120);
}

function chooseBestContentNode(doc) {
  let bestNode = doc.body;
  let bestScore = -Infinity;
  for (const selector of ARTICLE_CANDIDATE_SELECTORS) {
    const nodes = doc.querySelectorAll(selector);
    nodes.forEach((node) => {
      const readableBlocks = collectReadableBlocks(node);
      const paragraphText = collapseWhitespace(readableBlocks.join(' '));
      const rawText = collapseWhitespace(node?.textContent || '');
      const text = paragraphText || rawText;
      const score = scoreCandidate(text, readableBlocks.length);
      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    });
  }
  return bestNode || doc.body;
}

function extractMetaDescription(doc) {
  const selectors = [
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]'
  ];
  for (const selector of selectors) {
    const val = collapseWhitespace(doc.querySelector(selector)?.getAttribute('content') || '');
    if (val) return val;
  }
  return '';
}

function detectAccessBlock(title, text) {
  const probe = `${String(title || '')}\n${String(text || '')}`;
  const matched = ACCESS_BLOCK_PATTERNS.find((re) => re.test(probe));
  return matched ? String(matched) : '';
}

function extractFromHtml(html, options = {}) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', () => {});
  virtualConsole.on('warn', () => {});
  const dom = new JSDOM(String(html || ''), { virtualConsole });
  const doc = dom.window.document;
  const selectors = Array.isArray(options.strip_selectors) ? options.strip_selectors : [];
  selectors.forEach((selector) => {
    doc.querySelectorAll(selector).forEach((el) => el.remove());
  });
  doc.querySelectorAll('script,style,noscript,template,svg,header,footer,nav,aside').forEach((el) => el.remove());

  const title = collapseWhitespace(doc.querySelector('title')?.textContent || doc.querySelector('h1')?.textContent || 'Untitled Source');
  const main = chooseBestContentNode(doc);
  const readableBlocks = collectReadableBlocks(main);
  const primaryText = stripBoilerplate(collapseWhitespace(readableBlocks.join(' ')) || main?.textContent || '');
  const metaDescription = extractMetaDescription(doc);
  let text = primaryText;
  if (metaDescription && text.length < 220 && !text.toLowerCase().includes(metaDescription.toLowerCase())) {
    text = collapseWhitespace(`${metaDescription}. ${text}`);
  }
  const blockedReason = detectAccessBlock(title, text);
  return {
    title,
    text,
    blockedReason
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
    if (extracted.blockedReason) {
      throw new Error(`Web page extraction blocked or gated (${extracted.blockedReason})`);
    }
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
