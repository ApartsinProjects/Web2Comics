// Content Script - Page Content Extraction
// Handles content extraction from web pages

(function() {
  'use strict';
  const TEST_VERBOSE_LOGS = Boolean(globalThis && globalThis.__WEB2COMICS_TEST_LOGS__);

  function testLog(event, data) {
    if (!TEST_VERBOSE_LOGS) return;
    try {
      console.info('[Web2Comics:test][content]', event, data || null);
    } catch (_) {}
  }

  const MESSAGE_TYPES = {
    EXTRACT_CONTENT: 'EXTRACT_CONTENT',
    EXTRACT_CONTENT_RESULT: 'EXTRACT_CONTENT_RESULT',
    START_GENERATION: 'START_GENERATION'
  };

  const CONTENT_SELECTORS = [
    'article',
    'main',
    '[role="main"]',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.story-body',
    '.article-body',
    '#content',
    '.content'
  ];

  const BOILERPLATE_LINE_PATTERNS = [
    /\bcookie\b/i,
    /\bprivacy\b/i,
    /\bterms\b/i,
    /\bsubscribe\b/i,
    /\bsign in\b/i,
    /\blog in\b/i,
    /\bfollow us\b/i,
    /\bshare\b/i,
    /\badvert/i,
    /\brelated\b/i,
    /\bnewsletter\b/i,
    /\ball rights reserved\b/i
  ];
  const NOISE_CONTAINER_SELECTORS = [
    'nav',
    'header',
    'footer',
    'aside',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="complementary"]',
    '[aria-label*="cookie" i]',
    '[class*="cookie" i]',
    '[id*="cookie" i]',
    '[class*="consent" i]',
    '[id*="consent" i]',
    '[class*="subscribe" i]',
    '[id*="subscribe" i]',
    '[class*="newsletter" i]',
    '[id*="newsletter" i]',
    '[class*="advert" i]',
    '[id*="advert" i]',
    '[class*="promo" i]',
    '[id*="promo" i]'
  ].join(',');
  const GENERIC_TEXT_SELECTORS = 'h1,h2,h3,p,blockquote,pre,li';
  const MAX_CANDIDATE_OPTIONS = 6;
  const SOCIAL_UI_LINE_PATTERNS = [
    /^(like|comment|share|send|follow|save)$/i,
    /^(see more|see less|view more|view fewer)$/i,
    /^(reel|story|stories|sponsored)$/i,
    /^(write a comment|most relevant|top comments)$/i
  ];

  function uniqElements(elements) {
    const seen = new Set();
    const out = [];
    for (const el of elements) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      out.push(el);
    }
    return out;
  }

  function countWords(text) {
    const normalized = String(text || '');
    if (!normalized) return 0;

    // Latin/Cyrillic/Hebrew/Arabic-like tokens separated by whitespace/punctuation.
    const alphaNumericTokens = normalized.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
    // CJK scripts are often written without spaces; approximate word count via character runs.
    const cjkChars = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || [];
    const cjkWordApprox = Math.ceil(cjkChars.length / 2);

    return alphaNumericTokens.length + cjkWordApprox;
  }

  function tokenizeWords(text) {
    const normalized = String(text || '');
    if (!normalized) return [];
    const tokens = normalized.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
    const cjkChars = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || [];
    for (const ch of cjkChars) tokens.push(ch);
    return tokens;
  }

  function estimateLinkDensity(element, textLength) {
    if (!element || textLength <= 0) return 0;
    let linkChars = 0;
    element.querySelectorAll('a').forEach((a) => {
      linkChars += (a.textContent || '').trim().length;
    });
    return Math.min(1, linkChars / textLength);
  }

  function countBoilerplateHits(text) {
    const lower = String(text || '').toLowerCase();
    let hits = 0;
    for (const pattern of BOILERPLATE_LINE_PATTERNS) {
      if (pattern.test(lower)) hits += 1;
    }
    return hits;
  }

  function collectCandidateElements() {
    const candidates = [];
    for (const selector of CONTENT_SELECTORS) {
      document.querySelectorAll(selector).forEach((el) => candidates.push(el));
    }
    if (document.body) candidates.push(document.body);
    return uniqElements(candidates);
  }

  function countSentenceLikeUnits(text) {
    return (String(text || '').match(/[.!?。！？](?:\s|$)/g) || []).length;
  }

  function getCurrentHost() {
    try {
      return String(location.hostname || '').toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function hostMatchesPattern(host, pattern) {
    if (!pattern) return false;
    if (pattern instanceof RegExp) return pattern.test(host);
    const p = String(pattern || '').toLowerCase();
    return host === p || host.endsWith('.' + p);
  }

  function sanitizeSocialText(text) {
    const lines = String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const kept = lines.filter((line) => {
      if (line.length < 2) return false;
      if (SOCIAL_UI_LINE_PATTERNS.some((p) => p.test(line))) return false;
      if (/^\d+\s*(h|hr|hrs|hour|hours|min|mins|minute|minutes|d|day|days)\b/i.test(line)) return false;
      return true;
    });
    return kept.join('\n').trim();
  }

  function buildAdapterCandidate(text, score, options) {
    const cleaned = cleanText(text || '');
    const sourceType = options && options.sourceType ? options.sourceType : 'article';
    const minChars = Number(options && options.minChars ? options.minChars : 220);
    return {
      element: (options && options.element) || null,
      score: Number.isFinite(score) ? score : 0,
      text: cleaned,
      sourceType: sourceType,
      minChars: Math.max(80, minChars),
      adapterId: (options && options.adapterId) || 'generic',
      metrics: {
        chars: cleaned.length,
        words: countWords(cleaned),
        linkDensity: 0,
        shortLineRatio: 0,
        boilerplateHits: 0
      }
    };
  }

  function extractCandidatesFromSelectorList(selectors, options) {
    const out = [];
    const seen = new Set();
    const minChars = Number(options && options.minChars ? options.minChars : 180);
    const sourceType = (options && options.sourceType) || 'article';
    const adapterId = (options && options.adapterId) || 'generic';
    const maxCandidates = Number(options && options.maxCandidates ? options.maxCandidates : 8);
    const sanitize = options && options.sanitizeSocial ? sanitizeSocialText : null;

    const elements = [];
    for (const selector of selectors || []) {
      try {
        document.querySelectorAll(selector).forEach((el) => elements.push(el));
      } catch (_) {}
    }

    for (const element of uniqElements(elements)) {
      const raw = extractTextFromElement(element);
      const cleaned = cleanText(sanitize ? sanitize(raw) : raw);
      if (cleaned.length < minChars) continue;
      const fingerprint = cleaned.slice(0, 220).toLowerCase();
      if (!fingerprint || seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const score = 170 + Math.min(130, cleaned.length / 120);
      out.push(buildAdapterCandidate(cleaned, score, {
        element,
        sourceType,
        minChars,
        adapterId
      }));
      if (out.length >= maxCandidates) break;
    }

    return out;
  }

  function extractFacebookCandidates() {
    const feedSelectors = [
      '[role="article"]',
      'div[data-pagelet*="FeedUnit"]',
      'div[data-pagelet*="ProfileTimeline"] [role="article"]'
    ];
    const postRoots = uniqElements(feedSelectors.flatMap((selector) => {
      try {
        return Array.from(document.querySelectorAll(selector));
      } catch (_) {
        return [];
      }
    }));

    const candidates = [];
    const seen = new Set();
    for (let i = 0; i < postRoots.length; i++) {
      const root = postRoots[i];
      if (!root) continue;
      const textSources = [];
      ['div[data-ad-preview="message"]', '[data-ad-comet-preview="message"]', 'div[dir="auto"]', 'span[dir="auto"]'].forEach((selector) => {
        try {
          root.querySelectorAll(selector).forEach((el) => textSources.push(cleanText(el.textContent || '')));
        } catch (_) {}
      });
      const mergedText = sanitizeSocialText(textSources.filter(Boolean).join('\n') || extractTextFromElement(root));
      const cleaned = cleanText(mergedText);
      if (cleaned.length < 120) continue;
      const fingerprint = cleaned.slice(0, 220).toLowerCase();
      if (!fingerprint || seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      candidates.push(buildAdapterCandidate(cleaned, 240 - i * 2 + Math.min(80, cleaned.length / 140), {
        element: root,
        sourceType: 'social',
        minChars: 120,
        adapterId: 'facebook'
      }));
      if (candidates.length >= 8) break;
    }

    const combined = candidates
      .slice(0, 3)
      .map((c) => c.text)
      .filter(Boolean)
      .join('\n\n');
    if (combined.length >= 180) {
      candidates.unshift(buildAdapterCandidate(combined, 320, {
        element: postRoots[0] || null,
        sourceType: 'social',
        minChars: 140,
        adapterId: 'facebook'
      }));
    }

    // Fallback for single-post view pages.
    if (!candidates.length) {
      const fallback = extractCandidatesFromSelectorList(
        ['div[data-ad-preview="message"]', '[data-ad-comet-preview="message"]', 'main [role="article"]', 'main'],
        { sourceType: 'social', minChars: 120, maxCandidates: 4, sanitizeSocial: true, adapterId: 'facebook' }
      );
      candidates.push(...fallback);
    }

    return candidates;
  }

  function extractXCandidates() {
    const tweetRoots = uniqElements([
      ...Array.from(document.querySelectorAll('article[data-testid="tweet"]')),
      ...Array.from(document.querySelectorAll('main article'))
    ]);

    const candidates = [];
    const seen = new Set();
    for (let i = 0; i < tweetRoots.length; i++) {
      const root = tweetRoots[i];
      if (!root) continue;

      const textSources = [];
      try {
        root.querySelectorAll('div[data-testid="tweetText"], [lang]').forEach((el) => {
          const text = cleanText(el.textContent || '');
          if (text) textSources.push(text);
        });
      } catch (_) {}

      const mergedText = sanitizeSocialText(textSources.join('\n') || extractTextFromElement(root));
      const cleaned = cleanText(mergedText);
      if (cleaned.length < 40) continue;
      const fingerprint = cleaned.slice(0, 220).toLowerCase();
      if (!fingerprint || seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      candidates.push(buildAdapterCandidate(cleaned, 250 - i * 2 + Math.min(70, cleaned.length / 120), {
        element: root,
        sourceType: 'social',
        minChars: 40,
        adapterId: 'x'
      }));
      if (candidates.length >= 8) break;
    }

    // Build one narrative candidate from top posts so short tweets can still form a coherent story.
    const combined = candidates
      .slice(0, 4)
      .map((c) => c.text)
      .filter(Boolean)
      .join('\n\n');
    if (combined.length >= 160) {
      candidates.unshift(buildAdapterCandidate(combined, 340, {
        element: tweetRoots[0] || null,
        sourceType: 'social',
        minChars: 140,
        adapterId: 'x'
      }));
    }

    if (!candidates.length) {
      const fallback = extractCandidatesFromSelectorList(
        ['article[data-testid="tweet"] div[data-testid="tweetText"]', 'main article [lang]', 'main article'],
        { sourceType: 'social', minChars: 40, maxCandidates: 6, sanitizeSocial: true, adapterId: 'x' }
      );
      candidates.push(...fallback);
    }

    return candidates;
  }

  const SITE_CONTENT_ADAPTERS = [
    {
      id: 'facebook',
      hosts: [/(\.|^)facebook\.com$/],
      probeSelectors: ['[role="article"]', 'div[data-pagelet*="FeedUnit"]', 'div[data-ad-preview="message"]'],
      extract: extractFacebookCandidates
    },
    {
      id: 'reddit',
      hosts: [/(\.|^)reddit\.com$/],
      selectors: ['shreddit-post', 'div[data-testid="post-container"]', 'article'],
      sourceType: 'social',
      minChars: 140
    },
    {
      id: 'x',
      hosts: [/(\.|^)(x|twitter)\.com$/],
      probeSelectors: ['article[data-testid="tweet"]', 'main article', 'div[data-testid="tweetText"]'],
      extract: extractXCandidates
    },
    {
      id: 'linkedin',
      hosts: [/(\.|^)linkedin\.com$/],
      selectors: ['div.feed-shared-update-v2', 'main article'],
      sourceType: 'social',
      minChars: 140
    },
    {
      id: 'medium',
      hosts: [/(\.|^)medium\.com$/],
      selectors: ['article', 'main article'],
      sourceType: 'article',
      minChars: 180
    },
    {
      id: 'substack',
      hosts: [/(\.|^)substack\.com$/],
      selectors: ['article.post', 'article', 'main article'],
      sourceType: 'article',
      minChars: 180
    },
    {
      id: 'github-docs',
      hosts: [/(\.|^)docs\.github\.com$/],
      selectors: ['article', 'main article'],
      sourceType: 'article',
      minChars: 180
    },
    {
      id: 'news-generic',
      hosts: [
        /(\.|^)cnn\.com$/,
        /(\.|^)nytimes\.com$/,
        /(\.|^)foxnews\.com$/,
        /(\.|^)bbc\.com$/,
        /(\.|^)reuters\.com$/,
        /(\.|^)washingtonpost\.com$/,
        /(\.|^)wsj\.com$/,
        /(\.|^)apnews\.com$/,
        /(\.|^)npr\.org$/,
        /(\.|^)theguardian\.com$/
      ],
      probeSelectors: [
        'article',
        'main article',
        '[role="main"] article',
        '[data-testid="article-body"]',
        '[class*="article-body" i]',
        '[class*="story-body" i]'
      ],
      selectors: [
        'article',
        'main article',
        '[role="main"] article',
        '[data-testid="article-body"]',
        '[class*="article-body" i]',
        '[class*="story-body" i]',
        '[class*="content-body" i]'
      ],
      sourceType: 'article',
      minChars: 180
    },
    {
      id: 'hebrew-news',
      hosts: [
        /(\.|^)ynet\.co\.il$/,
        /(\.|^)walla\.co\.il$/,
        /(\.|^)mako\.co\.il$/,
        /(\.|^)haaretz\.co\.il$/,
        /(\.|^)calcalist\.co\.il$/
      ],
      probeSelectors: [
        'article',
        'main article',
        '[role="main"] article',
        '[class*="article" i]',
        '[class*="content" i]'
      ],
      selectors: [
        'article',
        'main article',
        '[role="main"] article',
        '[class*="article-body" i]',
        '[class*="story-body" i]',
        '[class*="content" i] p'
      ],
      sourceType: 'article',
      minChars: 140
    },
    {
      id: 'chinese-content',
      hosts: [
        /(\.|^)qq\.com$/,
        /(\.|^)163\.com$/,
        /(\.|^)sohu\.com$/,
        /(\.|^)weibo\.com$/,
        /(\.|^)zhihu\.com$/
      ],
      probeSelectors: [
        'article',
        'main article',
        '[role="main"] article',
        '[class*="article" i]',
        '[class*="content" i]'
      ],
      selectors: [
        'article',
        'main article',
        '[role="main"] article',
        '[class*="article" i]',
        '[class*="content" i]',
        '[class*="RichText" i]'
      ],
      sourceType: 'article',
      minChars: 120
    }
  ];

  function pickSiteAdapterCandidatesForHost(hostOverride) {
    const host = typeof hostOverride === 'string' && hostOverride.trim()
      ? hostOverride.trim().toLowerCase()
      : getCurrentHost();
    const out = [];
    for (const adapter of SITE_CONTENT_ADAPTERS) {
      const hostMatch = Array.isArray(adapter.hosts) && adapter.hosts.some((p) => hostMatchesPattern(host, p));
      const probeMatch = Array.isArray(adapter.probeSelectors) && adapter.probeSelectors.some((selector) => {
        try {
          return !!document.querySelector(selector);
        } catch (_) {
          return false;
        }
      });
      if (!hostMatch && !probeMatch) continue;

      try {
        const extracted = typeof adapter.extract === 'function'
          ? adapter.extract()
          : extractCandidatesFromSelectorList(adapter.selectors || [], {
            sourceType: adapter.sourceType || 'article',
            minChars: adapter.minChars || 180,
            maxCandidates: adapter.maxCandidates || 8,
            sanitizeSocial: adapter.sourceType === 'social',
            adapterId: adapter.id
          });
        (extracted || []).forEach((candidate) => {
          if (candidate && typeof candidate.text === 'string' && candidate.text.length >= (candidate.minChars || 80)) {
            out.push(candidate);
          }
        });
      } catch (error) {
        testLog('adapter.error', { adapter: adapter.id, message: error && error.message ? error.message : String(error) });
      }
    }

    return out
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
      .slice(0, 18);
  }

  function pickSiteAdapterCandidates() {
    return pickSiteAdapterCandidatesForHost();
  }

  function isWikipediaArticlePage() {
    try {
      const host = String(location.hostname || '').toLowerCase();
      const path = String(location.pathname || '');
      if (!/\.wikipedia\.org$/.test(host)) return false;
      if (!path.startsWith('/wiki/')) return false;
      return !/^\/wiki\/(Special:|Talk:|File:|Category:|Template:|Help:|Portal:)/i.test(path);
    } catch (_) {
      return false;
    }
  }

  function cleanWikipediaInlineText(text) {
    return String(text || '')
      .replace(/\[[0-9]+\]/g, '')
      .replace(/\[citation needed\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractWikipediaNarrativeCandidates() {
    if (!isWikipediaArticlePage()) return [];
    const parserOutput =
      document.querySelector('#mw-content-text .mw-parser-output') ||
      document.querySelector('#bodyContent .mw-parser-output') ||
      document.querySelector('#content .mw-parser-output');
    if (!parserOutput) return [];

    const stopSectionTitles = new Set([
      'references',
      'external links',
      'see also',
      'further reading',
      'notes',
      'bibliography',
      'sources'
    ]);

    const leadParagraphs = [];
    const sectionMap = new Map();
    let currentSection = '';
    let seenFirstHeading = false;

    const children = Array.from(parserOutput.children || []);
    for (const child of children) {
      const tag = String(child.tagName || '').toLowerCase();
      if (tag === 'h2') {
        seenFirstHeading = true;
        const title = cleanWikipediaInlineText(child.textContent || '').toLowerCase();
        if (stopSectionTitles.has(title)) break;
        currentSection = title;
        if (!sectionMap.has(currentSection)) sectionMap.set(currentSection, []);
        continue;
      }

      if (tag !== 'p') continue;
      const paragraph = cleanWikipediaInlineText(child.textContent || '');
      if (paragraph.length < 90) continue;

      if (!seenFirstHeading) {
        leadParagraphs.push(paragraph);
        continue;
      }

      if (!currentSection) continue;
      sectionMap.get(currentSection).push(paragraph);
    }

    const candidates = [];
    if (leadParagraphs.length) {
      candidates.push({
        element: null,
        score: 250,
        text: cleanText(leadParagraphs.join('\n')),
        metrics: {
          chars: cleanText(leadParagraphs.join('\n')).length,
          words: countWords(leadParagraphs.join(' ')),
          linkDensity: 0,
          shortLineRatio: 0,
          boilerplateHits: 0
        }
      });
    }

    for (const [sectionTitle, paras] of sectionMap.entries()) {
      if (!paras || !paras.length) continue;
      const sectionText = cleanText(paras.join('\n'));
      if (sectionText.length < 260) continue;
      candidates.push({
        element: null,
        score: 180 + Math.min(120, sectionText.length / 110),
        text: sectionText,
        metrics: {
          chars: sectionText.length,
          words: countWords(sectionText),
          linkDensity: 0,
          shortLineRatio: 0,
          boilerplateHits: 0
        }
      });
      if (candidates.length >= MAX_CANDIDATE_OPTIONS + 2) break;
    }

    return candidates;
  }

  function collectNarrativeBlockElements(root) {
    if (!root) return [];
    const blocks = [root];
    const blockSelectors = [
      'article',
      'section',
      'main',
      '[role="main"]',
      '.article-content',
      '.entry-content',
      '.story-body',
      '.article-body',
      'div'
    ].join(',');
    root.querySelectorAll(blockSelectors).forEach((el) => {
      if (el === root) return;
      // Avoid deep tiny fragments and massive nested wrappers.
      const depth = (el.closest('article,main,[role="main"]') ? 0 : 1);
      if (depth > 4) return;
      blocks.push(el);
    });
    return uniqElements(blocks).slice(0, 280);
  }

  function isProbablyHidden(el) {
    if (!el) return true;
    if (el.hidden) return true;
    const ariaHidden = String(el.getAttribute('aria-hidden') || '').toLowerCase();
    if (ariaHidden === 'true') return true;
    const style = globalThis.getComputedStyle ? globalThis.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
    return false;
  }

  function collectGenericTextUnits() {
    const nodes = Array.from(document.querySelectorAll(GENERIC_TEXT_SELECTORS));
    const units = [];
    const seen = new Set();
    for (const el of nodes) {
      if (!el || !el.parentElement) continue;
      if (isProbablyHidden(el)) continue;
      if (el.closest(NOISE_CONTAINER_SELECTORS)) continue;

      const tag = String(el.tagName || '').toLowerCase();
      const minLen = tag === 'li' ? 60 : (tag.startsWith('h') ? 18 : 70);
      const text = cleanText(el.textContent || '');
      if (text.length < minLen) continue;

      const key = text.slice(0, 220);
      if (seen.has(key)) continue;
      seen.add(key);

      units.push({ element: el, text, tag });
      if (units.length >= 420) break;
    }
    return units;
  }

  function scoreGenericChunk(text, units) {
    const cleaned = cleanText(text || '');
    const quality = assessTextQuality(cleaned);
    const chars = quality.chars;
    const words = quality.words;
    const headingCount = (units || []).filter((u) => /^h[1-3]$/.test(String(u.tag || '').toLowerCase())).length;
    const linkDensityAvg = (() => {
      if (!Array.isArray(units) || !units.length) return 0;
      let sum = 0;
      let count = 0;
      for (const unit of units) {
        if (!unit || !unit.element) continue;
        sum += estimateLinkDensity(unit.element, (unit.text || '').length || 1);
        count += 1;
      }
      return count ? sum / count : 0;
    })();

    const score =
      Math.min(chars, 10000) / 140 +
      Math.min(words, 1800) / 70 +
      headingCount * 4 +
      quality.uniqueRatio * 48 -
      quality.shortLineRatio * 20 -
      quality.boilerplateHits * 6 -
      linkDensityAvg * 52;

    return {
      element: units && units[0] ? units[0].element : null,
      score,
      text: cleaned,
      metrics: {
        chars,
        words,
        linkDensity: linkDensityAvg,
        shortLineRatio: quality.shortLineRatio,
        boilerplateHits: quality.boilerplateHits
      }
    };
  }

  function buildGenericChunkCandidates() {
    const units = collectGenericTextUnits();
    if (units.length < 3) return [];

    const chunks = [];
    const targetChars = 2200;
    const minChars = 450;
    const stride = 3;
    for (let start = 0; start < units.length; start += stride) {
      let collected = [];
      let chars = 0;
      for (let i = start; i < units.length; i++) {
        const unit = units[i];
        collected.push(unit);
        chars += (unit.text || '').length + 1;
        if (chars >= targetChars) break;
      }
      if (chars < minChars) continue;
      const combined = collected.map((u) => u.text).join('\n');
      const candidate = scoreGenericChunk(combined, collected);
      if (candidate.metrics.words >= 90 && candidate.metrics.linkDensity <= 0.65) {
        chunks.push(candidate);
      }
      if (chunks.length >= 28) break;
    }
    return chunks;
  }

  function scoreCandidateElement(element, rootHint) {
    const cleanedText = cleanText(extractTextFromElement(element));
    const chars = cleanedText.length;
    if (chars < 260) return { element, score: -Infinity, text: cleanedText };

    const words = countWords(cleanedText);
    const lines = cleanedText.split('\n').map((line) => line.trim()).filter(Boolean);
    const longLines = lines.filter((line) => line.length >= 80).length;
    const shortLines = lines.filter((line) => line.length < 32).length;
    const paragraphs = lines.filter((line) => line.length >= 60).length;
    const sentenceLikeUnits = countSentenceLikeUnits(cleanedText);
    const sentenceDensity = words > 0 ? sentenceLikeUnits / words : 0;
    const shortLineRatio = lines.length > 0 ? shortLines / lines.length : 1;
    const linkDensity = estimateLinkDensity(element, chars);
    const boilerplateHits = countBoilerplateHits(cleanedText);
    const tagName = String(element.tagName || '').toLowerCase();
    const className = String(element.className || '').toLowerCase();
    const semanticBonus = (tagName === 'article' || tagName === 'main' || element.getAttribute('role') === 'main') ? 18 : 0;
    const bodyPenalty = element === document.body ? 25 : 0;
    const listLikePenalty = /\b(feed|list|grid|headline|breaking|promo|teaser|rail|trending)\b/.test(className) ? 18 : 0;
    const adPenalty = /\b(ad-feedback|advert|sponsor|consent|cookie)\b/.test(className) ? 70 : 0;
    const rootMismatchPenalty = rootHint && element !== rootHint && !rootHint.contains(element) ? 8 : 0;
    const oversizePenalty = Math.max(0, chars - 18000) / 700;
    const lowSentencePenalty = sentenceDensity < 0.007 ? 28 : 0;
    const lowNarrativePenalty = longLines < 2 ? 14 : 0;
    const shortLinePenalty = shortLineRatio > 0.55 ? 18 : 0;
    const linkHardPenalty = linkDensity > 0.55 ? 55 : 0;
    const linkSoftPenalty = linkDensity * 120;

    const score =
      Math.min(chars, 14000) / 115 +
      Math.min(words, 2500) / 60 +
      paragraphs * 2.5 +
      longLines * 1.8 +
      semanticBonus -
      linkSoftPenalty -
      linkHardPenalty -
      boilerplateHits * 9 -
      listLikePenalty -
      adPenalty -
      bodyPenalty -
      lowSentencePenalty -
      lowNarrativePenalty -
      shortLinePenalty -
      rootMismatchPenalty -
      oversizePenalty;

    return {
      element,
      score,
      text: cleanedText,
      metrics: {
        chars,
        words,
        paragraphs,
        longLines,
        shortLineRatio,
        sentenceLikeUnits,
        sentenceDensity,
        linkDensity,
        boilerplateHits
      }
    };
  }

  function pickBestContentCandidate() {
    const roots = collectCandidateElements();
    const scored = roots
      .flatMap((root) => collectNarrativeBlockElements(root).map((block) => scoreCandidateElement(block, root)))
      .filter((c) => Number.isFinite(c.score))
      .sort((a, b) => b.score - a.score);
    for (const candidate of scored) {
      const m = candidate.metrics || {};
      const pass =
        Number.isFinite(candidate.score) &&
        (m.linkDensity == null || m.linkDensity <= 0.55) &&
        (m.shortLineRatio == null || m.shortLineRatio <= 0.72) &&
        (m.words == null || m.words >= 55) &&
        (m.boilerplateHits == null || m.boilerplateHits <= 8);
      if (pass) return candidate;
    }
    return null;
  }

  function pickContentCandidates() {
    const adapterCandidates = pickSiteAdapterCandidates();
    const wikipediaCandidates = extractWikipediaNarrativeCandidates();
    const roots = collectCandidateElements();
    const structural = roots
      .flatMap((root) => collectNarrativeBlockElements(root).map((block) => scoreCandidateElement(block, root)))
      .filter((c) => Number.isFinite(c.score))
      .filter((candidate) => {
      const m = candidate.metrics || {};
      return (
        (m.linkDensity == null || m.linkDensity <= 0.55) &&
        (m.shortLineRatio == null || m.shortLineRatio <= 0.72) &&
        (m.words == null || m.words >= 55) &&
        (m.boilerplateHits == null || m.boilerplateHits <= 8)
      );
    });
    const generic = buildGenericChunkCandidates();
    const merged = [...adapterCandidates, ...wikipediaCandidates, ...structural, ...generic]
      .filter((c) => {
        if (!c || typeof c.text !== 'string') return false;
        const minChars = Number(c.minChars || 220);
        return c.text.length >= Math.max(80, minChars);
      })
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

    const deduped = [];
    const seen = new Set();
    for (const candidate of merged) {
      const fingerprint = cleanText(candidate.text || '')
        .slice(0, 220)
        .toLowerCase();
      if (!fingerprint || seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      deduped.push(candidate);
      if (deduped.length >= 24) break;
    }
    return deduped;
  }

  function stripBoilerplateLines(text) {
    const lines = String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const kept = lines.filter((line) => {
      const words = countWords(line);
      if (/^•+$/.test(line)) return false;
      if (/^video$/i.test(line)) return false;
      if (/^live updates?$/i.test(line)) return false;
      if (/^\d{1,2}:\d{2}$/.test(line)) return false;
      if (line.length < 18 && words <= 3) return false;
      const isBoilerplate = BOILERPLATE_LINE_PATTERNS.some((p) => p.test(line));
      if (!isBoilerplate) return true;
      // Keep long lines even if they contain a keyword to avoid false positives.
      return line.length >= 180;
    });
    return kept.join('\n').trim();
  }

  function assessTextQuality(text, options) {
    const sourceType = options && options.sourceType ? String(options.sourceType) : 'article';
    const isSocial = sourceType === 'social';
    const normalized = String(text || '');
    const chars = normalized.length;
    const words = countWords(normalized);
    const uniqueWords = new Set(tokenizeWords(normalized).map((t) => String(t).toLowerCase())).size;
    const uniqueRatio = words > 0 ? uniqueWords / words : 0;
    const lines = normalized.split('\n').filter(Boolean);
    const shortLines = lines.filter((line) => line.length < 28).length;
    const shortLineRatio = lines.length > 0 ? shortLines / lines.length : 1;
    const boilerplateHits = countBoilerplateHits(normalized);

    const sentenceLikeUnits = countSentenceLikeUnits(normalized);
    const sentenceDensity = words > 0 ? sentenceLikeUnits / words : 0;
    const pass =
      chars >= (isSocial ? 120 : 220) &&
      words >= (isSocial ? 30 : 70) &&
      uniqueRatio >= (isSocial ? 0.1 : 0.16) &&
      shortLineRatio <= (isSocial ? 0.9 : 0.82) &&
      boilerplateHits <= (isSocial ? 18 : 14) &&
      sentenceDensity >= (isSocial ? 0.002 : 0.004);
    return { pass, chars, words, uniqueRatio, shortLineRatio, boilerplateHits };
  }

  function splitIntoParagraphs(text) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  function takeParagraphBudget(paragraphs, budget, fromEnd) {
    const chosen = [];
    let used = 0;
    const ordered = fromEnd ? [...paragraphs].reverse() : paragraphs;
    for (const para of ordered) {
      if (used >= budget) break;
      const safe = para.slice(0, Math.max(40, budget - used));
      chosen.push(safe);
      used += safe.length + 1;
    }
    return fromEnd ? chosen.reverse() : chosen;
  }

  function buildSmartExcerpt(text, maxLength) {
    const paragraphs = splitIntoParagraphs(text);
    if (!paragraphs.length) return String(text || '').slice(0, maxLength);

    const leadBudget = Math.floor(maxLength * 0.45);
    const tailBudget = Math.floor(maxLength * 0.25);
    const midBudget = Math.max(200, maxLength - leadBudget - tailBudget - 32);

    const lead = takeParagraphBudget(paragraphs, leadBudget, false);
    const tail = takeParagraphBudget(paragraphs, tailBudget, true);

    const usedByLead = new Set(lead);
    const usedByTail = new Set(tail);
    const middleCandidates = paragraphs.filter((p) => !usedByLead.has(p) && !usedByTail.has(p));
    const midStart = Math.max(0, Math.floor((middleCandidates.length - 1) / 2) - 2);
    const middleWindow = middleCandidates.slice(midStart);
    const middle = takeParagraphBudget(middleWindow, midBudget, false);

    const parts = [];
    if (lead.length) parts.push(lead.join('\n'));
    if (middle.length) parts.push(middle.join('\n'));
    if (tail.length) parts.push(tail.join('\n'));

    return parts.join('\n...\n').slice(0, maxLength);
  }

  function fallbackSummary(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return 'No summary available';
    const sentence = normalized.split(/[.!?]\s+/).find(Boolean) || normalized;
    return sentence.slice(0, 160) + (sentence.length > 160 ? '...' : '');
  }

  async function summarizeCandidateText(text) {
    const sample = String(text || '').slice(0, 2200);
    if (!sample) return 'No summary available';
    try {
      const ai = globalThis.ai;
      if (ai && ai.summarizer && typeof ai.summarizer.create === 'function') {
        const timeoutMs = 500;
        const withTimeout = (promise) => Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('summary-timeout')), timeoutMs))
        ]);
        const summarizer = await withTimeout(ai.summarizer.create({ type: 'tl;dr', format: 'plain-text', length: 'short' }));
        const summary = await withTimeout(summarizer.summarize(sample));
        if (summarizer && typeof summarizer.destroy === 'function') summarizer.destroy();
        const out = String(summary || '').replace(/\s+/g, ' ').trim();
        if (out) return out.slice(0, 180);
      }
    } catch (_) {}
    return fallbackSummary(sample);
  }

  async function buildCandidateOptions(candidates) {
    const top = (candidates || []).slice(0, MAX_CANDIDATE_OPTIONS);
    const options = [];
    for (let i = 0; i < top.length; i++) {
      const c = top[i];
      const stripped = stripBoilerplateLines(c.text || '');
      // Keep extraction responsive: always have a local summary immediately.
      let summary = fallbackSummary(stripped);
      // Use built-in summarizer only for the first few options.
      if (i < 3) {
        const aiSummary = await summarizeCandidateText(stripped);
        if (aiSummary) summary = aiSummary;
      }
      options.push({
        id: 'candidate_' + i,
        summary: summary,
        chars: c.metrics && c.metrics.chars ? c.metrics.chars : 0,
        score: Number.isFinite(c.score) ? Number(c.score.toFixed(2)) : 0
      });
    }
    return options;
  }

  // Simple readability parser
  async function extractReadableContent(mode, selection) {
    try {
      testLog('extract.start', {
        mode: mode,
        selectedCandidateId: selection && selection.selectedCandidateId ? selection.selectedCandidateId : ''
      });
      // Mode A: User selection
      if (mode === 'selection') {
        const selectedText = window.getSelection()?.toString()?.trim();
        
        if (selectedText && selectedText.length > 50) {
          testLog('extract.selection.success', { chars: selectedText.length });
          return {
            success: true,
            text: selectedText,
            mode: 'selection'
          };
        }
        
        testLog('extract.selection.empty', null);
        return {
          success: false,
          error: 'No text selected. Please select some text on the page and try again.',
          mode: 'selection'
        };
      }

      // If user has an active selection, prefer it over noisy full-page extraction.
      const selectedText = window.getSelection()?.toString()?.trim();
      if (selectedText && selectedText.length > 220) {
        testLog('extract.selection_auto.success', { chars: selectedText.length });
        return {
          success: true,
          text: cleanText(selectedText),
          mode: 'selection_auto'
        };
      }

      // Mode B: Full page extraction
      const candidates = pickContentCandidates();
      const candidateOptions = await buildCandidateOptions(candidates);
      testLog('extract.candidates.built', {
        candidateCount: candidates.length,
        optionCount: candidateOptions.length
      });
      const requestedCandidateId = selection && typeof selection.selectedCandidateId === 'string'
        ? selection.selectedCandidateId
        : '';
      const requestedIndex = requestedCandidateId ? Number(String(requestedCandidateId).replace('candidate_', '')) : -1;
      let best = Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < candidates.length
        ? candidates[requestedIndex]
        : (candidates[0] || null);
      if (!best || best.score < -8) {
        testLog('extract.full.failed.no_best', { bestScore: best ? best.score : null });
        return {
          success: false,
          error: 'Could not extract enough readable content from this page.',
          mode: 'full',
          quality: { score: best ? best.score : 0 }
        };
      }

      let text = stripBoilerplateLines(best.text);
      let quality = assessTextQuality(text, { sourceType: best.sourceType });

      // Domain-agnostic fallback: auto-pick first candidate that passes quality.
      if (!quality.pass && !(Number.isInteger(requestedIndex) && requestedIndex >= 0)) {
        for (let i = 1; i < candidates.length; i++) {
          const probe = stripBoilerplateLines(candidates[i].text || '');
          const probeQuality = assessTextQuality(probe, { sourceType: candidates[i].sourceType });
          if (probeQuality.pass) {
            best = candidates[i];
            text = probe;
            quality = probeQuality;
            break;
          }
        }
      }

      if (!quality.pass) {
        testLog('extract.full.failed.quality', quality);
        return {
          success: false,
          error: 'Could not extract enough readable content from this page.',
          mode: 'full',
          quality: quality
        };
      }

      testLog('extract.full.success', {
        chars: text.length,
        selectedCandidateId: Number.isInteger(requestedIndex) && requestedIndex >= 0
          ? ('candidate_' + requestedIndex)
          : (candidateOptions[0] ? candidateOptions[0].id : '')
      });
      return {
        success: true,
        text: text,
        mode: 'full',
        quality: quality,
        selectedCandidateId: (() => {
          const resolved = Number.isInteger(requestedIndex) && requestedIndex >= 0
            ? requestedIndex
            : Math.max(0, candidates.indexOf(best));
          const safe = Math.min(Math.max(0, resolved), Math.max(0, candidateOptions.length - 1));
          return candidateOptions[safe] ? candidateOptions[safe].id : '';
        })(),
        candidates: candidateOptions
      };
    } catch (error) {
      testLog('extract.error', { message: error && error.message ? error.message : String(error) });
      return {
        success: false,
        error: 'Error extracting content: ' + error.message,
        mode: mode
      };
    }
  }

  function extractTextFromElement(element) {
    const clone = element.cloneNode(true);
    
    // Remove unwanted elements
    const unwantedSelectors = [
      'script',
      'style',
      'noscript',
      'iframe',
      'nav',
      'header',
      'footer',
      'aside',
      '.sidebar',
      '.advertisement',
      '.ad',
      '.social-share',
      '.comments',
      '.related-posts',
      '[role="navigation"]',
      '[role="banner"]',
      '[role="complementary"]'
    ];

    unwantedSelectors.forEach(selector => {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    });

    return clone.textContent || clone.innerText || '';
  }

  function cleanText(text) {
    return text
      .replace(/\r/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/[ \f\v]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n')
      .trim();
  }

  // Truncate text if too long
  function truncateText(text, maxLength = 15000) {
    if (text.length <= maxLength) {
      return {
        text,
        truncated: false,
        originalLength: text.length
      };
    }

    const excerpt = buildSmartExcerpt(text, maxLength);

    return {
      text: excerpt + '\n...[content truncated]',
      truncated: true,
      originalLength: text.length,
      truncatedAt: excerpt.length
    };
  }

  if (TEST_VERBOSE_LOGS) {
    try {
      globalThis.__WEB2COMICS_CONTENT_TEST_API__ = {
        pickSiteAdapterCandidates: pickSiteAdapterCandidates,
        pickSiteAdapterCandidatesForHost: pickSiteAdapterCandidatesForHost,
        pickContentCandidates: pickContentCandidates,
        extractReadableContent: extractReadableContent,
        assessTextQuality: assessTextQuality,
        sanitizeSocialText: sanitizeSocialText
      };
    } catch (_) {}
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    testLog('message.received', { type: message && message.type });
    switch (message.type) {
      case MESSAGE_TYPES.EXTRACT_CONTENT:
        (async () => {
          const mode = message.payload?.mode || 'full';
          const result = await extractReadableContent(mode, message.payload || {});
          
          // Apply truncation if needed
          if (result.success) {
            const truncated = truncateText(result.text);
            result.text = truncated.text;
            result.truncated = truncated.truncated;
            result.originalLength = truncated.originalLength;
          }
          
          sendResponse(result);
        })();
        break;

      case MESSAGE_TYPES.START_GENERATION:
        // Forward to background service worker
        chrome.runtime.sendMessage(message)
          .then(response => sendResponse(response))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }

    return true;
  });

  // Notify that content script is ready
  console.log('Web to Comic content script loaded');
})();
