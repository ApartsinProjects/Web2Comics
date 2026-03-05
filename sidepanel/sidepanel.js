class ComicViewer {
  constructor() {
    this.layoutPresets = {
      'single-panel-full': { mode: 'panels', displayClass: 'preset-poster-grid', generationClass: 'preset-poster-grid' },
      'split-2-vertical': { mode: 'panels', displayClass: 'preset-storyboard-grid', generationClass: 'preset-storyboard-grid' },
      'split-2-horizontal': { mode: 'strip', displayClass: 'preset-wide-strip', generationClass: 'preset-wide-strip' },
      'classic-strip': { mode: 'strip', displayClass: 'preset-classic-strip', generationClass: 'preset-classic-strip' }, // 3-panel strip (Horizontal)
      'strip-4-horizontal': { mode: 'strip', displayClass: 'preset-wide-strip', generationClass: 'preset-wide-strip' },
      'stack-3-vertical': { mode: 'panels', displayClass: 'preset-storyboard-grid', generationClass: 'preset-storyboard-grid' },
      'grid-4': { mode: 'panels', displayClass: 'preset-storyboard-grid', generationClass: 'preset-storyboard-grid' },
      'square-comic-grid': { mode: 'panels', displayClass: 'preset-contact-sheet', generationClass: 'preset-contact-sheet' },
      'a4-comic-page': { mode: 'panels', displayClass: 'preset-magazine-grid', generationClass: 'preset-magazine-grid' },
      'a5-comic-page': { mode: 'panels', displayClass: 'preset-storyboard-grid', generationClass: 'preset-storyboard-grid' },
      'grid-6': { mode: 'panels', displayClass: 'preset-magazine-grid', generationClass: 'preset-magazine-grid' },
      'grid-9': { mode: 'panels', displayClass: 'preset-contact-sheet', generationClass: 'preset-contact-sheet' },
      'classic-comic-page': { mode: 'panels', displayClass: 'preset-magazine-grid', generationClass: 'preset-magazine-grid' },
      'manga-page-rtl': { mode: 'panels', displayClass: 'preset-reading-grid', generationClass: 'preset-reading-grid' },
      'webtoon-scroll': { mode: 'panels', displayClass: 'preset-reading-grid', generationClass: 'preset-reading-grid' },
      'filmstrip': { mode: 'strip', displayClass: 'preset-compact-strip', generationClass: 'preset-compact-strip' },
      'spotlight': { mode: 'carousel', displayClass: 'preset-focus-carousel', generationClass: 'preset-focus-carousel' },
      'dominant-supporting': { mode: 'panels', displayClass: 'preset-poster-grid', generationClass: 'preset-poster-grid' },
      'two-tier': { mode: 'panels', displayClass: 'preset-magazine-grid', generationClass: 'preset-magazine-grid' },
      'three-tier': { mode: 'panels', displayClass: 'preset-magazine-grid', generationClass: 'preset-magazine-grid' },
      'side-gutter-captions': { mode: 'panels', displayClass: 'preset-reading-grid', generationClass: 'preset-reading-grid' },
      'caption-first': { mode: 'panels', displayClass: 'preset-reading-grid', generationClass: 'preset-reading-grid' },
      'polaroid-collage': { mode: 'panels', displayClass: 'preset-contact-sheet', generationClass: 'preset-contact-sheet' },
      'masonry': { mode: 'panels', displayClass: 'preset-contact-sheet', generationClass: 'preset-contact-sheet' },
      'masonry-landscape-2': { mode: 'panels', displayClass: 'preset-contact-sheet', generationClass: 'preset-contact-sheet' },
      'masonry-landscape-3': { mode: 'panels', displayClass: 'preset-contact-sheet', generationClass: 'preset-contact-sheet' },
      'masonry-landscape-4': { mode: 'panels', displayClass: 'preset-contact-sheet', generationClass: 'preset-contact-sheet' },
      'carousel': { mode: 'carousel', displayClass: 'preset-cinema-carousel', generationClass: 'preset-cinema-carousel' },
      'guided-path': { mode: 'panels', displayClass: 'preset-reading-grid', generationClass: 'preset-reading-grid' },
      // Legacy aliases kept for persisted preferences and older tests/links.
      'compact-strip': { mode: 'strip', displayClass: 'preset-compact-strip', generationClass: 'preset-compact-strip' },
      'wide-strip': { mode: 'strip', displayClass: 'preset-wide-strip', generationClass: 'preset-wide-strip' },
      'storyboard-grid': { mode: 'panels', displayClass: 'preset-storyboard-grid', generationClass: 'preset-storyboard-grid' },
      'magazine-grid': { mode: 'panels', displayClass: 'preset-magazine-grid', generationClass: 'preset-magazine-grid' },
      'poster-grid': { mode: 'panels', displayClass: 'preset-poster-grid', generationClass: 'preset-poster-grid' },
      'focus-carousel': { mode: 'carousel', displayClass: 'preset-focus-carousel', generationClass: 'preset-focus-carousel' },
      'cinema-carousel': { mode: 'carousel', displayClass: 'preset-cinema-carousel', generationClass: 'preset-cinema-carousel' },
      'contact-sheet': { mode: 'panels', displayClass: 'preset-contact-sheet', generationClass: 'preset-contact-sheet' },
      'reading-grid': { mode: 'panels', displayClass: 'preset-reading-grid', generationClass: 'preset-reading-grid' }
    };
    this.layoutPresetAliases = {
      'compact-strip': 'filmstrip',
      'wide-strip': 'split-2-horizontal',
      'storyboard-grid': 'grid-4',
      'magazine-grid': 'classic-comic-page',
      'poster-grid': 'single-panel-full',
      'focus-carousel': 'spotlight',
      'cinema-carousel': 'carousel',
      'contact-sheet': 'masonry',
      'reading-grid': 'guided-path'
    };
    this.currentComic = null;
    this.currentComicId = '';
    this.viewMode = 'panels';
    this.layoutPreset = 'polaroid-collage';
    this.primaryView = 'comic';
    this.carouselIndex = 0;
    this.historyItems = [];
    this.historyBrowserLimit = 12;
    this.historyFavoritesOnly = false;
    this.historySortMode = 'manual';
    this.historyThumbnailMap = new Map();
    this.storageUsageBytes = 0;
    this.generationStartedAtMs = 0;
    this.generationFirstPanelAtMs = 0;
    this.pollTimer = null;
    this.lastTerminalJobNoticeKey = '';
    this.missingCaptionNoticeKeys = new Set();
    this.selectedShareTarget = 'facebook';
    this.visibleShareTargets = new Set();
    this.panelEditState = {};
    this.historyPreviewFallbackCache = new Map();
    this.init();
  }

  async init() {
    await this.loadPrefs();
    await this.loadCurrentJob();
    this.bindEvents();
    this.bindStorageListeners();
    this.bindRuntimeListeners();
    this.syncLayoutPresetUI();
    this.applyLayoutPreset();
    await this.loadHistory();
    await this.applyInitialViewPreference();
    await this.refreshStorageUsage();
    await this.refreshShareTargetVisibility();
  }

  async applyInitialViewPreference() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const urlView = String(params.get('view') || '').trim().toLowerCase();
      if (urlView === 'history' || urlView === 'comic') {
        this.setPrimaryView(urlView);
        return;
      }
    } catch (_) {}

    try {
      const stored = await chrome.storage.local.get('sidepanelInitialView');
      const nextView = String(stored?.sidepanelInitialView || '').trim().toLowerCase();
      if (nextView === 'history' || nextView === 'comic') {
        this.setPrimaryView(nextView);
        await chrome.storage.local.remove('sidepanelInitialView');
      }
    } catch (_) {}
  }

  async appendDebugLog(event, data) {
    try {
      const { debugLogs } = await chrome.storage.local.get('debugLogs');
      const logs = Array.isArray(debugLogs) ? debugLogs : [];
      logs.push({
        ts: new Date().toISOString(),
        source: 'sidepanel',
        event,
        ...(data && typeof data === 'object' ? { data } : {})
      });
      if (logs.length > 1000) logs.splice(0, logs.length - 1000);
      await chrome.storage.local.set({ debugLogs: logs });
    } catch (_) {}
  }

  async trackMetric(eventName, payload) {
    try {
      await chrome.runtime.sendMessage({
        type: 'TRACK_METRIC',
        payload: {
          event: eventName,
          ts: Date.now(),
          ...(payload || {})
        }
      });
    } catch (_) {}
  }

  escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  renderFactChips(values) {
    const items = Array.isArray(values) ? values : [];
    if (!items.length) return '';
    return items
      .map((item) => `<span class="panel-fact-chip">${this.escapeHtml(item)}</span>`)
      .join('');
  }

  normalizeTextToken(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  filterRelevantFacts(values, contextText, maxItems) {
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!items.length) return [];
    const normalizedContext = this.normalizeTextToken(contextText);
    if (!normalizedContext) return items.slice(0, maxItems);

    const relevant = items.filter((item) => {
      const token = this.normalizeTextToken(item);
      if (!token || token.length < 2) return false;
      return normalizedContext.includes(token);
    });
    if (relevant.length) return relevant.slice(0, maxItems);
    return items.slice(0, Math.min(maxItems, 2));
  }

  getGroundingLevel(factCount) {
    const count = Number(factCount) || 0;
    if (count >= 5) return 'high';
    if (count >= 2) return 'medium';
    return 'low';
  }

  getGroundingTooltip(level, factCount) {
    const count = Math.max(0, Number(factCount) || 0);
    const levelKey = String(level || 'low').toLowerCase();
    const label = levelKey === 'high' ? 'High' : levelKey === 'medium' ? 'Medium' : 'Low';
    const meaning = levelKey === 'high'
      ? 'Strong grounding to extracted source facts.'
      : levelKey === 'medium'
        ? 'Partial grounding to extracted source facts.'
        : 'Limited grounding to extracted source facts.';
    return `Grounding: ${label} (${count} evidence points). ${meaning}`;
  }

  sanitizeExternalUrl(url) {
    try {
      const parsed = new URL(String(url || ''));
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch (_) {}
    return '#';
  }

  getFaviconUrl(sourceUrl) {
    const value = String(sourceUrl || '').trim();
    if (!value) return '';

    // Prefer native URL parsing when available, but keep a resilient fallback for tests.
    try {
      const parsed = new URL(value);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin) {
        return parsed.origin.replace(/\/+$/, '') + '/favicon.ico';
      }
    } catch (_) {}

    const match = value.match(/^https?:\/\/[^\/?#]+/i);
    if (!match) return '';
    return match[0].replace(/\/+$/, '') + '/favicon.ico';
  }

  updateComicSourceFavicon(sourceUrl) {
    const faviconEl = document.getElementById('comic-source-favicon');
    if (!faviconEl) return;
    const faviconUrl = this.getFaviconUrl(sourceUrl);
    if (!faviconUrl) {
      faviconEl.classList.add('hidden');
      faviconEl.removeAttribute('src');
      return;
    }
    faviconEl.classList.remove('hidden');
    faviconEl.src = faviconUrl;
    faviconEl.onerror = () => {
      faviconEl.classList.add('hidden');
    };
  }

  getManualSourceInfo(source) {
    const info = source && typeof source === 'object' ? source : {};
    const sourceType = String(info.source_type || '').toLowerCase();
    const manualStoryText = String(info.manual_story_text || '').trim();
    const isManual = sourceType === 'manual_text' || !!manualStoryText;
    if (!isManual) return null;
    const title = String(info.manual_story_title || info.title || 'Custom Story').trim() || 'Custom Story';
    return { title, text: manualStoryText };
  }

  openManualSourceWindow(sourceInfo) {
    const info = sourceInfo && typeof sourceInfo === 'object' ? sourceInfo : {};
    const text = String(info.text || '').trim();
    if (!text) {
      alert('No manual story text is available for this comic.');
      return;
    }
    const title = String(info.title || 'Custom Story').trim() || 'Custom Story';
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) {
      alert('Unable to open source story window. Please allow pop-ups for this extension.');
      return;
    }
    const safeTitle = this.escapeHtml(title);
    const safeText = this.escapeHtml(text);
    popup.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} - Source Story</title><style>body{font-family:Segoe UI,Tahoma,Arial,sans-serif;margin:0;padding:20px;background:#f8fafc;color:#111827;line-height:1.55}main{max-width:860px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:18px 20px;box-shadow:0 6px 18px rgba(15,23,42,.08)}h1{margin:0 0 10px;font-size:1.3rem}p.meta{margin:0 0 14px;color:#475569}pre{margin:0;white-space:pre-wrap;word-break:break-word;font:inherit;color:inherit}</style></head><body><main><h1>${safeTitle}</h1><p class="meta">User-provided source story</p><pre>${safeText}</pre></main></body></html>`);
    popup.document.close();
  }

  handleComicSourceClick(event) {
    const manualInfo = this.getManualSourceInfo(this.currentComic?.source);
    if (!manualInfo) return;
    event.preventDefault();
    this.openManualSourceWindow(manualInfo);
  }

  getProviderDisplayLabel(providerId) {
    const labels = {
      'gemini-free': 'Gemini',
      'openai': 'OpenAI',
      'cloudflare-free': 'Cloudflare',
      'openrouter': 'OpenRouter',
      'huggingface': 'Hugging Face'
    };
    return labels[String(providerId || '')] || String(providerId || 'provider');
  }

  isCaptionPlaceholderPanel(panel) {
    if (!panel) return true;
    if (typeof panel !== 'object') return false;
    const keys = Object.keys(panel);
    if (!keys.length) return true;
    // Placeholder panel objects can contain runtime status only while the storyboard fills in.
    if (keys.length === 1 && keys[0] === 'runtime_status') return true;
    return false;
  }

  looksLikeImagePromptText(text) {
    const s = String(text || '').trim();
    if (!s) return false;
    const lower = s.toLowerCase();
    if (s.length > 220) return true;
    const promptPhrases = [
      'comic panel illustration',
      'illustration of',
      'digital art',
      'cinematic lighting',
      'highly detailed',
      'camera angle',
      'art style',
      'dramatic lighting',
      'ultra detailed'
    ];
    if (promptPhrases.some((p) => lower.includes(p))) return true;
    const commaCount = (s.match(/,/g) || []).length;
    if (commaCount >= 6) return true;
    return false;
  }

  getStoryLikeFallbackCaption(panel) {
    if (!panel || typeof panel !== 'object') return '';
    const candidates = [
      panel.beat_summary,
      panel.summary,
      panel.beat,
      panel.narration,
      panel.description,
      panel.title,
      panel.text,
      panel.text_content,
      panel.caption_text,
      panel.dialogue
    ];
    for (const candidate of candidates) {
      const normalized = this.normalizeCaptionValue(candidate);
      if (normalized && !this.looksLikeImagePromptText(normalized)) return normalized;
    }
    return '';
  }

  getPanelCaptionText(panel, index, options = {}) {
    const suppressMissingLog = !!options.suppressMissingLog;
    const fallbackLabel = options.fallbackLabel || ('Panel ' + ((Number(index) || 0) + 1));
    if (this.isCaptionPlaceholderPanel(panel)) {
      return fallbackLabel;
    }
    var caption =
      (panel && (
        panel.caption ||
        panel.beat_summary ||
        panel.summary ||
        panel.title ||
        panel.text ||
        panel.narration ||
        panel.description ||
        panel.text_content ||
        panel.caption_text ||
        panel.dialogue
      )) || '';
    caption = this.normalizeCaptionValue(caption);
    if (caption) {
      const imagePrompt = this.normalizeCaptionValue(
        panel && (panel.image_prompt || panel.prompt || panel.imagePrompt || panel.visual_prompt || panel.scene_prompt)
      );
      if (this.looksLikeImagePromptText(caption) || (imagePrompt && caption === imagePrompt)) {
        const storyLike = this.getStoryLikeFallbackCaption(panel);
        if (storyLike && storyLike !== caption) {
          this.logPromptLikeCaptionSubstitution(panel, index, caption, storyLike);
          return storyLike;
        }
      }
      return caption;
    }
    if (!suppressMissingLog) this.logMissingCaption(panel, index);
    return fallbackLabel;
  }

  normalizeComicTitleCandidate(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s|:/\\\-–—•]+|[\s|:/\\\-–—•]+$/g, '')
      .trim();
  }

  truncateComicTitle(value, maxLen = 96) {
    const normalized = this.normalizeComicTitleCandidate(value);
    if (!normalized) return '';
    if (normalized.length <= maxLen) return normalized;
    return normalized.slice(0, maxLen - 1).trim() + '…';
  }

  isGenericHistoryTitle(value) {
    const normalized = this.normalizeComicTitleCandidate(value).toLowerCase();
    if (!normalized) return true;
    const generic = new Set([
      'web2comics',
      'comic summary',
      'story summary',
      'untitled',
      'untitled comic'
    ]);
    if (generic.has(normalized)) return true;
    return /^web2comics\b/.test(normalized);
  }

  deriveHistoryCardTitle(item) {
    const storyboard = item?.storyboard || {};
    const candidates = [
      storyboard.collection_title_short,
      storyboard.title,
      item?.source?.title,
      item?.sourceTitle,
      storyboard?.source?.title
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const title = this.normalizeComicTitleCandidate(candidates[i]);
      if (title && !this.isGenericHistoryTitle(title)) {
        return this.truncateComicTitle(title, 52);
      }
    }
    const panelDerived = this.deriveComicTitleFromPanels(storyboard);
    if (panelDerived && !this.isGenericHistoryTitle(panelDerived)) {
      return this.truncateComicTitle(panelDerived, 52);
    }
    return 'Story Summary';
  }

  countStoryboardImagePanels(storyboard) {
    const panels = Array.isArray(storyboard?.panels) ? storyboard.panels : [];
    let count = 0;
    for (let i = 0; i < panels.length; i += 1) {
      const src = this.getPanelImageSource(panels[i]);
      if (src) count += 1;
    }
    return count;
  }

  resolveImageSourceValue(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'object') {
      const obj = value || {};
      const candidate = obj.url || obj.data_url || obj.href || obj.src || '';
      return typeof candidate === 'string' ? candidate.trim() : '';
    }
    return '';
  }

  getPanelImageSource(panel) {
    return this.resolveImageSourceValue(panel?.artifacts?.image_blob_ref) ||
      this.resolveImageSourceValue(panel?.artifacts?.image_url) ||
      this.resolveImageSourceValue(panel?.image_blob_ref) ||
      this.resolveImageSourceValue(panel?.image_url) ||
      '';
  }

  isSameStoryboardIdentity(left, right) {
    if (!left || !right) return false;
    const leftUrl = String(left?.source?.url || '').trim();
    const rightUrl = String(right?.source?.url || '').trim();
    if (leftUrl && rightUrl) return leftUrl === rightUrl;

    const leftTitle = this.normalizeComicTitleCandidate(left?.source?.title || left?.title || '');
    const rightTitle = this.normalizeComicTitleCandidate(right?.source?.title || right?.title || '');
    if (!leftTitle || !rightTitle) return false;
    if (leftTitle !== rightTitle) return false;
    const leftPanels = Array.isArray(left?.panels) ? left.panels.length : 0;
    const rightPanels = Array.isArray(right?.panels) ? right.panels.length : 0;
    return leftPanels > 0 && leftPanels === rightPanels;
  }

  mergeStoryboardImageRefs(storyboard, fallbackStoryboard) {
    const basePanels = Array.isArray(storyboard?.panels) ? storyboard.panels : null;
    const fallbackPanels = Array.isArray(fallbackStoryboard?.panels) ? fallbackStoryboard.panels : null;
    if (!basePanels || !fallbackPanels || !basePanels.length || !fallbackPanels.length) return storyboard;

    let recoveredCount = 0;
    const nextPanels = basePanels.map((panel, index) => {
      const sourcePanel = panel && typeof panel === 'object' ? panel : {};
      const ownArtifacts = sourcePanel.artifacts && typeof sourcePanel.artifacts === 'object'
        ? { ...sourcePanel.artifacts }
        : {};
      const ownSrc = this.getPanelImageSource(sourcePanel);
      if (ownSrc) return sourcePanel;

      const panelId = sourcePanel?.panel_id;
      let fallbackPanel = null;
      if (panelId) {
        fallbackPanel = fallbackPanels.find((candidate) => candidate && candidate.panel_id === panelId) || null;
      }
      if (!fallbackPanel) fallbackPanel = fallbackPanels[index] || null;
      const fallbackBlob = String(fallbackPanel?.artifacts?.image_blob_ref || '').trim();
      const fallbackImageUrl = String(
        fallbackPanel?.artifacts?.image_url ||
        fallbackPanel?.image_url ||
        ''
      ).trim();
      if (!fallbackBlob && !fallbackImageUrl) return sourcePanel;

      recoveredCount += 1;
      return {
        ...sourcePanel,
        artifacts: {
          ...ownArtifacts,
          ...(fallbackBlob ? { image_blob_ref: fallbackBlob } : {}),
          ...(ownArtifacts.image_url ? {} : (fallbackImageUrl ? { image_url: fallbackImageUrl } : {}))
        }
      };
    });

    if (!recoveredCount) return storyboard;
    void this.appendDebugLog('comic.image_refs.recovered', {
      recoveredPanels: recoveredCount,
      incomingPanels: basePanels.length
    });
    return {
      ...(storyboard || {}),
      panels: nextPanels
    };
  }

  recoverStoryboardAssets(storyboard) {
    const candidate = storyboard && typeof storyboard === 'object' ? storyboard : null;
    if (!candidate) return storyboard;
    if (!this.currentComic || !this.isSameStoryboardIdentity(candidate, this.currentComic)) return candidate;

    const currentCount = this.countStoryboardImagePanels(this.currentComic);
    const incomingCount = this.countStoryboardImagePanels(candidate);
    if (incomingCount >= currentCount) return candidate;
    return this.mergeStoryboardImageRefs(candidate, this.currentComic);
  }

  prepareHistoryStoryboardForDisplay(item) {
    const baseStoryboard = this.recoverStoryboardAssets(item?.storyboard || null);
    if (!baseStoryboard || !Array.isArray(baseStoryboard.panels) || !baseStoryboard.panels.length) {
      return baseStoryboard;
    }

    const fallbackImage = this.getHistoryThumbnail(item);
    if (!fallbackImage) return baseStoryboard;
    if (baseStoryboard.panels.length > 1) {
      // Avoid misleading UX where one thumbnail is duplicated across all comic panels.
      return baseStoryboard;
    }

    let updatedCount = 0;
    const nextPanels = baseStoryboard.panels.map((panel) => {
      if (this.getPanelImageSource(panel)) return panel;
      const sourcePanel = panel && typeof panel === 'object' ? panel : {};
      const nextArtifacts = sourcePanel.artifacts && typeof sourcePanel.artifacts === 'object'
        ? { ...sourcePanel.artifacts }
        : {};

      if (/^data:image\//i.test(fallbackImage)) {
        nextArtifacts.image_blob_ref = fallbackImage;
      } else {
        nextArtifacts.image_url = fallbackImage;
      }
      updatedCount += 1;
      return {
        ...sourcePanel,
        artifacts: nextArtifacts
      };
    });

    if (!updatedCount) return baseStoryboard;
    void this.appendDebugLog('history.storyboard.image_fallback_applied', {
      comicId: item?.id || null,
      updatedPanels: updatedCount
    });
    return {
      ...baseStoryboard,
      panels: nextPanels
    };
  }

  looksLikeHeadlineMashup(value) {
    const title = this.normalizeComicTitleCandidate(value);
    if (!title) return false;

    const segmented = title.split(/\s*[|•]\s+|\s+-\s+|\s+\/\s+/).filter(Boolean);
    if (segmented.length >= 3) return true;

    const words = title.split(/\s+/).filter(Boolean);
    const capitalizedTokens = (title.match(/\b[A-Z][a-z]{2,}\b/g) || []).length;
    const questionLeadTokens = (title.match(/\b(Why|How|What|Who|When|Where)\b/g) || []).length;
    const hasPunctuationBreak = /[.!?:;]/.test(title);

    if (words.length >= 16 && capitalizedTokens >= 5 && !hasPunctuationBreak) return true;
    if (words.length >= 22 && capitalizedTokens >= 6 && questionLeadTokens >= 1) return true;
    return false;
  }

  deriveComicTitleFromPanels(storyboard) {
    const panels = Array.isArray(storyboard?.panels) ? storyboard.panels : [];
    for (let i = 0; i < panels.length; i += 1) {
      const caption = this.getPanelCaptionText(panels[i], i, {
        suppressMissingLog: true,
        fallbackLabel: ''
      });
      const cleaned = this.normalizeComicTitleCandidate(caption).replace(/[.!?]+$/g, '').trim();
      if (!cleaned) continue;
      if (/^Panel\s+\d+$/i.test(cleaned)) continue;
      return this.truncateComicTitle(cleaned, 88);
    }
    return '';
  }

  resolveComicDisplayTitle(storyboard) {
    const storyboardTitle = this.normalizeComicTitleCandidate(storyboard?.title || '');
    const sourceTitle = this.normalizeComicTitleCandidate(storyboard?.source?.title || '');

    if (storyboardTitle && !this.looksLikeHeadlineMashup(storyboardTitle)) {
      return this.truncateComicTitle(storyboardTitle);
    }
    if (sourceTitle && !this.looksLikeHeadlineMashup(sourceTitle)) {
      return this.truncateComicTitle(sourceTitle);
    }

    const panelDerived = this.deriveComicTitleFromPanels(storyboard);
    if (panelDerived) return panelDerived;

    if (storyboardTitle) return this.truncateComicTitle(storyboardTitle);
    if (sourceTitle) return this.truncateComicTitle(sourceTitle);
    return 'Untitled Comic';
  }

  normalizeCaptionValue(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value).trim();
    }
    if (Array.isArray(value)) {
      const parts = value
        .map((item) => this.normalizeCaptionValue(item))
        .filter(Boolean);
      return parts.join(' ').trim();
    }
    if (typeof value === 'object') {
      const preferredKeys = ['text', 'caption', 'content', 'value', 'label', 'title', 'summary', 'beat_summary'];
      for (const key of preferredKeys) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const normalized = this.normalizeCaptionValue(value[key]);
          if (normalized) return normalized;
        }
      }
      // Some providers return content-part objects like { type: 'text', text: '...' }
      const objectValues = Object.values(value);
      for (const part of objectValues) {
        const normalized = this.normalizeCaptionValue(part);
        if (normalized) return normalized;
      }
    }
    return '';
  }

  logMissingCaption(panel, index) {
    try {
      const sourceUrl = String(this.currentComic?.source?.url || '');
      const panelId = String(panel?.panel_id || index || 0);
      const key = `${sourceUrl}|${panelId}`;
      if (this.missingCaptionNoticeKeys.has(key)) return;
      this.missingCaptionNoticeKeys.add(key);
      let sample = '';
      try {
        sample = JSON.stringify(panel || {}).slice(0, 500);
      } catch (_) {}
      void this.appendDebugLog('caption.missing', {
        panelIndex: Number(index) || 0,
        panelId: panel?.panel_id || null,
        availableKeys: panel && typeof panel === 'object' ? Object.keys(panel).slice(0, 30) : [],
        sample
      });
    } catch (_) {}
  }

  logPromptLikeCaptionSubstitution(panel, index, originalCaption, replacementCaption) {
    try {
      const sourceUrl = String(this.currentComic?.source?.url || '');
      const panelId = String(panel?.panel_id || index || 0);
      const key = `${sourceUrl}|${panelId}|prompt-like`;
      if (this.missingCaptionNoticeKeys.has(key)) return;
      this.missingCaptionNoticeKeys.add(key);
      void this.appendDebugLog('caption.prompt_like_substituted', {
        panelIndex: Number(index) || 0,
        panelId: panel?.panel_id || null,
        originalPreview: String(originalCaption || '').slice(0, 200),
        replacementPreview: String(replacementCaption || '').slice(0, 200)
      });
    } catch (_) {}
  }

  async loadPrefs() {
    const { sidepanelPrefs } = await chrome.storage.local.get('sidepanelPrefs');
    const rawPreset = sidepanelPrefs?.layoutPreset;
    const preset = this.layoutPresetAliases[rawPreset] || rawPreset;
    if (preset && this.layoutPresets[preset]) {
      this.layoutPreset = preset;
      this.viewMode = this.layoutPresets[preset].mode;
    }
    this.historyFavoritesOnly = !!sidepanelPrefs?.historyFavoritesOnly;
    const rawSortMode = String(sidepanelPrefs?.historySortMode || '').trim();
    if (rawSortMode === 'manual' || rawSortMode === 'title-asc' || rawSortMode === 'title-desc' || rawSortMode === 'date-asc' || rawSortMode === 'date-desc') {
      this.historySortMode = rawSortMode;
    }
  }

  async loadCurrentJob() {
    const { currentJob } = await chrome.storage.local.get('currentJob');
    this.handleCurrentJobState(currentJob);
    this.updateViewerStats();
  }

  async tryDisplaySelectedHistoryComic() {
    try {
      const { selectedHistoryComicId, history } = await chrome.storage.local.get(['selectedHistoryComicId', 'history']);
      if (!selectedHistoryComicId) return false;
      const items = Array.isArray(history) ? history : this.historyItems;
      const item = (Array.isArray(items) ? items : []).find((h) => h && h.id === selectedHistoryComicId);
      if (!item?.storyboard) return false;
      this.currentComicId = String(item.id || '');
      const hydrated = await this.hydrateStoryboardImagesFromArchive(item.storyboard, this.currentComicId);
      this.displayComic(this.prepareHistoryStoryboardForDisplay({ ...item, storyboard: hydrated }));
      return true;
    } catch (_) {
      void this.appendDebugLog('history.selected.display.error', {});
      return false;
    }
  }

  bindEvents() {
    document.getElementById('mode-comic-btn')?.addEventListener('click', () => this.setPrimaryView('comic'));
    document.getElementById('mode-history-btn')?.addEventListener('click', () => this.setPrimaryView('history'));
    document.querySelector('.header-mode-toggle')?.addEventListener('keydown', (e) => this.onHeaderModeKeydown(e));
    document.getElementById('settings-btn-sidepanel')?.addEventListener('click', () => this.openOptionsPage());
    document.getElementById('new-comic-btn')?.addEventListener('click', () => this.openPopup());
    document.getElementById('open-tab-btn')?.addEventListener('click', () => this.openInTab());
    document.getElementById('download-logs-sidepanel-btn')?.addEventListener('click', () => this.downloadDebugLogs());
    document.getElementById('download-btn')?.addEventListener('click', () => this.downloadComic());
    document.getElementById('share-btn')?.addEventListener('click', () => this.toggleShareMenu());
    document.getElementById('share-target-menu')?.addEventListener('click', (e) => this.handleShareMenuClick(e));
    document.addEventListener('click', (e) => this.handleGlobalClick(e));
    document.getElementById('open-popup-btn')?.addEventListener('click', () => this.openPopup());
    document.getElementById('cancel-gen-btn')?.addEventListener('click', () => this.cancelGeneration());
    document.getElementById('regenerate-btn')?.addEventListener('click', () => this.regenerate());
    document.getElementById('edit-storyboard-btn')?.addEventListener('click', () => this.editStoryboard());
    document.getElementById('carousel-prev-btn')?.addEventListener('click', () => this.showCarouselPanel(this.carouselIndex - 1));
    document.getElementById('carousel-next-btn')?.addEventListener('click', () => this.showCarouselPanel(this.carouselIndex + 1));
    document.getElementById('history-browser-more-btn')?.addEventListener('click', () => this.showMoreHistory());
    document.getElementById('history-filter-favorites-btn')?.addEventListener('click', () => this.toggleHistoryFavoritesOnly());
    document.getElementById('history-sort-title-btn')?.addEventListener('click', () => this.toggleHistorySortMode('title'));
    document.getElementById('history-sort-date-btn')?.addEventListener('click', () => this.toggleHistorySortMode('date'));
    document.getElementById('layout-preset-select')?.addEventListener('change', (e) => this.setLayoutPreset(e.target.value));
    document.getElementById('comic-source')?.addEventListener('click', (e) => this.handleComicSourceClick(e));
    document.getElementById('comic-strip')?.addEventListener('click', (e) => this.handlePanelActionClick(e));
    document.getElementById('comic-panels')?.addEventListener('click', (e) => this.handlePanelActionClick(e));
  }

  async handlePanelActionClick(event) {
    const actionBtn = event?.target?.closest?.('[data-panel-action]');
    if (!actionBtn) return;
    const parentMenu = actionBtn.closest('.panel-more-actions');
    if (parentMenu && parentMenu.hasAttribute('open')) {
      parentMenu.removeAttribute('open');
    }
    const panelIndex = Number(actionBtn.dataset.panelIndex || -1);
    const action = String(actionBtn.dataset.panelAction || '');
    if (!Number.isInteger(panelIndex) || panelIndex < 0 || !action) return;
    if (this.getPanelEditState(panelIndex)?.pending) return;

    if (action === 'jump-source') {
      const snippet = String(actionBtn.dataset.sourceSnippet || '');
      await this.jumpToSourceSnippet(snippet);
      return;
    }

    this.setPanelEditState(panelIndex, { pending: true, action });
    try {
      await this.requestPanelEdit(panelIndex, action);
      void this.trackMetric('panel_edit', { action, panel_index: panelIndex });
    } catch (error) {
      console.error('Panel action failed:', error);
      alert(error?.message || 'Panel action failed.');
    } finally {
      this.clearPanelEditState(panelIndex);
    }
  }

  getPanelEditState(panelIndex) {
    return this.panelEditState[String(panelIndex)] || null;
  }

  getPanelEditLabel(action) {
    const key = String(action || '').trim();
    if (key === 'regenerate-image') return 'Regenerating image...';
    if (key === 'regenerate-caption') return 'Regenerating caption...';
    if (key === 'make-factual') return 'Improving factuality...';
    if (key === 'make-simpler') return 'Simplifying caption...';
    return 'Updating panel...';
  }

  setPanelEditState(panelIndex, state) {
    this.panelEditState[String(panelIndex)] = state && typeof state === 'object' ? state : { pending: true, action: '' };
    if (this.currentComic && Array.isArray(this.currentComic.panels)) {
      this.renderPanels(this.currentComic.panels);
    }
  }

  clearPanelEditState(panelIndex) {
    delete this.panelEditState[String(panelIndex)];
    if (this.currentComic && Array.isArray(this.currentComic.panels)) {
      this.renderPanels(this.currentComic.panels);
    }
  }

  async requestPanelEdit(panelIndex, action) {
    const response = await chrome.runtime.sendMessage({
      type: 'EDIT_PANEL',
      payload: {
        panelIndex,
        action,
        comicId: this.currentComicId || ''
      }
    });
    if (!response || response.success !== true || !response.job?.storyboard) {
      throw new Error(response?.error || 'Unable to edit panel');
    }
    this.displayComic(response.job.storyboard);
  }

  async jumpToSourceSnippet(snippet) {
    const sourceUrl = this.sanitizeExternalUrl(this.currentComic?.source?.url || '');
    if (sourceUrl && sourceUrl !== '#') {
      await this.openExternalShareUrl(sourceUrl);
    }
    if (snippet) {
      const copied = await this.copyTextToClipboard('Relevant source snippet:\n' + snippet);
      if (copied) alert('Source snippet copied to clipboard.');
    }
  }

  setHeaderActionState() {
    const canActOnComic = this.primaryView === 'comic' && !!this.currentComic;
    const openTabBtn = document.getElementById('open-tab-btn');
    const downloadBtn = document.getElementById('download-btn');
    const shareBtn = document.getElementById('share-btn');
    if (openTabBtn) openTabBtn.disabled = !canActOnComic;
    if (downloadBtn) downloadBtn.disabled = !canActOnComic;
    if (shareBtn) {
      shareBtn.disabled = !canActOnComic;
      if (!canActOnComic) this.hideShareMenu();
    }
  }

  computeViewerStats() {
    const history = Array.isArray(this.historyItems) ? this.historyItems : [];
    let comics = history.length;
    let panels = 0;
    const pageUrls = new Set();

    for (const item of history) {
      const storyboard = item && item.storyboard ? item.storyboard : null;
      if (storyboard && Array.isArray(storyboard.panels)) {
        panels += storyboard.panels.length;
      }
      const sourceUrl = String(
        (item && item.source && item.source.url) ||
        (storyboard && storyboard.source && storyboard.source.url) ||
        ''
      ).trim();
      if (sourceUrl) pageUrls.add(sourceUrl);
    }

    const current = this.currentComic && typeof this.currentComic === 'object' ? this.currentComic : null;
    if (current) {
      const currentUrl = String((current.source && current.source.url) || '').trim();
      const currentTitle = String((current.source && current.source.title) || '').trim();
      const currentPanels = Array.isArray(current.panels) ? current.panels.length : 0;
      if (currentUrl) pageUrls.add(currentUrl);

      if (currentPanels > 0) {
        const existsInHistory = history.some((item) => {
          const storyboard = item && item.storyboard ? item.storyboard : null;
          const url = String(
            (item && item.source && item.source.url) ||
            (storyboard && storyboard.source && storyboard.source.url) ||
            ''
          ).trim();
          const title = String(
            (item && item.source && item.source.title) ||
            (storyboard && storyboard.source && storyboard.source.title) ||
            ''
          ).trim();
          return !!(url && currentUrl && url === currentUrl && (!currentTitle || title === currentTitle));
        });
        if (!existsInHistory) {
          comics += 1;
          panels += currentPanels;
        }
      }
    }

    return { comics, panels, pages: pageUrls.size };
  }

  updateViewerStats() {
    const stats = this.computeViewerStats();
    const comicsEl = document.getElementById('viewer-stat-comics');
    const panelsEl = document.getElementById('viewer-stat-panels');
    const pagesEl = document.getElementById('viewer-stat-pages');
    const storageEl = document.getElementById('viewer-stat-storage');
    if (comicsEl) comicsEl.textContent = Number(stats.comics || 0).toLocaleString();
    if (panelsEl) panelsEl.textContent = Number(stats.panels || 0).toLocaleString();
    if (pagesEl) pagesEl.textContent = Number(stats.pages || 0).toLocaleString();
    if (storageEl) {
      storageEl.textContent = this.formatStorageBytes(this.storageUsageBytes);
      storageEl.title = `${Number(this.storageUsageBytes || 0).toLocaleString()} bytes used in chrome.storage.local`;
    }
  }

  formatStorageBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    if (value < 1024) return `${Math.round(value)} B`;
    const kb = value / 1024;
    if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
  }

  async estimateStorageBytesFallback() {
    try {
      const all = await chrome.storage.local.get(null);
      const json = JSON.stringify(all || {});
      if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(json).length;
      }
      return String(json).length;
    } catch (_) {
      return 0;
    }
  }

  async refreshStorageUsage() {
    let bytes = 0;
    try {
      if (chrome?.storage?.local?.getBytesInUse) {
        bytes = await chrome.storage.local.getBytesInUse(null);
      } else {
        bytes = await this.estimateStorageBytesFallback();
      }
    } catch (_) {
      bytes = await this.estimateStorageBytesFallback();
    }
    this.storageUsageBytes = Number(bytes || 0);
    this.updateViewerStats();
  }

  onHeaderModeKeydown(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(document.querySelectorAll('.header-mode-btn'));
    if (!buttons.length) return;

    const currentIndex = buttons.findIndex((btn) => btn === document.activeElement);
    if (event.key === 'Enter' || event.key === ' ') {
      if (document.activeElement && document.activeElement.dataset?.view) {
        event.preventDefault();
        this.setPrimaryView(document.activeElement.dataset.view);
      }
      return;
    }

    event.preventDefault();
    let nextIndex = currentIndex >= 0 ? currentIndex : buttons.findIndex((b) => b.classList.contains('active'));
    if (event.key === 'ArrowRight') nextIndex = (nextIndex + 1) % buttons.length;
    if (event.key === 'ArrowLeft') nextIndex = (nextIndex - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = buttons.length - 1;
    buttons[nextIndex]?.focus();
  }

  applyGenerationLayoutMode() {
    const generationView = document.getElementById('generation-view');
    if (!generationView) return;
    generationView.classList.remove(
      'layout-strip',
      'layout-panels',
      'layout-carousel',
      ...this.getLayoutPresetClasses(),
      ...this.getLayoutPresetIdClasses()
    );
    // Avoid carousel during generation: it shows one panel at a time and looks like only a single
    // image is being generated. Render progress in a multi-panel shell instead.
    const generationMode = this.viewMode === 'carousel' ? 'strip' : this.viewMode;
    if (generationMode === 'panels') {
      generationView.classList.add('layout-panels');
    } else if (generationMode === 'carousel') {
      generationView.classList.add('layout-carousel');
    } else {
      generationView.classList.add('layout-strip');
    }
    const presetClass = this.layoutPresets[this.layoutPreset]?.generationClass;
    if (presetClass) generationView.classList.add(presetClass);
    generationView.classList.add(this.getPresetIdClass(this.layoutPreset));
  }

  formatDebugLogFileTimestamp(date) {
    const d = date instanceof Date ? date : new Date();
    return d.toISOString().replace(/[:.]/g, '-');
  }

  async downloadDebugLogs() {
    try {
      const { debugLogs } = await chrome.storage.local.get('debugLogs');
      const logs = Array.isArray(debugLogs) ? debugLogs : [];
      const payload = {
        exportedAt: new Date().toISOString(),
        count: logs.length,
        logs
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `web2comics-debug-logs-${this.formatDebugLogFileTimestamp(new Date())}.json`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      console.error('Failed to export debug logs from sidepanel:', error);
      void this.appendDebugLog('debugLogs.export.sidepanel.error', { message: error?.message || String(error) });
      try {
        alert('Failed to export debug logs.');
      } catch (_) {}
    }
  }

  bindStorageListeners() {
    if (!chrome?.storage?.onChanged?.addListener) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes) return;
      if (Object.prototype.hasOwnProperty.call(changes, 'currentJob')) {
        const nextJob = changes.currentJob ? changes.currentJob.newValue : undefined;
        this.handleCurrentJobState(nextJob);
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'history')) {
        void this.loadHistory();
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'selectedHistoryComicId')) {
        void this.tryDisplaySelectedHistoryComic();
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'connectionStates')) {
        void this.refreshShareTargetVisibility();
      }
      void this.refreshStorageUsage();
    });
  }

  bindRuntimeListeners() {
    if (!chrome?.runtime?.onMessage?.addListener) return;
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || message.type !== 'JOB_PROGRESS_BROADCAST') return;
      if (message.job) {
        this.handleCurrentJobState(message.job);
      }
    });
  }

  notifyTerminalJobIssue(job) {
    const status = job && job.status ? String(job.status) : 'failed';
    if (status === 'canceled') return;
    const jobId = (job && (job.id || job.jobId)) ? String(job.id || job.jobId) : 'unknown';
    const key = `${jobId}:${status}:${job && job.updatedAt ? job.updatedAt : ''}`;
    if (this.lastTerminalJobNoticeKey === key) return;
    this.lastTerminalJobNoticeKey = key;
    const message = (job && job.error)
      ? `Generation ${status}: ${job.error}`
      : (status === 'canceled' ? 'Generation was canceled.' : 'Generation failed.');
    try {
      alert(message);
    } catch (_) {
      void this.appendDebugLog('job.terminal.alert.error', { status, jobId });
    }
  }

  shouldResetForFreshGeneration(currentJob) {
    const status = String(currentJob?.status || '');
    if (status !== 'pending' && status !== 'generating_text' && status !== 'generating_images') return false;
    const jobId = String(currentJob?.id || currentJob?.jobId || '').trim();
    if (!jobId) return false;
    if (jobId === String(this.currentComicId || '').trim()) return false;

    const panels = Array.isArray(currentJob?.storyboard?.panels) ? currentJob.storyboard.panels : [];
    const hasRenderedPanelImage = panels.some((panel) => !!this.getPanelImageSource(panel));
    const completedPanels = Math.max(0, Number(currentJob?.completedPanels || 0));

    // Only reset when a new generation starts before any panel output exists.
    return !hasRenderedPanelImage && completedPanels === 0;
  }

  handleCurrentJobState(currentJob) {
    if (!currentJob) return;
    if (currentJob.status === 'completed') {
      this.generationStartedAtMs = 0;
      this.generationFirstPanelAtMs = 0;
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      this.currentComicId = String(currentJob.id || currentJob.jobId || '');
      this.displayComic(this.recoverStoryboardAssets(currentJob.storyboard));
      void this.loadHistory();
      this.updateViewerStats();
      return;
    }

    if (currentJob.status === 'generating_text' || currentJob.status === 'generating_images' || currentJob.status === 'pending') {
      if (this.shouldResetForFreshGeneration(currentJob)) {
        this.currentComic = null;
        this.currentComicId = '';
        this.carouselIndex = 0;
        this.hideShareMenu();
        this.setHeaderActionState();
      }
      this.showGenerationView(currentJob);
      this.updateGenerationUI(currentJob);
      this.startPolling();
      return;
    }

    if (currentJob.status === 'failed' || currentJob.status === 'canceled') {
      this.generationStartedAtMs = 0;
      this.generationFirstPanelAtMs = 0;
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      // Keep the generation view visible so users can see partial panel results and failure status.
      this.showGenerationView(currentJob);
      this.updateGenerationUI(currentJob);
      this.setPrimaryView('comic');
      this.notifyTerminalJobIssue(currentJob);
      this.updateViewerStats();
      return;
    }
  }

  getLayoutPresetClasses() {
    return Array.from(new Set(Object.values(this.layoutPresets).flatMap((p) => [p.displayClass, p.generationClass]).filter(Boolean)));
  }

  getPresetIdClass(presetId) {
    return 'preset-id-' + String(presetId || 'polaroid-collage').replace(/[^a-z0-9_-]/gi, '-');
  }

  getLayoutPresetIdClasses() {
    return Array.from(new Set(Object.keys(this.layoutPresets).map((key) => this.getPresetIdClass(key))));
  }

  syncLayoutPresetUI() {
    const select = document.getElementById('layout-preset-select');
    if (select && this.layoutPresets[this.layoutPreset]) {
      select.value = this.layoutPreset;
    }
  }

  applyLayoutPreset() {
    const comicDisplay = document.getElementById('comic-display');
    if (!comicDisplay) return;
    comicDisplay.classList.remove(...this.getLayoutPresetClasses(), ...this.getLayoutPresetIdClasses());
    const presetClass = this.layoutPresets[this.layoutPreset]?.displayClass;
    if (presetClass) comicDisplay.classList.add(presetClass);
    comicDisplay.classList.add(this.getPresetIdClass(this.layoutPreset));
    this.syncLayoutPresetUI();
    this.applyGenerationLayoutMode();
  }

  async persistPrefs() {
    try {
      const { sidepanelPrefs } = await chrome.storage.local.get('sidepanelPrefs');
      await chrome.storage.local.set({
        sidepanelPrefs: {
          ...(sidepanelPrefs || {}),
          layoutPreset: this.layoutPreset
        }
      });
    } catch (error) {
      console.warn('Failed to persist sidepanel prefs:', error);
      void this.appendDebugLog('prefs.persist.error', { message: error?.message || String(error) });
    }
  }

  async setLayoutPreset(presetId) {
    if (!this.layoutPresets[presetId]) return;
    this.layoutPreset = presetId;
    this.setViewMode(this.layoutPresets[presetId].mode);
    this.applyLayoutPreset();
    await this.persistPrefs();
  }

  setPrimaryView(view) {
    this.primaryView = view === 'history' ? 'history' : 'comic';
    const comicShell = document.getElementById('comic-view-shell');
    const historyShell = document.getElementById('history-browser-view');
    const sidebar = document.getElementById('sidebar');

    comicShell?.classList.toggle('hidden', this.primaryView !== 'comic');
    comicShell?.classList.toggle('active', this.primaryView === 'comic');
    historyShell?.classList.toggle('hidden', this.primaryView !== 'history');
    historyShell?.classList.toggle('active', this.primaryView === 'history');
    // Keep comic view focused on a single comic surface; My Collection lives in its own tab.
    sidebar?.classList.add('hidden');

    document.querySelectorAll('.header-mode-btn').forEach((btn) => {
      const active = btn.dataset.view === this.primaryView;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    // When users switch back to Comic view, restore the comic canvas explicitly.
    // This avoids stale hidden-state collisions with generation/empty views.
    if (this.primaryView === 'comic' && this.currentComic && Array.isArray(this.currentComic.panels)) {
      document.getElementById('empty-state')?.classList.add('hidden');
      document.getElementById('generation-view')?.classList.add('hidden');
      document.getElementById('comic-display')?.classList.remove('hidden');
      this.renderPanels(this.currentComic.panels);
      this.renderCarousel(this.currentComic.panels);
      this.setViewMode(this.layoutPresets[this.layoutPreset]?.mode || 'strip');
    }

    // Export/share only applies to the Single Comic Strip View.
    this.setHeaderActionState();
  }

  displayComic(storyboard) {
    const resolvedStoryboard = this.recoverStoryboardAssets(storyboard);
    this.currentComic = resolvedStoryboard;
    this.setPrimaryView('comic');
    
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('generation-view').classList.add('hidden');
    document.getElementById('comic-display').classList.remove('hidden');
    
    const sourceUrl = String(resolvedStoryboard?.source?.url || '');
    const manualSourceInfo = this.getManualSourceInfo(resolvedStoryboard?.source);
    document.getElementById('comic-title').textContent = this.resolveComicDisplayTitle(resolvedStoryboard);
    const descriptionEl = document.getElementById('comic-description');
    if (descriptionEl) {
      const descriptionText = String(resolvedStoryboard?.description || '').trim();
      descriptionEl.textContent = descriptionText;
      descriptionEl.classList.toggle('hidden', !descriptionText);
    }
    const sourceEl = document.getElementById('comic-source');
    if (sourceEl) {
      if (manualSourceInfo) {
        sourceEl.href = '#';
        sourceEl.textContent = 'View Source Story';
      } else {
        const safeHref = this.sanitizeExternalUrl(sourceUrl);
        sourceEl.href = safeHref;
        sourceEl.textContent = safeHref === '#' ? 'Source unavailable' : sourceUrl;
      }
    }
    this.updateComicSourceFavicon(manualSourceInfo ? '' : sourceUrl);
    
    this.renderPanels(resolvedStoryboard.panels);
    this.renderCarousel(resolvedStoryboard.panels);
    // The active layout preset is the single source of truth for display mode.
    this.setViewMode(this.layoutPresets[this.layoutPreset]?.mode || 'strip');
    
    this.setHeaderActionState();
    this.updateViewerStats();
    if (document.getElementById('regenerate-btn')) {
      document.getElementById('regenerate-btn').disabled = false;
    }
    if (document.getElementById('edit-storyboard-btn')) {
      document.getElementById('edit-storyboard-btn').disabled = false;
    }
  }

  renderPanels(panels) {
    const stripContainer = document.getElementById('comic-strip');
    const panelsContainer = document.getElementById('comic-panels');
    
    const showRewrittenBadge = this.currentComic?.settings?.show_rewritten_badge !== false;
    const debugEnabled = !!this.currentComic?.settings?.debug_flag;
    const panelsHTML = panels.map((panel, index) => {
      const panelImageSrc = this.getPanelImageSource(panel);
      const editState = this.getPanelEditState(index);
      const isPanelEditing = !!(editState && editState.pending);
      const editLabel = isPanelEditing ? this.getPanelEditLabel(editState.action) : '';
      const refusalHandling = panel?.artifacts?.provider_metadata?.refusal_handling || null;
      const showBadge = Boolean(
        showRewrittenBadge &&
        refusalHandling &&
        refusalHandling.retried &&
        refusalHandling.rewritten &&
        !refusalHandling.blockedPlaceholder
      );
      const showPromptBtn = Boolean(
        debugEnabled &&
        refusalHandling &&
        (refusalHandling.blockedPlaceholder || panel?.artifacts?.refusal_debug?.effectivePrompt) &&
        (panel?.artifacts?.refusal_debug?.originalPrompt || refusalHandling.originalPrompt || panel?.artifacts?.refusal_debug?.effectivePrompt || refusalHandling.rewrittenPrompt)
      );
      const safeCaption = this.escapeHtml(this.getPanelCaptionText(panel, index));
      const numberedCaption = this.escapeHtml(String(index + 1) + '.') + ' ' + safeCaption;
      return `
      <div class="panel">
        <div class="panel-image">
          <div class="panel-image-corner-actions">
            <button type="button" class="panel-action-btn panel-action-btn-icon${isPanelEditing ? ' is-busy' : ''}" data-panel-action="regenerate-image" data-panel-index="${index}" title="Regenerate panel image" aria-label="Regenerate panel image"${isPanelEditing ? ' disabled' : ''}>
              <span class="panel-action-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11Zm2-.5v12h14V6H5Zm2 10 3.6-4.6 2.7 3.2 1.9-2.4 2.8 3.8H7Z"></path>
                </svg>
              </span>
            </button>
          </div>
          ${panelImageSrc
            ? `<img src="${panelImageSrc}" alt="Panel ${index + 1}">`
            : `<svg width="64" height="64" fill="var(--text-muted)"><rect x="8" y="8" width="48" height="48" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M24 32h16M32 24v16" stroke="currentColor" stroke-width="2"/></svg>`
          }
        </div>
        <div class="panel-caption">
          ${showBadge ? '<div class="panel-badge panel-badge-rewritten">Rewritten</div>' : ''}
          ${refusalHandling?.blockedPlaceholder ? '<div class="panel-badge panel-badge-blocked">Blocked</div>' : ''}
          <div>${numberedCaption}</div>
          ${isPanelEditing ? `
            <div class="panel-edit-status" role="status" aria-live="polite">
              <span class="panel-inline-spinner" aria-hidden="true"></span>
              <span>${this.escapeHtml(editLabel)}</span>
            </div>
          ` : ''}
          ${showPromptBtn ? `<button type="button" class="panel-debug-prompt-btn" data-panel-index="${index}">View prompt</button>` : ''}
        </div>
      </div>
    `;
    }).join('');
    
    stripContainer.innerHTML = panelsHTML;
    panelsContainer.innerHTML = panelsHTML;
    this.bindPanelDebugPromptButtons(panels);
  }

  bindPanelDebugPromptButtons(panels) {
    const showPrompt = (index) => {
      const panel = (panels || [])[index] || {};
      const refusal = panel?.artifacts?.provider_metadata?.refusal_handling || {};
      const debug = panel?.artifacts?.refusal_debug || {};
      const lines = [];
      if (debug.originalPrompt || refusal.originalPrompt) {
        lines.push('Original prompt:\n' + (debug.originalPrompt || refusal.originalPrompt));
      }
      if (debug.effectivePrompt || refusal.rewrittenPrompt) {
        lines.push('Rewritten/effective prompt:\n' + (debug.effectivePrompt || refusal.rewrittenPrompt));
      }
      if (refusal.refusalMessage) {
        lines.push('Provider refusal:\n' + refusal.refusalMessage);
      }
      try {
        alert(lines.join('\n\n') || 'No prompt details available.');
      } catch (error) {
        void this.appendDebugLog('panel.prompt.debug.alert.error', {
          panelIndex: index,
          message: error?.message || String(error)
        });
      }
    };

    document.querySelectorAll('.panel-debug-prompt-btn').forEach((btn) => {
      btn.addEventListener('click', () => showPrompt(Number(btn.dataset.panelIndex)));
    });
  }

  renderCarousel(panels) {
    const thumbs = document.getElementById('carousel-thumbs');
    if (!thumbs) return;
    const safePanels = Array.isArray(panels) ? panels : [];
    this.carouselIndex = Math.min(this.carouselIndex || 0, Math.max(safePanels.length - 1, 0));

    thumbs.innerHTML = safePanels.map((panel, index) => `
      <button class="carousel-thumb ${index === this.carouselIndex ? 'active' : ''}" data-index="${index}" type="button" aria-label="Go to panel ${index + 1}">
        ${this.getPanelImageSource(panel)
          ? `<img src="${this.getPanelImageSource(panel)}" alt="Panel ${index + 1}">`
          : `<span class="carousel-thumb-fallback">${index + 1}</span>`}
      </button>
    `).join('');

    thumbs.querySelectorAll('.carousel-thumb').forEach((btn) => {
      btn.addEventListener('click', () => this.showCarouselPanel(Number(btn.dataset.index)));
    });

    this.showCarouselPanel(this.carouselIndex);
  }

  showCarouselPanel(index) {
    const panels = this.currentComic?.panels || [];
    if (!panels.length) return;
    const nextIndex = Math.min(Math.max(index, 0), panels.length - 1);
    this.carouselIndex = nextIndex;
    const panel = panels[nextIndex] || {};
    const refusalHandling = panel?.artifacts?.provider_metadata?.refusal_handling || null;

    const imageEl = document.getElementById('carousel-image');
    const numEl = document.getElementById('carousel-panel-number');
    const captionEl = document.getElementById('carousel-panel-caption-text');
    const prevBtn = document.getElementById('carousel-prev-btn');
    const nextBtn = document.getElementById('carousel-next-btn');
    const thumbs = document.getElementById('carousel-thumbs');
    const panelImageSrc = this.getPanelImageSource(panel);

    if (imageEl) {
      imageEl.innerHTML = panelImageSrc
        ? `<img src="${panelImageSrc}" alt="Panel ${nextIndex + 1}">`
        : `<div class="carousel-image-empty">No image for panel ${nextIndex + 1}</div>`;
    }
    if (numEl) numEl.textContent = `Panel ${nextIndex + 1} of ${panels.length}`;
    if (captionEl) {
      const parts = [];
      if (
        this.currentComic?.settings?.show_rewritten_badge !== false &&
        refusalHandling &&
        refusalHandling.retried &&
        refusalHandling.rewritten &&
        !refusalHandling.blockedPlaceholder
      ) {
        parts.push('Rewritten');
      }
      if (refusalHandling?.blockedPlaceholder) {
        parts.push('Blocked');
      }
      parts.push(this.getPanelCaptionText(panel, nextIndex));
      captionEl.textContent = parts.filter(Boolean).join(' • ');
    }
    if (prevBtn) prevBtn.disabled = nextIndex <= 0;
    if (nextBtn) nextBtn.disabled = nextIndex >= panels.length - 1;

    thumbs?.querySelectorAll('.carousel-thumb').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.index) === nextIndex);
    });
  }

  showGenerationView(job) {
    this.setPrimaryView('comic');
    this.applyGenerationLayoutMode();
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('comic-display').classList.add('hidden');
    document.getElementById('generation-view').classList.remove('hidden');
    if (!this.generationStartedAtMs) {
      this.generationStartedAtMs = Date.now();
      this.generationFirstPanelAtMs = 0;
    }
    
    this.updateGenerationUI(job);
  }

  formatDurationShort(ms) {
    const totalSec = Math.max(0, Math.round((ms || 0) / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  buildGenerationStatusDetail(job, totalPanels) {
    const now = Date.now();
    const startedAtMs = this.generationStartedAtMs || now;
    const elapsedMs = Math.max(0, now - startedAtMs);
    const completedPanels = Math.max(0, Number(job?.completedPanels || 0));
    const currentIndex = Math.max(0, Number(job?.currentPanelIndex || 0));
    const retryState = job && job.retryState ? job.retryState : null;
    const panelTotal = Math.max(0, Number(totalPanels || 0));

    if (!this.generationFirstPanelAtMs && completedPanels >= 1) {
      this.generationFirstPanelAtMs = now;
    }

    let phaseText = 'Waiting for updates...';
    if (job.status === 'pending') phaseText = 'Preparing generation job';
    if (job.status === 'generating_text') phaseText = 'Building storyboard';
    if (job.status === 'generating_images') {
      const activePanel = panelTotal > 0 ? Math.min(panelTotal, currentIndex + 1) : 1;
      phaseText = panelTotal > 0
        ? `Rendering panels (${completedPanels}/${panelTotal} done, panel ${activePanel}/${panelTotal} active)`
        : 'Rendering comic panels';
    }
    if (job.status === 'completed') phaseText = panelTotal > 0 ? `Completed (${panelTotal}/${panelTotal} panels)` : 'Completed';
    if (job.status === 'failed') phaseText = 'Failed';
    if (job.status === 'canceled') phaseText = 'Canceled';
    if (job.status === 'generating_images' && retryState && retryState.delayMs > 0) {
      const retryAtMs = retryState.retryAt ? new Date(retryState.retryAt).getTime() : (now + Number(retryState.delayMs || 0));
      const remainingMs = Math.max(0, retryAtMs - now);
      const providerLabel = this.getProviderDisplayLabel(retryState.provider);
      if (retryState.type === 'rate_limit') {
        phaseText = `Rate limited by ${providerLabel}; retrying panel ${(Number(retryState.panelIndex) || 0) + 1} in ${this.formatDurationShort(remainingMs)}`;
      } else {
        phaseText = `Retrying panel ${(Number(retryState.panelIndex) || 0) + 1} after temporary error (${this.formatDurationShort(remainingMs)})`;
      }
    }

    let etaText = 'ETA: calculating...';
    if (job.status === 'completed') etaText = 'ETA: done';
    else if (job.status === 'failed' || job.status === 'canceled') etaText = 'ETA: n/a';
    else if (panelTotal > 0 && completedPanels >= 1) {
      const remaining = Math.max(0, panelTotal - completedPanels);
      const etaMs = (elapsedMs / completedPanels) * remaining;
      etaText = `ETA: ~${this.formatDurationShort(etaMs)}`;
    }

    return `Elapsed ${this.formatDurationShort(elapsedMs)} | ${phaseText} | ${etaText}`;
  }

  buildCaptionQualitySummary(job) {
    const score = job && (job.captionQuality || job?.storyboard?.caption_quality);
    if (!score || typeof score !== 'object') return '';
    const storyLike = Math.max(0, Number(score.storyLikeCaptions || 0));
    const promptLike = Math.max(0, Number(score.promptLikeCaptions || 0));
    const repaired = Math.max(0, Number(score.promptLikeCaptionRepairs || 0));
    if (storyLike === 0 && promptLike === 0 && repaired === 0) return '';
    return `Caption quality: ${storyLike} story-like / ${promptLike} prompt-like${repaired > 0 ? ` (repaired ${repaired})` : ''}`;
  }

  updateGenerationUI(job) {
    const statusTitles = {
      pending: 'Preparing...',
      generating_text: 'Generating Storyboard',
      generating_images: 'Creating Comic Panels',
      failed: 'Generation Failed',
      canceled: 'Generation Canceled',
      completed: 'Generation Complete'
    };
    const statusTextMap = {
      pending: 'Preparing generation job',
      generating_text: 'Analyzing content and creating storyboard',
      generating_images: 'Rendering comic panels',
      failed: 'Failed',
      canceled: 'Canceled',
      completed: 'Completed'
    };
    
    document.getElementById('gen-status-title').textContent = statusTitles[job.status] || 'Processing...';
    const statusTextEl = document.getElementById('gen-status-text');
    const cancelBtn = document.getElementById('cancel-gen-btn');
    if (statusTextEl) {
      statusTextEl.textContent = statusTextMap[job.status] || 'Processing';
    }
    if (cancelBtn) {
      cancelBtn.disabled = !['pending', 'generating_text', 'generating_images'].includes(String(job.status || ''));
    }
    const detailEl = document.getElementById('gen-status-detail');
    const captionQualityEl = document.getElementById('gen-caption-quality');
    
    const panelsContainer = document.getElementById('gen-panels');
    if (!panelsContainer) return;

    const storyboardPanels = Array.isArray(job.storyboard?.panels) ? job.storyboard.panels : [];
    const totalPanels = Math.max(
      storyboardPanels.length,
      Number(job?.settings?.panel_count || 0),
      0
    );
    if (detailEl) {
      detailEl.textContent = this.buildGenerationStatusDetail(job, totalPanels);
    }
    if (captionQualityEl) {
      const debugEnabled = !!(job?.storyboard?.settings?.debug_flag || job?.settings?.debug_flag);
      const captionSummary = debugEnabled ? this.buildCaptionQualitySummary(job) : '';
      captionQualityEl.textContent = captionSummary;
      captionQualityEl.classList.toggle('hidden', !captionSummary);
    }

    const normalizedPanels = Array.from({ length: totalPanels || 0 }, (_, index) => {
      const panel = storyboardPanels[index] || null;
      const runtimeStatus = panel?.runtime_status || (job.status === 'generating_text' ? 'pending' : 'pending');
      let displayStatus = runtimeStatus;
      if (this.getPanelImageSource(panel)) displayStatus = 'completed';
      if (panel?.artifacts?.error) displayStatus = 'error';
      return { panel, index, displayStatus };
    });

    panelsContainer.innerHTML = normalizedPanels.map(({ panel, index, displayStatus }) => {
      const statusLabelMap = {
        pending: 'Pending',
        sent: 'Sent',
        receiving: 'Receiving',
        rendering: 'Rendering',
        completed: 'Completed',
        error: 'Error'
      };

      const statusClass =
        displayStatus === 'completed' ? 'done'
          : (displayStatus === 'rendering' || displayStatus === 'receiving' || displayStatus === 'sent') ? 'generating'
          : displayStatus === 'error' ? 'error'
          : '';
      const isCurrent = displayStatus === 'sent' || displayStatus === 'receiving' || displayStatus === 'rendering';
      const panelImageSrc = this.getPanelImageSource(panel);

      const safeCaption = this.escapeHtml(this.getPanelCaptionText(panel, index, {
        suppressMissingLog: true,
        fallbackLabel: 'Panel ' + (index + 1)
      }));
      return `
        <div class="gen-panel ${isCurrent ? 'is-current' : ''}">
          <div class="gen-panel-thumb">
            ${panelImageSrc
              ? `<img src="${panelImageSrc}" alt="">`
              : `<svg width="32" height="32" fill="var(--text-muted)"><rect x="4" y="4" width="24" height="24" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`
            }
          </div>
          <div class="gen-panel-info">
            <div class="gen-panel-caption">${safeCaption}</div>
            <div class="gen-panel-status ${statusClass}">
              ${displayStatus === 'completed' ? '✓ ' : ''}${statusLabelMap[displayStatus] || 'Pending'}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      let storageResult;
      try {
        storageResult = await chrome.storage.local.get('currentJob');
      } catch (_) {
        storageResult = {};
      }
      const currentJob = storageResult && storageResult.currentJob;
      
      if (!currentJob || currentJob.status === 'completed' || currentJob.status === 'failed' || currentJob.status === 'canceled') {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
        this.handleCurrentJobState(currentJob);
        return;
      }
      
      this.updateGenerationUI(currentJob);
    }, 1000);
  }

  setViewMode(mode) {
    const nextMode = (mode === 'carousel' || mode === 'panels' || mode === 'strip') ? mode : 'strip';
    this.viewMode = nextMode;
    
    const strip = document.getElementById('comic-strip');
    const carousel = document.getElementById('comic-carousel');
    const panels = document.getElementById('comic-panels');
    const comicDisplay = document.getElementById('comic-display');
    comicDisplay?.classList.toggle('mode-carousel', nextMode === 'carousel');
    
    if (nextMode === 'strip') {
      strip.classList.remove('hidden');
      carousel.classList.add('hidden');
      panels.classList.add('hidden');
    } else if (nextMode === 'carousel') {
      strip.classList.add('hidden');
      carousel.classList.remove('hidden');
      panels.classList.add('hidden');
      this.showCarouselPanel(this.carouselIndex);
    } else {
      strip.classList.add('hidden');
      carousel.classList.add('hidden');
      panels.classList.remove('hidden');
    }

    this.applyGenerationLayoutMode();
  }

  openPopup() {
    chrome.action.openPopup();
  }

  async openOptionsPage() {
    try {
      if (chrome?.runtime?.openOptionsPage) {
        await chrome.runtime.openOptionsPage();
        return;
      }
    } catch (_) {}
    const url = chrome?.runtime?.getURL
      ? chrome.runtime.getURL('options/options.html')
      : 'options/options.html';
    try {
      if (chrome?.tabs?.create) {
        await chrome.tabs.create({ url });
        return;
      }
    } catch (_) {}
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (_) {}
  }

  async openInTab() {
    const url = chrome?.runtime?.getURL
      ? chrome.runtime.getURL('sidepanel/sidepanel.html')
      : 'sidepanel/sidepanel.html';
    try {
      if (chrome?.tabs?.create) {
        await chrome.tabs.create({ url });
        void this.trackMetric('open_in_tab', { source: 'sidepanel' });
        return;
      }
    } catch (_) {}
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      void this.trackMetric('open_in_tab', { source: 'sidepanel_fallback' });
    } catch (_) {}
  }

  getSelectedShareTarget() {
    const select = document.getElementById('share-target-select');
    if (select && select.value) return String(select.value);
    return String(this.selectedShareTarget || 'facebook');
  }

  async getConnectedShareTargets() {
    const connected = new Set();
    let connectionStates = {};
    try {
      const stored = await chrome.storage.local.get('connectionStates');
      connectionStates = (stored && stored.connectionStates && typeof stored.connectionStates === 'object')
        ? stored.connectionStates
        : {};
    } catch (_) {}

    if (connectionStates.instagram) {
      connected.add('instagram');
      connected.add('story');
    }
    if (connectionStates['otherShare:linkedin']) {
      connected.add('linkedin');
      connected.add('linkedin-post');
    }
    if (connectionStates['otherShare:reddit']) connected.add('reddit');
    if (connectionStates['otherShare:email']) {
      connected.add('email');
      connected.add('email-card');
    }

    try {
      const [facebookStatus, xStatus] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'FACEBOOK_GET_STATUS' }).catch(() => null),
        chrome.runtime.sendMessage({ type: 'X_GET_STATUS' }).catch(() => null)
      ]);
      if (facebookStatus && facebookStatus.success !== false && facebookStatus.status?.connected) {
        connected.add('facebook');
      }
      if (xStatus && xStatus.success !== false && xStatus.status?.connected) {
        connected.add('x');
        connected.add('x-card');
      }
    } catch (_) {}

    return connected;
  }

  async refreshShareTargetVisibility() {
    const menu = document.getElementById('share-target-menu');
    if (!menu) return;
    const connectedTargets = await this.getConnectedShareTargets();
    this.visibleShareTargets = connectedTargets;
    const alwaysVisibleTargets = new Set(['facebook']);

    const menuItems = Array.from(menu.querySelectorAll('[data-share-target]'));
    let visibleCount = 0;
    menuItems.forEach((item) => {
      const target = String(item.dataset.shareTarget || '').trim();
      const visible = !!target && (connectedTargets.has(target) || alwaysVisibleTargets.has(target));
      item.classList.toggle('hidden', !visible);
      if (visible) visibleCount += 1;
    });

    const emptyState = document.getElementById('share-target-empty');
    if (emptyState) emptyState.classList.toggle('hidden', visibleCount > 0);
  }

  toggleShareMenu() {
    const shareBtn = document.getElementById('share-btn');
    if (!shareBtn || shareBtn.disabled) return;
    const menu = document.getElementById('share-target-menu');
    if (!menu) return;
    const isOpen = !menu.classList.contains('hidden');
    if (isOpen) {
      this.hideShareMenu();
      return;
    }
    Promise.resolve(this.refreshShareTargetVisibility()).finally(() => {
      menu.classList.remove('hidden');
      shareBtn.setAttribute('aria-expanded', 'true');
    });
  }

  hideShareMenu() {
    const menu = document.getElementById('share-target-menu');
    const shareBtn = document.getElementById('share-btn');
    if (menu) menu.classList.add('hidden');
    if (shareBtn) shareBtn.setAttribute('aria-expanded', 'false');
  }

  async openConnectionsSettings() {
    const url = chrome?.runtime?.getURL
      ? chrome.runtime.getURL('options/options.html?section=connections')
      : 'options/options.html?section=connections';
    try {
      if (chrome?.tabs?.create) {
        await chrome.tabs.create({ url });
        return;
      }
    } catch (_) {}
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (_) {}
  }

  handleShareMenuClick(event) {
    const actionEl = event?.target?.closest?.('[data-share-action]');
    const action = String(actionEl?.dataset?.shareAction || '').trim();
    if (action === 'connect-more') {
      this.hideShareMenu();
      void this.openConnectionsSettings();
      return;
    }

    const targetEl = event?.target?.closest?.('[data-share-target]');
    if (!targetEl) return;
    const target = String(targetEl.dataset.shareTarget || '').trim();
    if (!target) return;
    this.selectedShareTarget = target;
    this.hideShareMenu();
    void this.shareComic(target);
  }

  handleGlobalClick(event) {
    const menu = document.getElementById('share-target-menu');
    const controls = document.querySelector('.share-controls');
    if (!menu || menu.classList.contains('hidden')) return;
    if (controls && controls.contains(event.target)) return;
    this.hideShareMenu();
  }

  getComicShareText() {
    const comic = this.currentComic || {};
    const panels = Array.isArray(comic.panels) ? comic.panels : [];
    const panelText = panels
      .slice(0, 3)
      .map((panel, index) => this.getPanelCaptionText(panel, index, { suppressMissingLog: true }))
      .filter(Boolean)
      .join(' | ');
    const sourceTitle = String(comic?.source?.title || 'Untitled Comic');
    return panelText ? `${sourceTitle}: ${panelText}` : sourceTitle;
  }

  buildSharePayload() {
    const comic = this.currentComic || {};
    const sourceTitle = String(comic?.source?.title || 'Untitled Comic');
    const sourceUrl = this.sanitizeExternalUrl(comic?.source?.url || '');
    const safeSourceUrl = sourceUrl === '#' ? '' : sourceUrl;
    const shareText = this.getComicShareText();
    const brandedText = `${shareText}\nMade with Web2Comics`;
    return {
      sourceTitle,
      sourceUrl: safeSourceUrl,
      shareText,
      brandedText
    };
  }

  async copyTextToClipboard(text) {
    const payload = String(text || '');
    if (!payload) return false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(payload);
        return true;
      }
    } catch (_) {}
    try {
      const textarea = document.createElement('textarea');
      textarea.value = payload;
      textarea.setAttribute('readonly', 'readonly');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return !!copied;
    } catch (_) {
      return false;
    }
  }

  async copyImageDataUrlToClipboard(dataUrl) {
    const payload = String(dataUrl || '').trim();
    if (!payload || !payload.startsWith('data:image/')) return false;
    try {
      const clip = navigator?.clipboard;
      if (!clip || typeof clip.write !== 'function') return false;
      if (typeof ClipboardItem !== 'function') return false;
      const response = await fetch(payload);
      const blob = await response.blob();
      if (!blob || !String(blob.type || '').startsWith('image/')) return false;
      const item = new ClipboardItem({ [blob.type]: blob });
      await clip.write([item]);
      return true;
    } catch (_) {
      return false;
    }
  }

  async openExternalShareUrl(url) {
    const safeUrl = String(url || '');
    if (!safeUrl) return;
    try {
      if (chrome?.tabs?.create) {
        await chrome.tabs.create({ url: safeUrl });
        return;
      }
    } catch (_) {}
    try {
      window.open(safeUrl, '_blank', 'noopener,noreferrer');
    } catch (_) {}
  }

  async loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load panel image'));
      img.src = src;
    });
  }

  wrapCanvasText(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = line + ' ' + words[i];
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
    return lines;
  }

  drawRoundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  sanitizeFilename(name) {
    return String(name || 'web2comics')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 80) || 'web2comics';
  }

  getExportLayoutProfile() {
    const preset = this.layoutPreset || 'polaroid-collage';
    const activeMode = this.layoutPresets[preset]?.mode || this.viewMode || 'strip';
    const map = {
      'single-panel-full': { kind: 'single', name: 'single-panel-full' },
      'split-2-vertical': { kind: 'vertical-list', aspect: 16 / 9, name: preset },
      'split-2-horizontal': { kind: 'strip', columns: 2, aspect: 4 / 3, name: preset },
      'classic-strip': { kind: 'strip', columns: 3, aspect: 4 / 3, name: preset },
      'strip-4-horizontal': { kind: 'strip', columns: 4, aspect: 4 / 3, name: preset },
      'stack-3-vertical': { kind: 'vertical-list', aspect: 4 / 3, name: preset },
      'grid-4': { kind: 'grid', cols: 2, aspect: 4 / 3, name: preset },
      'square-comic-grid': { kind: 'grid', cols: 2, aspect: 1 / 1, name: preset },
      'a4-comic-page': { kind: 'grid', cols: 2, aspect: 3 / 4, name: preset },
      'a5-comic-page': { kind: 'grid', cols: 2, aspect: 4 / 5, name: preset },
      'grid-6': { kind: 'grid', cols: 3, aspect: 4 / 3, name: preset },
      'grid-9': { kind: 'grid', cols: 3, aspect: 1 / 1, compact: true, name: preset },
      'classic-comic-page': { kind: 'patterned-grid', pattern: 'comic-page', name: preset },
      'manga-page-rtl': { kind: 'grid', cols: 2, aspect: 4 / 5, rtl: true, name: preset },
      'webtoon-scroll': { kind: 'vertical-list', aspect: 9 / 16, roomy: true, name: preset },
      'filmstrip': { kind: 'strip', columns: 4, aspect: 4 / 3, compact: true, name: preset },
      'spotlight': { kind: 'spotlight', name: preset },
      'dominant-supporting': { kind: 'patterned-grid', pattern: 'dominant', name: preset },
      'two-tier': { kind: 'patterned-grid', pattern: 'two-tier', name: preset },
      'three-tier': { kind: 'patterned-grid', pattern: 'three-tier', name: preset },
      'side-gutter-captions': { kind: 'side-caption-list', aspect: 4 / 3, name: preset },
      'caption-first': { kind: 'caption-first-list', aspect: 4 / 3, name: preset },
      'polaroid-collage': { kind: 'collage', name: preset },
      'masonry': { kind: 'masonry', name: preset },
      'masonry-landscape-2': { kind: 'masonry', cols: 2, landscape: true, masonryAspects: [1.45, 1.65, 1.35], name: preset },
      'masonry-landscape-3': { kind: 'masonry', cols: 3, landscape: true, masonryAspects: [1.4, 1.6, 1.3], name: preset },
      'masonry-landscape-4': { kind: 'masonry', cols: 4, landscape: true, masonryAspects: [1.35, 1.55, 1.25], compact: true, name: preset },
      'carousel': { kind: 'spotlight', cinema: true, name: preset },
      'guided-path': { kind: 'grid', cols: 2, aspect: 4 / 3, guided: true, name: preset }
    };
    const presetProfile = map[preset] || { kind: 'strip', columns: 3, aspect: 4 / 3, name: preset };

    // Export follows the active layout preset mode.
    if (activeMode === 'carousel') {
      return {
        kind: 'spotlight',
        cinema: preset === 'carousel',
        compact: !!presetProfile.compact,
        name: preset
      };
    }

    if (activeMode === 'strip') {
      const stripColumnsByPreset = {
        'single-panel-full': 1,
        'split-2-vertical': 1,
        'split-2-horizontal': 2,
        'classic-strip': 3,
        'strip-4-horizontal': 4,
        'stack-3-vertical': 1,
        'grid-4': 2,
        'square-comic-grid': 2,
        'a4-comic-page': 2,
        'a5-comic-page': 2,
        'grid-6': 3,
        'grid-9': 3,
        'classic-comic-page': 3,
        'manga-page-rtl': 2,
        'webtoon-scroll': 1,
        'filmstrip': 4,
        'dominant-supporting': 3,
        'two-tier': 3,
        'three-tier': 3,
        'side-gutter-captions': 1,
        'caption-first': 1,
        'polaroid-collage': 2,
        'masonry': 2,
        'masonry-landscape-2': 2,
        'masonry-landscape-3': 3,
        'masonry-landscape-4': 4,
        'carousel': 3,
        'guided-path': 2
      };
      return {
        kind: 'strip',
        columns: stripColumnsByPreset[preset] || presetProfile.columns || 3,
        aspect: presetProfile.aspect || (4 / 3),
        compact: !!presetProfile.compact,
        name: preset
      };
    }

    if (activeMode === 'panels') {
      if (presetProfile.kind === 'single') return { ...presetProfile };
      if (presetProfile.kind === 'grid' || presetProfile.kind === 'patterned-grid' || presetProfile.kind === 'collage' || presetProfile.kind === 'masonry') {
        return { ...presetProfile };
      }
      // When panel view is forced for a non-grid preset, use a predictable multi-panel grid export.
      return {
        kind: 'grid',
        cols: presetProfile.columns || 3,
        aspect: presetProfile.aspect || (4 / 3),
        compact: !!presetProfile.compact,
        name: preset
      };
    }

    return presetProfile;
  }

  getPatternedGridSpans(pattern, count) {
    const spans = [];
    for (let i = 0; i < count; i++) spans.push({ colSpan: 2, rowSpan: 1 });
    if (pattern === 'comic-page') {
      if (count > 0) spans[0] = { colSpan: 6, rowSpan: 1 };
      if (count > 1) spans[1] = { colSpan: 3, rowSpan: 1 };
      if (count > 2) spans[2] = { colSpan: 3, rowSpan: 1 };
      for (let i = 3; i < count; i++) spans[i] = { colSpan: 2, rowSpan: 1 };
      return { cols: 6, spans };
    }
    if (pattern === 'dominant') {
      if (count > 0) spans[0] = { colSpan: 6, rowSpan: 1 };
      for (let i = 1; i < count; i++) spans[i] = { colSpan: 2, rowSpan: 1 };
      return { cols: 6, spans };
    }
    if (pattern === 'two-tier') {
      if (count > 0) spans[0] = { colSpan: 4, rowSpan: 1 };
      for (let i = 1; i < count; i++) spans[i] = { colSpan: 2, rowSpan: 1 };
      return { cols: 4, spans };
    }
    if (pattern === 'three-tier') {
      if (count > 0) spans[0] = { colSpan: 6, rowSpan: 1 };
      if (count > 1) spans[1] = { colSpan: 3, rowSpan: 1 };
      if (count > 2) spans[2] = { colSpan: 3, rowSpan: 1 };
      for (let i = 3; i < count; i++) spans[i] = { colSpan: 2, rowSpan: 1 };
      return { cols: 6, spans };
    }
    return { cols: 4, spans };
  }

  async drawExportImageCover(ctx, img, x, y, w, h, radius = 10) {
    if (!img) return false;
    const srcAspect = img.width / img.height;
    const dstAspect = w / h;
    let dx = x, dy = y, dw = w, dh = h;
    if (srcAspect > dstAspect) {
      // Fit full image width, letterbox vertically to avoid cropping.
      dh = w / srcAspect;
      dy = y + ((h - dh) / 2);
    } else {
      // Fit full image height, pillarbox horizontally to avoid cropping.
      dw = h * srcAspect;
      dx = x + ((w - dw) / 2);
    }
    ctx.save();
    this.drawRoundedRect(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    return true;
  }

  drawExportPanelCard(ctx, panel, thumb, box, opts = {}) {
    const {
      showArrow = false,
      arrowDirection = 'right',
      compact = false,
      sideCaption = false,
      captionFirst = false,
      polaroid = false
    } = opts;
    const caption = this.getPanelCaptionText(panel, opts.index || 0);
    const numberedCaption = `${opts.index + 1}. ${caption}`;
    const pad = compact ? 8 : 12;
    const radius = polaroid ? 6 : 12;

    ctx.fillStyle = '#ffffff';
    this.drawRoundedRect(ctx, box.x, box.y, box.w, box.h, radius);
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    this.drawRoundedRect(ctx, box.x, box.y, box.w, box.h, radius);
    ctx.stroke();

    let imageX = box.x + pad;
    let imageY = box.y + pad;
    let imageW = box.w - pad * 2;
    let imageH = box.imageH;
    let captionX = imageX;
    let captionY = imageY + imageH + 8;
    let captionW = imageW;

    if (sideCaption) {
      imageW = Math.max(120, Math.floor((box.w - pad * 3) * 0.65));
      captionX = imageX + imageW + pad;
      captionY = box.y + pad;
      captionW = box.w - (captionX - box.x) - pad;
      imageH = box.h - pad * 2;
    }
    if (captionFirst) {
      captionY = box.y + pad;
      imageY = box.y + Math.min(64, Math.floor(box.h * 0.22));
      imageH = Math.max(80, box.h - (imageY - box.y) - pad);
    }

    ctx.fillStyle = '#f1f5f9';
    this.drawRoundedRect(ctx, imageX, imageY, imageW, imageH, polaroid ? 3 : 10);
    ctx.fill();
    void this.drawExportImageCover(ctx, thumb, imageX, imageY, imageW, imageH, polaroid ? 3 : 10);

    const lineHeight = compact ? 16 : 18;
    ctx.fillStyle = '#0f172a';
    ctx.font = compact
      ? '600 13px system-ui, -apple-system, Segoe UI, sans-serif'
      : '600 14px system-ui, -apple-system, Segoe UI, sans-serif';
    const lines = this.wrapCanvasText(ctx, numberedCaption, captionW);
    lines.slice(0, compact ? 4 : 5).forEach((line, idx) => {
      ctx.fillText(line, captionX, captionY + 16 + (idx * lineHeight));
    });

    if (showArrow) {
      ctx.fillStyle = '#4338ca';
      ctx.font = '700 18px system-ui, -apple-system, Segoe UI, sans-serif';
      const glyph = arrowDirection === 'down' ? '↓' : '→';
      const ax = arrowDirection === 'down' ? (box.x + box.w / 2 - 5) : (box.x + box.w - 16);
      const ay = arrowDirection === 'down' ? (box.y + box.h + 12) : (box.y + box.h / 2);
      ctx.fillText(glyph, ax, ay);
    }
  }

  async exportComicAsCompositeImage(options = {}) {
    const shouldDownload = options.download !== false;
    const comic = this.currentComic;
    if (!comic?.panels?.length) throw new Error('No comic panels to export');

    const panels = comic.panels;
    const sourceTitle = String(
      document.getElementById('comic-title')?.textContent ||
      this.resolveComicDisplayTitle(comic) ||
      'Untitled Comic'
    ).trim() || 'Untitled Comic';
    const sourceSummary = String(
      document.getElementById('comic-description')?.textContent ||
      comic?.description ||
      ''
    ).trim();
    const sourceUrl = comic?.source?.url || '';
    const siteName = this.getShortSourceName(sourceUrl);

    const profile = this.getExportLayoutProfile();
    const layout = {
      width: 1200,
      margin: 32,
      headerPad: 18,
      panelThumbW: 240,
      panelThumbH: 180,
      panelGap: 14,
      rowGap: 14,
      rowPad: 12
    };

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas export is unavailable');

    // Precompute row heights and load thumbnails.
    const loadedThumbs = await Promise.all(panels.map(async (panel) => {
      const imageSrc = this.getPanelImageSource(panel);
      if (!imageSrc) return null;
      try {
        return await this.loadImageElement(imageSrc);
      } catch {
        return null;
      }
    }));

    const hasSummary = !!sourceSummary;
    const headerHeight = hasSummary ? 148 : 108;
    const footerHeight = 36;
    const urlLineHeight = 18;
    const contentX = layout.margin;
    const contentW = layout.width - layout.margin * 2;
    const bodyTop = layout.margin + headerHeight + 18;
    const gap = 12;
    const panelBoxes = [];

    function pushBox(x, y, w, h, imageH) {
      panelBoxes.push({ x, y, w, h, imageH: imageH || Math.max(90, Math.floor(h * 0.62)) });
    }

    let bodyHeight = 0;
    if (profile.kind === 'single') {
      const h = 760;
      pushBox(contentX, bodyTop, contentW, h, Math.floor(h * 0.75));
      bodyHeight = h;
    } else if (profile.kind === 'vertical-list' || profile.kind === 'side-caption-list' || profile.kind === 'caption-first-list') {
      const aspect = profile.aspect || (4 / 3);
      let y = bodyTop;
      for (let i = 0; i < panels.length; i++) {
        const cardW = contentW;
        const imageH = profile.kind === 'side-caption-list'
          ? Math.floor((cardW * 0.62) / aspect)
          : Math.max(160, Math.floor(cardW / aspect * 0.55));
        const cardH = profile.kind === 'side-caption-list'
          ? Math.max(180, imageH + 24)
          : Math.max(190, imageH + 86);
        pushBox(contentX, y, cardW, cardH, imageH);
        y += cardH + (profile.roomy ? 18 : gap);
      }
      bodyHeight = Math.max(0, y - bodyTop - (profile.roomy ? 18 : gap));
    } else if (profile.kind === 'strip') {
      const cols = Math.max(1, profile.columns || 3);
      const cellW = Math.floor((contentW - gap * (cols - 1)) / cols);
      const imageH = Math.max(120, Math.floor(cellW / (profile.aspect || (4 / 3))));
      const cardH = imageH + (profile.compact ? 62 : 78);
      let y = bodyTop;
      for (let i = 0; i < panels.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = contentX + (col * (cellW + gap));
        y = bodyTop + (row * (cardH + gap));
        pushBox(x, y, cellW, cardH, imageH);
      }
      bodyHeight = panels.length ? (Math.floor((panels.length - 1) / cols) + 1) * cardH + Math.floor((Math.max(0, panels.length - 1)) / cols) * gap : 0;
    } else if (profile.kind === 'grid') {
      const cols = Math.max(1, profile.cols || 2);
      const cellW = Math.floor((contentW - gap * (cols - 1)) / cols);
      const imageH = Math.max(110, Math.floor(cellW / (profile.aspect || (4 / 3))));
      const cardH = imageH + (profile.compact ? 58 : 76);
      let rows = 0;
      for (let i = 0; i < panels.length; i++) {
        const logicalCol = i % cols;
        const col = profile.rtl ? (cols - 1 - logicalCol) : logicalCol;
        const row = Math.floor(i / cols);
        rows = Math.max(rows, row + 1);
        const x = contentX + (col * (cellW + gap));
        const y = bodyTop + (row * (cardH + gap));
        pushBox(x, y, cellW, cardH, imageH);
      }
      bodyHeight = rows ? (rows * cardH + (rows - 1) * gap) : 0;
    } else if (profile.kind === 'patterned-grid') {
      const pattern = this.getPatternedGridSpans(profile.pattern, panels.length);
      const cols = pattern.cols;
      const colW = Math.floor((contentW - gap * (cols - 1)) / cols);
      const rowHUnit = 220;
      const occupancy = [];
      function canPlace(row, col, colSpan, rowSpan) {
        for (let r = row; r < row + rowSpan; r++) {
          for (let c = col; c < col + colSpan; c++) {
            if (c >= cols) return false;
            if (occupancy[r] && occupancy[r][c]) return false;
          }
        }
        return true;
      }
      function markPlace(row, col, colSpan, rowSpan) {
        for (let r = row; r < row + rowSpan; r++) {
          occupancy[r] = occupancy[r] || [];
          for (let c = col; c < col + colSpan; c++) occupancy[r][c] = true;
        }
      }
      let maxRow = 0;
      for (let i = 0; i < panels.length; i++) {
        const span = pattern.spans[i] || { colSpan: 2, rowSpan: 1 };
        let placed = false;
        for (let row = 0; row < 30 && !placed; row++) {
          for (let col = 0; col < cols && !placed; col++) {
            if (!canPlace(row, col, span.colSpan, span.rowSpan)) continue;
            markPlace(row, col, span.colSpan, span.rowSpan);
            const x = contentX + col * (colW + gap);
            const w = span.colSpan * colW + (span.colSpan - 1) * gap;
            const h = span.rowSpan * rowHUnit + (span.rowSpan - 1) * gap;
            pushBox(x, bodyTop + row * (rowHUnit + gap), w, h, Math.max(120, Math.floor(h * 0.68)));
            maxRow = Math.max(maxRow, row + span.rowSpan);
            placed = true;
          }
        }
      }
      bodyHeight = maxRow ? (maxRow * rowHUnit + (maxRow - 1) * gap) : 0;
    } else if (profile.kind === 'collage' || profile.kind === 'masonry') {
      const cols = Math.max(2, Number(profile.cols) || 2);
      const colW = Math.floor((contentW - gap * (cols - 1)) / cols);
      const colHeights = new Array(cols).fill(bodyTop);
      for (let i = 0; i < panels.length; i++) {
        let col = 0;
        for (let c = 1; c < cols; c++) {
          if (colHeights[c] < colHeights[col]) col = c;
        }
        const variant = profile.kind === 'masonry' ? (i % 3) : (i % 4);
        const imageAspect = profile.kind === 'masonry'
          ? ((Array.isArray(profile.masonryAspects) && profile.masonryAspects[variant]) || [1, 0.8, 1.25][variant] || 1)
          : ([1.2, 0.9, 1.1, 0.75][variant] || 1);
        const imageH = Math.max(120, Math.floor(colW / imageAspect));
        const cardH = imageH + (profile.kind === 'masonry' ? (profile.compact ? 54 : 64) : 78);
        const x = contentX + col * (colW + gap);
        const y = colHeights[col];
        pushBox(x, y, colW, cardH, imageH);
        colHeights[col] += cardH + gap;
      }
      bodyHeight = Math.max(0, Math.max.apply(null, colHeights) - bodyTop - gap);
    } else if (profile.kind === 'spotlight') {
      const bigH = 520;
      pushBox(contentX, bodyTop, contentW, bigH, 420);
      const thumbCols = Math.min(5, Math.max(2, panels.length - 1 || 4));
      const thumbW = Math.floor((contentW - gap * (thumbCols - 1)) / thumbCols);
      const thumbH = 130;
      const y = bodyTop + bigH + 14;
      for (let i = 1; i < panels.length; i++) {
        const col = (i - 1) % thumbCols;
        const row = Math.floor((i - 1) / thumbCols);
        pushBox(contentX + col * (thumbW + gap), y + row * (thumbH + gap), thumbW, thumbH, 78);
      }
      const thumbRows = Math.ceil(Math.max(0, panels.length - 1) / thumbCols);
      bodyHeight = bigH + 14 + (thumbRows ? thumbRows * thumbH + (thumbRows - 1) * gap : 0);
    } else {
      // Fallback: strip
      const cols = 3;
      const cellW = Math.floor((contentW - gap * (cols - 1)) / cols);
      const imageH = Math.floor(cellW / (4 / 3));
      const cardH = imageH + 74;
      let rows = 0;
      for (let i = 0; i < panels.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        rows = Math.max(rows, row + 1);
        pushBox(contentX + col * (cellW + gap), bodyTop + row * (cardH + gap), cellW, cardH, imageH);
      }
      bodyHeight = rows ? rows * cardH + (rows - 1) * gap : 0;
    }

    canvas.width = layout.width;
    canvas.height = layout.margin + headerHeight + 18 + bodyHeight + footerHeight + layout.margin;

    // Background
    const bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGradient.addColorStop(0, '#ffffff');
    bgGradient.addColorStop(1, '#f8fafc');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Header card
    const cardX = layout.margin;
    const cardY = layout.margin;
    const cardW = canvas.width - layout.margin * 2;
    ctx.fillStyle = '#ffffff';
    this.drawRoundedRect(ctx, cardX, cardY, cardW, headerHeight, 16);
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    this.drawRoundedRect(ctx, cardX, cardY, cardW, headerHeight, 16);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(String(siteName || 'site').toUpperCase(), cardX + layout.headerPad, cardY + 22);

    ctx.fillStyle = '#0f172a';
    ctx.font = '700 24px system-ui, -apple-system, Segoe UI, sans-serif';
    const titleLines = this.wrapCanvasText(ctx, sourceTitle, cardW - (layout.headerPad * 2));
    const titleToDraw = titleLines.slice(0, 2);
    titleToDraw.forEach((line, i) => {
      ctx.fillText(line, cardX + layout.headerPad, cardY + 48 + (i * 28));
    });

    if (hasSummary) {
      ctx.fillStyle = '#334155';
      ctx.font = '500 14px system-ui, -apple-system, Segoe UI, sans-serif';
      const summaryLines = this.wrapCanvasText(ctx, sourceSummary, cardW - (layout.headerPad * 2));
      (summaryLines.slice(0, 2)).forEach((line, i) => {
        ctx.fillText(line, cardX + layout.headerPad, cardY + 84 + (i * 18));
      });
    }

    ctx.fillStyle = '#475569';
    ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const urlLines = this.wrapCanvasText(ctx, sourceUrl, cardW - (layout.headerPad * 2));
    const urlStartY = hasSummary ? 124 : 82;
    (urlLines.slice(0, 2)).forEach((line, i) => {
      ctx.fillText(line, cardX + layout.headerPad, cardY + urlStartY + (i * urlLineHeight));
    });

    // Panel layout body (preset-aware)
    for (let i = 0; i < Math.min(panelBoxes.length, panels.length); i++) {
      const box = panelBoxes[i];
      const opts = {
        index: i,
        compact: !!profile.compact || profile.kind === 'spotlight',
        sideCaption: profile.kind === 'side-caption-list',
        captionFirst: profile.kind === 'caption-first-list',
        polaroid: profile.kind === 'collage'
      };
      if (profile.guided && i < panels.length - 1) {
        opts.showArrow = true;
        opts.arrowDirection = ((i + 1) % 2 === 0) ? 'down' : 'right';
      }
      this.drawExportPanelCard(ctx, panels[i], loadedThumbs[i], box, opts);
    }

    // Footer
    ctx.fillStyle = '#64748b';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText('Made with Web2Comics', layout.margin, canvas.height - layout.margin + 4);

    const dataUrl = canvas.toDataURL('image/png');
    const filename = this.sanitizeFilename(sourceTitle) + '-comic-sheet.png';
    if (shouldDownload) {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename;
      link.click();
    }
    return {
      dataUrl,
      filename,
      sourceTitle,
      sourceUrl
    };
  }

  async downloadComic() {
    try {
      await this.exportComicAsCompositeImage({ download: true });
    } catch (error) {
      console.error('Failed to export comic image:', error);
      void this.appendDebugLog('comic.export.error', { message: error?.message || String(error) });
      alert('Failed to export comic as a single image.');
    }
  }

  async shareComic(forcedTarget) {
    const target = String(forcedTarget || this.getSelectedShareTarget() || '').trim();
    if (!this.currentComic) return;
    const payload = this.buildSharePayload();
    const encodedUrl = encodeURIComponent(payload.sourceUrl || '');
    const encodedTitle = encodeURIComponent(payload.sourceTitle || 'Web2Comics');
    const encodedText = encodeURIComponent(payload.brandedText || '');
    const encodedEmailBody = encodeURIComponent(
      `${payload.brandedText || payload.sourceTitle}\n\nSource: ${payload.sourceUrl || '(unavailable)'}`
    );

    try {
      if (target === 'copy-link') {
        const copied = await this.copyTextToClipboard(payload.sourceUrl || payload.sourceTitle);
        alert(copied ? 'Copied source link.' : 'Unable to copy source link.');
        if (copied) void this.trackMetric('share', { target: 'copy-link' });
        return;
      }
      if (target === 'copy-caption') {
        const copied = await this.copyTextToClipboard(payload.brandedText || payload.shareText);
        alert(copied ? 'Copied comic caption text.' : 'Unable to copy comic caption text.');
        if (copied) void this.trackMetric('share', { target: 'copy-caption' });
        return;
      }

      if (target === 'facebook') {
        try {
          const response = await chrome.runtime.sendMessage({
            type: 'FACEBOOK_POST_PAGE',
            payload: {
              message: payload.brandedText || payload.shareText || payload.sourceTitle || 'Shared via Web2Comics',
              link: payload.sourceUrl || ''
            }
          });
          if (response && response.success !== false && response.postId) {
            alert('Posted to connected Facebook Page.');
            void this.trackMetric('share', { target: 'facebook-page-post' });
            return;
          }
          throw new Error(response?.error || 'Facebook page post failed');
        } catch (_) {
          // Fall back to existing composer-assisted flow below.
        }
      }

      if (
        target === 'instagram' ||
        target === 'facebook' ||
        target === 'story' ||
        target === 'x-card' ||
        target === 'linkedin-post'
      ) {
        const exported = await this.exportComicAsCompositeImage({ download: false });
        const copiedCaption = await this.copyTextToClipboard(
          `${payload.brandedText || payload.shareText}\nSource: ${payload.sourceUrl || '(source unavailable)'}`
        );
        const copiedImage = await this.copyImageDataUrlToClipboard(exported.dataUrl);
        if (!copiedImage) {
          const link = document.createElement('a');
          link.href = exported.dataUrl;
          link.download = exported.filename || 'web2comics-comic.png';
          link.click();
        }
        if (target === 'story' || target === 'instagram') await this.openExternalShareUrl('https://www.instagram.com/');
        if (target === 'facebook') await this.openExternalShareUrl('https://www.facebook.com/?sk=composer');
        if (target === 'x-card') await this.openExternalShareUrl('https://x.com/compose/post');
        if (target === 'linkedin-post') await this.openExternalShareUrl('https://www.linkedin.com/feed/');
        if (copiedImage && copiedCaption) {
          alert('Image and caption copied. Opened composer, now paste and post.');
        } else if (copiedImage) {
          alert('Image copied. Opened composer, now paste and post.');
        } else if (copiedCaption) {
          alert('Image downloaded and caption copied.');
        } else {
          alert('Image downloaded.');
        }
        void this.trackMetric('share', { target: target });
        return;
      }

      if (target === 'email-card') {
        const exported = await this.exportComicAsCompositeImage({ download: false });
        const copied = await this.copyTextToClipboard(
          `${payload.brandedText || payload.shareText}\nSource: ${payload.sourceUrl || '(source unavailable)'}`
        );
        const link = document.createElement('a');
        link.href = exported.dataUrl;
        link.download = exported.filename || 'web2comics-comic.png';
        link.click();
        const emailUrl = `mailto:?subject=${encodedTitle}&body=${encodedEmailBody}`;
        await this.openExternalShareUrl(emailUrl);
        alert(copied ? 'Image downloaded and caption copied.' : 'Image downloaded.');
        void this.trackMetric('share', { target: target });
        return;
      }

      let shareUrl = '';
      if (target === 'x') {
        shareUrl = `https://x.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`;
      } else if (target === 'linkedin') {
        shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
      } else if (target === 'whatsapp') {
        shareUrl = `https://wa.me/?text=${encodeURIComponent((payload.brandedText || payload.shareText || '') + '\n' + (payload.sourceUrl || ''))}`;
      } else if (target === 'telegram') {
        shareUrl = `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`;
      } else if (target === 'reddit') {
        shareUrl = `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`;
      } else if (target === 'email') {
        shareUrl = `mailto:?subject=${encodedTitle}&body=${encodedEmailBody}`;
      }

      if (!shareUrl) {
        alert('Unsupported share target.');
        return;
      }
      await this.openExternalShareUrl(shareUrl);
      void this.trackMetric('share', { target: target });
    } catch (error) {
      console.error('Failed to share comic:', error);
      void this.appendDebugLog('comic.share.error', {
        target,
        message: error?.message || String(error)
      });
      alert('Failed to open sharing target.');
    }
  }

  async cancelGeneration() {
    const cancelBtn = document.getElementById('cancel-gen-btn');
    if (cancelBtn) cancelBtn.disabled = true;
    const statusEl = document.getElementById('gen-status-text');
    const detailEl = document.getElementById('gen-status-detail');
    if (statusEl) statusEl.textContent = 'Canceling...';
    if (detailEl) detailEl.textContent = 'Waiting for provider requests to stop...';
    try {
      await chrome.runtime.sendMessage({ type: 'CANCEL_GENERATION' });
    } catch (error) {
      if (cancelBtn) cancelBtn.disabled = false;
      void this.appendDebugLog('generation.cancel.error', { message: error?.message || String(error) });
      throw error;
    }
  }

  async regenerate() {
    if (!this.currentComic) return;
    // TODO: Implement regenerate with current settings
  }

  editStoryboard() {
    // TODO: Implement storyboard editor
    console.log('Edit storyboard clicked');
  }

  getShortSourceName(url) {
    const normalizeHostname = (rawHost) => {
      const withoutWww = String(rawHost || '').toLowerCase().replace(/^www\./, '').trim();
      if (!withoutWww) return 'site';
      if (withoutWww === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(withoutWww)) return withoutWww;
      const parts = withoutWww.split('.').filter(Boolean);
      if (parts.length <= 2) return parts[0] || withoutWww;
      const secondLevelCountryTlds = new Set([
        'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
        'co.il', 'org.il', 'gov.il', 'ac.il',
        'com.au', 'net.au', 'org.au',
        'co.jp', 'ne.jp', 'or.jp',
        'com.br', 'com.cn', 'com.hk', 'com.sg'
      ]);
      const tail = parts.slice(-2).join('.');
      if (secondLevelCountryTlds.has(tail) && parts.length >= 3) {
        return parts[parts.length - 3] || withoutWww;
      }
      return parts[parts.length - 2] || withoutWww;
    };
    try {
      const parsed = new URL(String(url || ''));
      return normalizeHostname(parsed.hostname);
    } catch {
      const raw = String(url || '').trim();
      if (!raw) return 'site';
      const host = raw
        .replace(/^[a-z]+:\/\//i, '')
        .split('/')[0]
        .split('?')[0]
        .split('#')[0]
        .trim();
      return normalizeHostname(host);
    }
  }

  getHistoryThumbnail(item) {
    const itemId = String(item?.id || '').trim();
    if (itemId && this.historyThumbnailMap.has(itemId)) {
      const mapped = this.resolveImageSourceValue(this.historyThumbnailMap.get(itemId));
      if (mapped) return mapped;
    }
    const explicit = this.resolveImageSourceValue(item?.thumbnail);
    if (explicit) return explicit;
    const panels = Array.isArray(item?.storyboard?.panels) ? item.storyboard.panels : [];
    for (let i = 0; i < panels.length; i++) {
      const image = this.getPanelImageSource(panels[i]);
      if (image) return image;
    }
    return '';
  }

  hydrateHistoryThumbnail(item) {
    const sourceItem = item && typeof item === 'object' ? item : null;
    if (!sourceItem) return { item, changed: false };
    const existing = this.resolveImageSourceValue(sourceItem.thumbnail);
    if (existing) {
      const existingId = String(sourceItem.id || '').trim();
      if (existingId && !this.historyThumbnailMap.has(existingId)) {
        this.historyThumbnailMap.set(existingId, existing);
      }
      return { item: sourceItem, changed: false };
    }
    const derived = this.getHistoryThumbnail(sourceItem);
    if (!derived) return { item: sourceItem, changed: false };
    return {
      item: {
        ...sourceItem,
        thumbnail: derived
      },
      changed: true
    };
  }

  async renderSmallThumbnailDataUrl(src, width = 192, height = 108) {
    const imageSrc = this.resolveImageSourceValue(src);
    if (!imageSrc) return '';
    try {
      const img = await this.loadImageElement(imageSrc);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) return '';
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, width, height);
      const srcAspect = Math.max(0.01, Number(img.width || 1) / Number(img.height || 1));
      const dstAspect = width / height;
      let dw = width;
      let dh = height;
      if (srcAspect > dstAspect) {
        dh = Math.max(1, Math.round(width / srcAspect));
      } else {
        dw = Math.max(1, Math.round(height * srcAspect));
      }
      const dx = Math.round((width - dw) / 2);
      const dy = Math.round((height - dh) / 2);
      ctx.drawImage(img, dx, dy, dw, dh);
      return canvas.toDataURL('image/jpeg', 0.78);
    } catch (_) {
      return '';
    }
  }

  async ensureHistoryThumbnailsPersisted(items) {
    const sourceItems = Array.isArray(items) ? items : [];
    if (!sourceItems.length) return;
    const updates = {};
    let changed = false;
    for (let i = 0; i < sourceItems.length; i += 1) {
      const item = sourceItems[i] || {};
      const id = String(item.id || '').trim();
      if (!id || this.historyThumbnailMap.has(id)) continue;
      const base = this.resolveImageSourceValue(item.thumbnail) || this.getPanelImageSource((item.storyboard?.panels || [])[0] || {});
      if (!base) continue;
      const thumb = await this.renderSmallThumbnailDataUrl(base);
      if (!thumb) continue;
      this.historyThumbnailMap.set(id, thumb);
      updates[id] = thumb;
      changed = true;
    }
    if (!changed) return;
    try {
      const { historyThumbnails } = await chrome.storage.local.get('historyThumbnails');
      const merged = {
        ...((historyThumbnails && typeof historyThumbnails === 'object') ? historyThumbnails : {}),
        ...updates
      };
      await chrome.storage.local.set({ historyThumbnails: merged });
    } catch (_) {
      void this.appendDebugLog('history.thumbnail_map.persist_error', {});
    }
  }

  getHistoryCollageImages(item, maxCount = 4) {
    const limit = Number(maxCount) > 0 ? Math.min(Number(maxCount), 6) : 4;
    const images = [];
    const pushUnique = (value) => {
      const src = this.resolveImageSourceValue(value);
      if (!src) return;
      if (!images.includes(src)) images.push(src);
    };

    pushUnique(item?.thumbnail);
    const panels = Array.isArray(item?.storyboard?.panels) ? item.storyboard.panels : [];
    for (let i = 0; i < panels.length && images.length < limit; i++) {
      pushUnique(panels[i]?.artifacts?.image_blob_ref);
      pushUnique(panels[i]?.artifacts?.image_url);
      pushUnique(panels[i]?.image_blob_ref);
      pushUnique(panels[i]?.image_url);
    }
    if (!images.length) {
      if (globalThis && globalThis.__WEB2COMICS_TEST_LOGS__) {
        void this.appendDebugLog('history.thumbnail.fallback_used', {
          comicId: item?.id || null,
          hasExplicitThumbnail: !!this.resolveImageSourceValue(item?.thumbnail),
          panelCount: panels.length
        });
      }
      pushUnique(this.getHistoryFallbackPreviewImage(item));
    }
    return images.slice(0, limit);
  }

  getHistoryFallbackPreviewImage(item) {
    const itemId = String(item?.id || '').trim();
    const cacheKey = itemId || JSON.stringify({
      title: String(item?.storyboard?.title || item?.source?.title || item?.sourceTitle || ''),
      generatedAt: String(item?.generated_at || '')
    });
    if (this.historyPreviewFallbackCache.has(cacheKey)) {
      return this.historyPreviewFallbackCache.get(cacheKey) || '';
    }

    let dataUrl = '';
    try {
      const ua = String(globalThis?.navigator?.userAgent || '').toLowerCase();
      if (ua.includes('jsdom')) return '';
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) return '';

      const grad = ctx.createLinearGradient(0, 0, 320, 180);
      grad.addColorStop(0, '#dbeafe');
      grad.addColorStop(1, '#f1f5f9');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 320, 180);

      ctx.fillStyle = 'rgba(15,23,42,0.08)';
      ctx.fillRect(10, 10, 300, 160);
      // Two-panel placeholder motif without text overlays.
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(30,41,59,0.2)';
      ctx.lineWidth = 1;
      ctx.fillRect(20, 80, 132, 78);
      ctx.strokeRect(20, 80, 132, 78);
      ctx.fillRect(168, 80, 132, 78);
      ctx.strokeRect(168, 80, 132, 78);

      dataUrl = canvas.toDataURL('image/png');
    } catch (_) {
      dataUrl = '';
    }

    if (dataUrl) {
      this.historyPreviewFallbackCache.set(cacheKey, dataUrl);
    }
    return dataUrl;
  }

  getHistorySourceInfo(item) {
    const storyboardSource = item?.storyboard?.source || {};
    const source = item?.source || {};
    const manualSourceInfo = this.getManualSourceInfo(storyboardSource) || this.getManualSourceInfo(source);
    const isManual = !!manualSourceInfo;
    const url = String(
      source.url ||
      item?.sourceUrl ||
      item?.url ||
      storyboardSource.url ||
      ''
    ).trim();
    const title = this.deriveHistoryCardTitle(item);
    return {
      url: isManual ? '#' : (url || '#'),
      title,
      isManual,
      manualSourceInfo
    };
  }

  renderHistoryCard(item, options = {}) {
    const sourceInfo = this.getHistorySourceInfo(item);
    const sourceUrl = sourceInfo.url || '#';
    const safeSourceHref = this.sanitizeExternalUrl(sourceUrl);
    const shortName = sourceInfo.isManual ? 'Custom story' : this.getShortSourceName(sourceUrl);
    const sourceTitle = sourceInfo.title || 'Untitled';
    const showDate = options.showDate !== false;
    const showSourceLink = options.showOriginalLink !== false;
    const sourceLinkLabel = sourceInfo.isManual ? 'Story' : 'Source';
    let dateText = '';
    try {
      dateText = item?.generated_at
        ? new Date(item.generated_at).toLocaleString(undefined, {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
          })
        : '';
    } catch {
      dateText = '';
    }
    const safeId = this.escapeHtml(item?.id || '');
    const safeShortName = this.escapeHtml(shortName);
    const safeSourceTitle = this.escapeHtml(sourceTitle);
    const safeDateText = this.escapeHtml(dateText);
    const thumbSrcRaw = (this.getHistoryCollageImages(item, 1)[0] || '').trim();
    const thumbSrc = this.escapeHtml(thumbSrcRaw);
    const isFavorite = !!item?.favorite;
    return `
      <div class="history-item" data-id="${safeId}" role="button" tabindex="0" aria-label="Open comic ${safeSourceTitle}">
        <div class="history-thumb ${thumbSrc ? '' : 'is-empty'}">
          ${thumbSrc ? `<img class="history-thumb-image" src="${thumbSrc}" alt="">` : ''}
        </div>
        <div class="history-card-body">
          <div class="history-title" title="${safeSourceTitle}">${safeSourceTitle}</div>
          <div class="history-meta-row">
            <span class="history-source-chip">${safeShortName}</span>
            ${showSourceLink ? `<a class="history-source-link" href="${safeSourceHref}" target="_blank" rel="noopener noreferrer">${sourceLinkLabel}</a>` : ''}
          </div>
          ${showDate && dateText ? `<div class="history-date">${safeDateText}</div>` : ''}
          <div class="history-card-actions">
            <button type="button" class="history-action-btn history-item-favorite-btn${isFavorite ? ' is-active' : ''}" data-action="favorite-history-item" aria-label="${isFavorite ? 'Unstar comic' : 'Star comic'}" title="${isFavorite ? 'Unstar comic' : 'Star comic'}">★</button>
            <button type="button" class="history-action-btn history-item-delete-btn" data-action="delete-history-item" aria-label="Delete comic from My Collection" title="Delete comic">
              <svg class="history-action-icon" width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M5.5 5.5a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75Zm2.5 0a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5A.75.75 0 0 1 8 5.5Zm3.25.75a.75.75 0 0 0-1.5 0v5a.75.75 0 0 0 1.5 0v-5Z"/>
                <path d="M14 3.75a.75.75 0 0 1-.75.75h-.69l-.62 8.06A1.75 1.75 0 0 1 10.2 14H5.8a1.75 1.75 0 0 1-1.74-1.44L3.44 4.5h-.69a.75.75 0 0 1 0-1.5h3.03a2 2 0 0 1 3.44 0h3.03A.75.75 0 0 1 14 3.75Zm-6-1.25a.5.5 0 0 0-.5.5h1a.5.5 0 0 0-.5-.5Zm-3.06 2 .6 7.84a.25.25 0 0 0 .25.16h4.42a.25.25 0 0 0 .25-.16l.6-7.84H4.94Z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  async toggleHistoryFavorite(itemId) {
    const id = String(itemId || '').trim();
    if (!id) return;
    const nextHistory = this.historyItems.map((item) => {
      if (!item || String(item.id || '') !== id) return item;
      return { ...item, favorite: !item.favorite };
    });
    await chrome.storage.local.set({ history: nextHistory });
    this.historyItems = nextHistory;
    await this.loadHistory();
  }

  async shareHistoryItem(itemId) {
    const id = String(itemId || '').trim();
    if (!id) return;
    const item = this.historyItems.find((h) => h && String(h.id || '') === id);
    if (!item || !item.storyboard) return;
    try {
      await chrome.storage.local.set({ selectedHistoryComicId: item.id });
    } catch (_) {
      void this.appendDebugLog('history.selected.persist.error', { id: item.id });
    }
    this.currentComicId = String(item.id || '');
    const hydrated = await this.hydrateStoryboardImagesFromArchive(item.storyboard, this.currentComicId);
    this.displayComic(this.prepareHistoryStoryboardForDisplay({ ...item, storyboard: hydrated }));
    this.setPrimaryView('comic');
    this.toggleShareMenu();
  }

  async hydrateStoryboardImagesFromArchive(storyboard, comicId) {
    const base = storyboard && typeof storyboard === 'object' ? storyboard : null;
    const panels = Array.isArray(base?.panels) ? base.panels : null;
    if (!base || !panels || !panels.length) return storyboard;

    const keys = [];
    const panelMeta = [];
    const seen = new Set();
    for (let i = 0; i < panels.length; i += 1) {
      const panel = panels[i] && typeof panels[i] === 'object' ? panels[i] : {};
      if (this.getPanelImageSource(panel)) continue;
      const panelId = String(panel.panel_id || ('panel_' + (i + 1))).trim() || ('panel_' + (i + 1));
      const explicitKey = String(panel?.artifacts?.image_archive_key || '').trim();
      const idKey = comicId ? (comicId + '::' + panelId) : '';
      const indexKey = comicId ? (comicId + '::panel_' + (i + 1)) : '';
      // Prefer deterministic keys first; explicit keys from older saves can be stale/colliding.
      const candidateKeys = [indexKey, idKey, explicitKey].filter(Boolean);
      if (!candidateKeys.length) continue;
      candidateKeys.forEach((key) => {
        if (seen.has(key)) return;
        seen.add(key);
        keys.push(key);
      });
      panelMeta.push({ index: i, keys: candidateKeys });
    }
    if (!keys.length) return storyboard;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_ARCHIVED_PANEL_IMAGES',
        payload: { keys }
      });
      const images = response && response.images && typeof response.images === 'object' ? response.images : {};
      let restored = 0;
      const usedKeys = new Set();
      const nextPanels = panels.map((panel, index) => {
        const meta = panelMeta.find((item) => item.index === index);
        if (!meta) return panel;
        const keysWithImage = (meta.keys || []).filter((k) => !!images[k]);
        const matched = keysWithImage.find((k) => !usedKeys.has(k)) || keysWithImage[0];
        const imageSrc = String((matched && images[matched]) || '').trim();
        if (!imageSrc) return panel;
        restored += 1;
        if (matched) usedKeys.add(matched);
        const sourcePanel = panel && typeof panel === 'object' ? panel : {};
        const artifacts = sourcePanel.artifacts && typeof sourcePanel.artifacts === 'object'
          ? { ...sourcePanel.artifacts }
          : {};
        artifacts.image_blob_ref = imageSrc;
        artifacts.image_archive_key = String(matched || '').trim();
        return { ...sourcePanel, artifacts };
      });
      if (!restored) return storyboard;
      void this.appendDebugLog('history.archive.rehydrated', {
        comicId: comicId || null,
        restoredPanels: restored
      });
      return {
        ...base,
        panels: nextPanels
      };
    } catch (_) {
      return storyboard;
    }
  }

  bindHistoryItemClicks(container, history) {
    container.querySelectorAll('.history-item').forEach(el => {
      const openItem = async () => {
        const item = history.find(h => h.id === el.dataset.id);
        if (item) {
          try {
            await chrome.storage.local.set({ selectedHistoryComicId: item.id });
          } catch (_) {
            void this.appendDebugLog('history.selected.persist.error', { id: item.id });
          }
          this.currentComicId = String(item.id || '');
          const hydrated = await this.hydrateStoryboardImagesFromArchive(item.storyboard, this.currentComicId);
          this.displayComic(this.prepareHistoryStoryboardForDisplay({ ...item, storyboard: hydrated }));
        }
      };
      el.addEventListener('click', openItem);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openItem();
        }
      });
    });

    container.querySelectorAll('.history-item-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const itemEl = e.currentTarget.closest('.history-item');
        const itemId = itemEl?.dataset?.id || '';
        if (!itemId) return;
        if (!confirm('Delete this comic from My Collection?')) return;
        const deletedItem = this.historyItems.find((h) => h && h.id === itemId) || null;
        const nextHistory = this.historyItems.filter((h) => h && h.id !== itemId);
        const payload = { history: nextHistory };
        try {
          const id = String(itemId || '').trim();
          if (id) {
            this.historyThumbnailMap.delete(id);
            const { historyThumbnails } = await chrome.storage.local.get('historyThumbnails');
            const nextThumbs = { ...((historyThumbnails && typeof historyThumbnails === 'object') ? historyThumbnails : {}) };
            delete nextThumbs[id];
            payload.historyThumbnails = nextThumbs;
          }
        } catch (_) {}
        try {
          const { selectedHistoryComicId } = await chrome.storage.local.get('selectedHistoryComicId');
          if (selectedHistoryComicId === itemId) payload.selectedHistoryComicId = null;
        } catch (_) {
          void this.appendDebugLog('history.selected.read.error', { id: itemId });
        }
        await chrome.storage.local.set(payload);
        this.historyItems = nextHistory;
        if (
          deletedItem?.storyboard?.source?.url &&
          this.currentComic?.source?.url &&
          deletedItem.storyboard.source.url === this.currentComic.source.url
        ) {
          this.currentComic = null;
        }
        await this.loadHistory();
      });
    });

    container.querySelectorAll('.history-item-favorite-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const itemEl = e.currentTarget.closest('.history-item');
        const itemId = itemEl?.dataset?.id || '';
        if (!itemId) return;
        await this.toggleHistoryFavorite(itemId);
      });
    });

    container.querySelectorAll('.history-source-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        const itemEl = e.currentTarget.closest('.history-item');
        const itemId = String(itemEl?.dataset?.id || '').trim();
        const item = this.historyItems.find((h) => h && String(h.id || '') === itemId);
        const sourceInfo = item ? this.getHistorySourceInfo(item) : null;
        if (sourceInfo?.isManual && sourceInfo.manualSourceInfo) {
          e.preventDefault();
          this.openManualSourceWindow(sourceInfo.manualSourceInfo);
        }
        e.stopPropagation();
      });
    });
  }

  async loadHistory() {
    const state = await chrome.storage.local.get(['history', 'historyThumbnails']);
    const thumbState = (state.historyThumbnails && typeof state.historyThumbnails === 'object') ? state.historyThumbnails : {};
    this.historyThumbnailMap = new Map(Object.entries(thumbState));
    let rawHistory = Array.isArray(state.history) ? state.history : null;
    if (!rawHistory) {
      const fallback = await chrome.storage.local.get('history');
      rawHistory = Array.isArray(fallback.history) ? fallback.history : [];
    }
    let mutated = false;
    let updatedCount = 0;
    const hydratedHistory = rawHistory.map((entry) => {
      const result = this.hydrateHistoryThumbnail(entry);
      if (result.changed) {
        mutated = true;
        updatedCount += 1;
      }
      return result.item;
    });
    this.historyItems = hydratedHistory;
    void this.ensureHistoryThumbnailsPersisted(hydratedHistory);
    if (mutated) {
      try {
        await chrome.storage.local.set({ history: hydratedHistory });
        if (globalThis && globalThis.__WEB2COMICS_TEST_LOGS__) {
          void this.appendDebugLog('history.thumbnail.hydrated', {
            updatedItems: updatedCount
          });
        }
      } catch (_) {
        if (globalThis && globalThis.__WEB2COMICS_TEST_LOGS__) {
          void this.appendDebugLog('history.thumbnail.hydrate.persist_error', {});
        }
      }
    }
    this.historyBrowserLimit = 12;
    const container = document.getElementById('history-list');
    const browserGrid = document.getElementById('history-browser-grid');
    const browserEmpty = document.getElementById('history-browser-empty');
    const browserActions = document.getElementById('history-browser-actions');
    this.updateHistoryBrowserControls();
    
    if (!this.historyItems.length) {
      container.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">No items in My Collection yet</p>';
      if (browserGrid) browserGrid.innerHTML = '';
      if (browserEmpty) {
        browserEmpty.classList.remove('hidden');
        browserEmpty.innerHTML = '<h3>No comics in My Collection yet</h3><p>Generate your first comic to populate the browser.</p>';
      }
      if (browserActions) browserActions.classList.add('hidden');
      this.updateViewerStats();
      return;
    }
    if (browserEmpty) browserEmpty.classList.add('hidden');
    
    const sidebarItems = this.historyItems.slice(0, 8);
    container.innerHTML = sidebarItems.map((item) => this.renderHistoryCard(item, { showDate: false })).join('');
    this.bindHistoryItemClicks(container, this.historyItems);

    this.renderHistoryBrowser();
    this.updateViewerStats();
    if (!this.currentComic) {
      void this.tryDisplaySelectedHistoryComic();
    }
  }

  renderHistoryBrowser() {
    const browserGrid = document.getElementById('history-browser-grid');
    const browserActions = document.getElementById('history-browser-actions');
    const moreBtn = document.getElementById('history-browser-more-btn');
    if (!browserGrid) return;

    const sortedItems = this.getProcessedHistoryItems();
    const visibleItems = sortedItems.slice(0, this.historyBrowserLimit);
    browserGrid.innerHTML = visibleItems.map((item) => this.renderHistoryCard(item, { showDate: true })).join('');
    this.bindHistoryItemClicks(browserGrid, this.historyItems);

    const hasMore = sortedItems.length > visibleItems.length;
    browserActions?.classList.toggle('hidden', !hasMore);
    if (moreBtn) {
      moreBtn.textContent = hasMore
        ? `Show More (${sortedItems.length - visibleItems.length} remaining)`
        : 'Show More';
    }
    const browserEmpty = document.getElementById('history-browser-empty');
    if (browserEmpty) {
      const isEmpty = sortedItems.length === 0;
      browserEmpty.classList.toggle('hidden', !isEmpty);
      if (isEmpty && this.historyFavoritesOnly) {
        browserEmpty.innerHTML = '<h3>No favorites yet</h3><p>Star comics to quickly find them here.</p>';
      } else if (isEmpty) {
        browserEmpty.innerHTML = '<h3>No comics in My Collection yet</h3><p>Generate your first comic to populate the browser.</p>';
      }
    }
  }

  showMoreHistory() {
    this.historyBrowserLimit += 12;
    this.renderHistoryBrowser();
  }

  async persistHistoryBrowserPrefs() {
    try {
      const { sidepanelPrefs } = await chrome.storage.local.get('sidepanelPrefs');
      await chrome.storage.local.set({
        sidepanelPrefs: {
          ...(sidepanelPrefs || {}),
          historyFavoritesOnly: !!this.historyFavoritesOnly,
          historySortMode: this.historySortMode || 'manual'
        }
      });
    } catch (_) {
      void this.appendDebugLog('history.browser.prefs.persist.error', {});
    }
  }

  getProcessedHistoryItems() {
    const base = Array.isArray(this.historyItems) ? this.historyItems.slice() : [];
    const filtered = this.historyFavoritesOnly
      ? base.filter((item) => !!item?.favorite)
      : base;
    const mode = String(this.historySortMode || 'manual');
    if (mode === 'manual') return filtered;
    const sorted = filtered.slice().sort((a, b) => {
      if (mode === 'title-asc' || mode === 'title-desc') {
        const titleA = String(this.getHistorySourceInfo(a).title || '').toLowerCase();
        const titleB = String(this.getHistorySourceInfo(b).title || '').toLowerCase();
        const cmp = titleA.localeCompare(titleB, undefined, { sensitivity: 'base' });
        return mode === 'title-asc' ? cmp : -cmp;
      }
      const timeA = new Date(a?.generated_at || 0).getTime() || 0;
      const timeB = new Date(b?.generated_at || 0).getTime() || 0;
      return mode === 'date-asc' ? (timeA - timeB) : (timeB - timeA);
    });
    return sorted;
  }

  updateHistoryBrowserControls() {
    const favoritesBtn = document.getElementById('history-filter-favorites-btn');
    const titleBtn = document.getElementById('history-sort-title-btn');
    const dateBtn = document.getElementById('history-sort-date-btn');
    const sortMode = String(this.historySortMode || 'manual');

    if (favoritesBtn) {
      const enabled = !!this.historyFavoritesOnly;
      favoritesBtn.classList.toggle('is-active', enabled);
      favoritesBtn.classList.toggle('is-favorites-active', enabled);
      favoritesBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      favoritesBtn.title = enabled ? 'Showing favorites only' : 'Show favorites only';
      const icon = favoritesBtn.querySelector('.history-control-icon');
      if (icon) icon.textContent = enabled ? '★' : '☆';
    }

    if (titleBtn) {
      const active = sortMode === 'title-asc' || sortMode === 'title-desc';
      titleBtn.classList.toggle('is-active', active);
      titleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      const icon = titleBtn.querySelector('.history-control-icon');
      if (icon) icon.textContent = sortMode === 'title-desc' ? 'Z↕A' : 'A↕Z';
      titleBtn.title = sortMode === 'title-desc' ? 'Sort by title (Z-A)' : 'Sort by title (A-Z)';
    }

    if (dateBtn) {
      const active = sortMode === 'date-asc' || sortMode === 'date-desc';
      dateBtn.classList.toggle('is-active', active);
      dateBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      const icon = dateBtn.querySelector('.history-control-icon');
      if (icon) icon.textContent = sortMode === 'date-asc' ? '🕑' : '🕒';
      dateBtn.title = sortMode === 'date-asc' ? 'Sort by date (oldest first)' : 'Sort by date (newest first)';
    }
  }

  toggleHistoryFavoritesOnly() {
    this.historyFavoritesOnly = !this.historyFavoritesOnly;
    this.historyBrowserLimit = 12;
    this.updateHistoryBrowserControls();
    this.renderHistoryBrowser();
    void this.persistHistoryBrowserPrefs();
  }

  toggleHistorySortMode(kind) {
    const normalized = String(kind || '').trim();
    if (normalized === 'title') {
      this.historySortMode = this.historySortMode === 'title-asc' ? 'title-desc' : 'title-asc';
    } else if (normalized === 'date') {
      this.historySortMode = this.historySortMode === 'date-desc' ? 'date-asc' : 'date-desc';
    } else {
      return;
    }
    this.historyBrowserLimit = 12;
    this.updateHistoryBrowserControls();
    this.renderHistoryBrowser();
    void this.persistHistoryBrowserPrefs();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const viewer = new ComicViewer();
  try {
    window.__sidepanelViewer = viewer;
  } catch (_) {}
});
