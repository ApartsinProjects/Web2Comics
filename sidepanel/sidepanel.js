class ComicViewer {
  constructor() {
    this.layoutPresets = {
      'single-panel-full': { mode: 'panels', displayClass: 'preset-poster-grid', generationClass: 'preset-poster-grid' },
      'split-2-vertical': { mode: 'panels', displayClass: 'preset-storyboard-grid', generationClass: 'preset-storyboard-grid' },
      'split-2-horizontal': { mode: 'strip', displayClass: 'preset-wide-strip', generationClass: 'preset-wide-strip' },
      'classic-strip': { mode: 'strip', displayClass: 'preset-classic-strip', generationClass: 'preset-classic-strip' }, // 3-panel strip (Horizontal)
      'stack-3-vertical': { mode: 'panels', displayClass: 'preset-storyboard-grid', generationClass: 'preset-storyboard-grid' },
      'grid-4': { mode: 'panels', displayClass: 'preset-storyboard-grid', generationClass: 'preset-storyboard-grid' },
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
    this.viewMode = 'strip';
    this.layoutPreset = 'classic-strip';
    this.primaryView = 'comic';
    this.carouselIndex = 0;
    this.historyItems = [];
    this.historyBrowserLimit = 12;
    this.generationStartedAtMs = 0;
    this.generationFirstPanelAtMs = 0;
    this.pollTimer = null;
    this.lastTerminalJobNoticeKey = '';
    this.missingCaptionNoticeKeys = new Set();
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

  escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  getPanelCaptionText(panel, index) {
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
    if (caption) return caption;
    this.logMissingCaption(panel, index);
    return 'Panel ' + ((Number(index) || 0) + 1);
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

  async loadPrefs() {
    const { sidepanelPrefs } = await chrome.storage.local.get('sidepanelPrefs');
    const rawPreset = sidepanelPrefs?.layoutPreset;
    const preset = this.layoutPresetAliases[rawPreset] || rawPreset;
    if (preset && this.layoutPresets[preset]) {
      this.layoutPreset = preset;
      this.viewMode = this.layoutPresets[preset].mode;
    }
  }

  async loadCurrentJob() {
    const { currentJob } = await chrome.storage.local.get('currentJob');
    this.handleCurrentJobState(currentJob);
  }

  async tryDisplaySelectedHistoryComic() {
    try {
      const { selectedHistoryComicId, history } = await chrome.storage.local.get(['selectedHistoryComicId', 'history']);
      if (!selectedHistoryComicId) return false;
      const items = Array.isArray(history) ? history : this.historyItems;
      const item = (Array.isArray(items) ? items : []).find((h) => h && h.id === selectedHistoryComicId);
      if (!item?.storyboard) return false;
      this.displayComic(item.storyboard);
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
    document.getElementById('new-comic-btn')?.addEventListener('click', () => this.openPopup());
    document.getElementById('download-logs-sidepanel-btn')?.addEventListener('click', () => this.downloadDebugLogs());
    document.getElementById('download-btn')?.addEventListener('click', () => this.downloadComic());
    document.getElementById('open-popup-btn')?.addEventListener('click', () => this.openPopup());
    document.getElementById('cancel-gen-btn')?.addEventListener('click', () => this.cancelGeneration());
    document.getElementById('regenerate-btn')?.addEventListener('click', () => this.regenerate());
    document.getElementById('edit-storyboard-btn')?.addEventListener('click', () => this.editStoryboard());
    document.getElementById('carousel-prev-btn')?.addEventListener('click', () => this.showCarouselPanel(this.carouselIndex - 1));
    document.getElementById('carousel-next-btn')?.addEventListener('click', () => this.showCarouselPanel(this.carouselIndex + 1));
    document.getElementById('history-browser-more-btn')?.addEventListener('click', () => this.showMoreHistory());
    document.getElementById('layout-preset-select')?.addEventListener('change', (e) => this.setLayoutPreset(e.target.value));

    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.setViewMode(e.target.dataset.mode));
    });
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

  handleCurrentJobState(currentJob) {
    if (!currentJob) return;
    if (currentJob.status === 'completed') {
      this.generationStartedAtMs = 0;
      this.generationFirstPanelAtMs = 0;
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      if (this.viewMode === 'carousel' && currentJob.storyboard?.panels?.length > 1) {
        this.viewMode = 'strip';
      }
      this.displayComic(currentJob.storyboard);
      void this.loadHistory();
      return;
    }

    if (currentJob.status === 'generating_text' || currentJob.status === 'generating_images' || currentJob.status === 'pending') {
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
      return;
    }
  }

  getLayoutPresetClasses() {
    return Array.from(new Set(Object.values(this.layoutPresets).flatMap((p) => [p.displayClass, p.generationClass]).filter(Boolean)));
  }

  getPresetIdClass(presetId) {
    return 'preset-id-' + String(presetId || 'classic-strip').replace(/[^a-z0-9_-]/gi, '-');
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
    this.setViewMode(this.layoutPresets[presetId].mode, { preservePreset: true });
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
    sidebar?.classList.toggle('hidden', this.primaryView === 'history');

    document.querySelectorAll('.header-mode-btn').forEach((btn) => {
      const active = btn.dataset.view === this.primaryView;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    // Download only applies to the Single Comic Strip View.
    const downloadBtn = document.getElementById('download-btn');
    if (downloadBtn) {
      downloadBtn.disabled = this.primaryView !== 'comic' || !this.currentComic;
    }
  }

  displayComic(storyboard) {
    this.currentComic = storyboard;
    this.setPrimaryView('comic');
    
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('generation-view').classList.add('hidden');
    document.getElementById('comic-display').classList.remove('hidden');
    
    document.getElementById('comic-title').textContent = storyboard.source.title || 'Untitled Comic';
    document.getElementById('comic-source').href = this.sanitizeExternalUrl(storyboard.source.url);
    
    this.renderPanels(storyboard.panels);
    this.renderCarousel(storyboard.panels);
    // Re-apply the current view mode so persisted layout presets restore the visible shell on load.
    this.setViewMode(this.viewMode, { preservePreset: true });
    
    document.getElementById('download-btn').disabled = false;
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
      return `
      <div class="panel">
        <div class="panel-image">
          ${panel.artifacts?.image_blob_ref 
            ? `<img src="${panel.artifacts.image_blob_ref}" alt="Panel ${index + 1}">`
            : `<svg width="64" height="64" fill="var(--text-muted)"><rect x="8" y="8" width="48" height="48" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M24 32h16M32 24v16" stroke="currentColor" stroke-width="2"/></svg>`
          }
        </div>
        <div class="panel-caption">
          <div class="panel-number">Panel ${index + 1}</div>
          ${showBadge ? '<div class="panel-badge panel-badge-rewritten">Rewritten</div>' : ''}
          ${refusalHandling?.blockedPlaceholder ? '<div class="panel-badge panel-badge-blocked">Blocked</div>' : ''}
          <div>${safeCaption}</div>
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
        ${panel.artifacts?.image_blob_ref
          ? `<img src="${panel.artifacts.image_blob_ref}" alt="Panel ${index + 1}">`
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

    if (imageEl) {
      imageEl.innerHTML = panel.artifacts?.image_blob_ref
        ? `<img src="${panel.artifacts.image_blob_ref}" alt="Panel ${nextIndex + 1}">`
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

    const normalizedPanels = Array.from({ length: totalPanels || 0 }, (_, index) => {
      const panel = storyboardPanels[index] || null;
      const runtimeStatus = panel?.runtime_status || (job.status === 'generating_text' ? 'pending' : 'pending');
      let displayStatus = runtimeStatus;
      if (panel?.artifacts?.image_blob_ref) displayStatus = 'completed';
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

      const safeCaption = this.escapeHtml(this.getPanelCaptionText(panel, index));
      return `
        <div class="gen-panel ${isCurrent ? 'is-current' : ''}">
          <div class="gen-panel-thumb">
            ${panel?.artifacts?.image_blob_ref
              ? `<img src="${panel.artifacts.image_blob_ref}" alt="">`
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

  setViewMode(mode, options = {}) {
    this.viewMode = mode;
    
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    const strip = document.getElementById('comic-strip');
    const carousel = document.getElementById('comic-carousel');
    const panels = document.getElementById('comic-panels');
    const comicDisplay = document.getElementById('comic-display');
    comicDisplay?.classList.toggle('mode-carousel', mode === 'carousel');
    
    if (mode === 'strip') {
      strip.classList.remove('hidden');
      carousel.classList.add('hidden');
      panels.classList.add('hidden');
    } else if (mode === 'carousel') {
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
    if (!options.preservePreset) {
      this.syncLayoutPresetUI();
    }
  }

  openPopup() {
    chrome.action.openPopup();
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
    const preset = this.layoutPreset || 'classic-strip';
    const map = {
      'single-panel-full': { kind: 'single', name: 'single-panel-full' },
      'split-2-vertical': { kind: 'vertical-list', aspect: 16 / 9, name: preset },
      'split-2-horizontal': { kind: 'strip', columns: 2, aspect: 4 / 3, name: preset },
      'classic-strip': { kind: 'strip', columns: 3, aspect: 4 / 3, name: preset },
      'stack-3-vertical': { kind: 'vertical-list', aspect: 4 / 3, name: preset },
      'grid-4': { kind: 'grid', cols: 2, aspect: 4 / 3, name: preset },
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
      'carousel': { kind: 'spotlight', cinema: true, name: preset },
      'guided-path': { kind: 'grid', cols: 2, aspect: 4 / 3, guided: true, name: preset }
    };
    return map[preset] || { kind: 'strip', columns: 3, aspect: 4 / 3, name: preset };
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
    const label = `Panel ${opts.index + 1}`;
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
    ctx.fillStyle = '#64748b';
    ctx.font = compact
      ? '600 11px system-ui, -apple-system, Segoe UI, sans-serif'
      : '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(label, captionX, captionY + 12);

    ctx.fillStyle = '#0f172a';
    ctx.font = compact
      ? '600 13px system-ui, -apple-system, Segoe UI, sans-serif'
      : '600 14px system-ui, -apple-system, Segoe UI, sans-serif';
    const lines = this.wrapCanvasText(ctx, caption, captionW);
    lines.slice(0, compact ? 4 : 5).forEach((line, idx) => {
      ctx.fillText(line, captionX, captionY + 30 + (idx * lineHeight));
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

  async exportComicAsCompositeImage() {
    const comic = this.currentComic;
    if (!comic?.panels?.length) throw new Error('No comic panels to export');

    const panels = comic.panels;
    const sourceTitle = comic?.source?.title || 'Untitled Comic';
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
      if (!panel?.artifacts?.image_blob_ref) return null;
      try {
        return await this.loadImageElement(panel.artifacts.image_blob_ref);
      } catch {
        return null;
      }
    }));

    const headerHeight = 108;
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
      const cols = profile.kind === 'masonry' ? 2 : 2;
      const colW = Math.floor((contentW - gap * (cols - 1)) / cols);
      const colHeights = new Array(cols).fill(bodyTop);
      for (let i = 0; i < panels.length; i++) {
        const col = colHeights[0] <= colHeights[1] ? 0 : 1;
        const variant = profile.kind === 'masonry' ? (i % 3) : (i % 4);
        const imageAspect = profile.kind === 'masonry'
          ? ([1, 0.8, 1.25][variant] || 1)
          : ([1.2, 0.9, 1.1, 0.75][variant] || 1);
        const imageH = Math.max(120, Math.floor(colW / imageAspect));
        const cardH = imageH + (profile.kind === 'masonry' ? 64 : 78);
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

    ctx.fillStyle = '#475569';
    ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const urlLines = this.wrapCanvasText(ctx, sourceUrl, cardW - (layout.headerPad * 2));
    (urlLines.slice(0, 2)).forEach((line, i) => {
      ctx.fillText(line, cardX + layout.headerPad, cardY + 82 + (i * urlLineHeight));
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
    ctx.fillText('Generated by Web2Comics', layout.margin, canvas.height - layout.margin + 4);

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = this.sanitizeFilename(sourceTitle) + '-comic-sheet.png';
    link.click();
  }

  async downloadComic() {
    try {
      await this.exportComicAsCompositeImage();
    } catch (error) {
      console.error('Failed to export comic image:', error);
      void this.appendDebugLog('comic.export.error', { message: error?.message || String(error) });
      alert('Failed to export comic as a single image.');
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
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const withoutWww = hostname.replace(/^www\./, '');
      const parts = withoutWww.split('.');
      return parts.length > 1 ? parts[0] : withoutWww;
    } catch {
      return 'site';
    }
  }

  renderHistoryCard(item, options = {}) {
    const sourceUrl = item?.source?.url || '#';
    const safeSourceHref = this.sanitizeExternalUrl(sourceUrl);
    const shortName = this.getShortSourceName(sourceUrl);
    const sourceTitle = item?.source?.title || 'Untitled';
    const showDate = options.showDate !== false;
    const showOriginalLink = options.showOriginalLink !== false;
    let dateText = '';
    try {
      dateText = item?.generated_at ? new Date(item.generated_at).toLocaleDateString() : '';
    } catch {
      dateText = '';
    }
    const safeId = this.escapeHtml(item?.id || '');
    const safeShortName = this.escapeHtml(shortName);
    const safeSourceTitle = this.escapeHtml(sourceTitle);
    const safeDateText = this.escapeHtml(dateText);
    return `
      <div class="history-item" data-id="${safeId}" role="button" tabindex="0" aria-label="Open comic ${safeSourceTitle}">
        <div class="history-thumb">
          ${item.thumbnail ? `<img src="${item.thumbnail}" alt="">` : ''}
        </div>
        <div class="history-card-body">
          <div class="history-title" title="${safeSourceTitle}">${safeSourceTitle}</div>
          <div class="history-meta-row">
            <span class="history-source-chip">${safeShortName}</span>
            ${showOriginalLink ? `<a class="history-source-link" href="${safeSourceHref}" target="_blank" rel="noopener noreferrer">Original</a>` : ''}
          </div>
          ${showDate && dateText ? `<div class="history-date">${safeDateText}</div>` : ''}
        </div>
        <button type="button" class="history-item-delete-btn" data-action="delete-history-item" aria-label="Delete comic from history">Delete</button>
      </div>
    `;
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
          this.displayComic(item.storyboard);
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
        if (!confirm('Delete this comic from history?')) return;
        const deletedItem = this.historyItems.find((h) => h && h.id === itemId) || null;
        const nextHistory = this.historyItems.filter((h) => h && h.id !== itemId);
        const payload = { history: nextHistory };
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

    container.querySelectorAll('.history-source-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    });
  }

  async loadHistory() {
    const { history } = await chrome.storage.local.get('history');
    this.historyItems = Array.isArray(history) ? history : [];
    this.historyBrowserLimit = 12;
    const container = document.getElementById('history-list');
    const browserGrid = document.getElementById('history-browser-grid');
    const browserEmpty = document.getElementById('history-browser-empty');
    const browserActions = document.getElementById('history-browser-actions');
    
    if (!this.historyItems.length) {
      container.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">No history</p>';
      if (browserGrid) browserGrid.innerHTML = '';
      if (browserEmpty) browserEmpty.classList.remove('hidden');
      if (browserActions) browserActions.classList.add('hidden');
      return;
    }
    if (browserEmpty) browserEmpty.classList.add('hidden');
    
    const sidebarItems = this.historyItems.slice(0, 8);
    container.innerHTML = sidebarItems.map((item) => this.renderHistoryCard(item, { showDate: false })).join('');
    this.bindHistoryItemClicks(container, this.historyItems);

    this.renderHistoryBrowser();
    if (!this.currentComic) {
      void this.tryDisplaySelectedHistoryComic();
    }
  }

  renderHistoryBrowser() {
    const browserGrid = document.getElementById('history-browser-grid');
    const browserActions = document.getElementById('history-browser-actions');
    const moreBtn = document.getElementById('history-browser-more-btn');
    if (!browserGrid) return;

    const visibleItems = this.historyItems.slice(0, this.historyBrowserLimit);
    browserGrid.innerHTML = visibleItems.map((item) => this.renderHistoryCard(item, { showDate: true })).join('');
    this.bindHistoryItemClicks(browserGrid, this.historyItems);

    const hasMore = this.historyItems.length > visibleItems.length;
    browserActions?.classList.toggle('hidden', !hasMore);
    if (moreBtn) {
      moreBtn.textContent = hasMore
        ? `Show More (${this.historyItems.length - visibleItems.length} remaining)`
        : 'Show More';
    }
  }

  showMoreHistory() {
    this.historyBrowserLimit += 12;
    this.renderHistoryBrowser();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const viewer = new ComicViewer();
  try {
    window.__sidepanelViewer = viewer;
  } catch (_) {}
});
