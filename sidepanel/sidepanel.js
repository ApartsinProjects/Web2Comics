class ComicViewer {
  constructor() {
    this.layoutPresets = {
      'classic-strip': { mode: 'strip', displayClass: 'preset-classic-strip', generationClass: 'preset-classic-strip' },
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
    this.currentComic = null;
    this.viewMode = 'strip';
    this.layoutPreset = 'classic-strip';
    this.primaryView = 'comic';
    this.carouselIndex = 0;
    this.historyItems = [];
    this.historyBrowserLimit = 12;
    this.generationStartedAtMs = 0;
    this.generationFirstPanelAtMs = 0;
    this.init();
  }

  async init() {
    await this.loadPrefs();
    await this.loadCurrentJob();
    this.bindEvents();
    this.syncLayoutPresetUI();
    this.applyLayoutPreset();
    await this.loadHistory();
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

  async loadPrefs() {
    const { sidepanelPrefs } = await chrome.storage.local.get('sidepanelPrefs');
    const preset = sidepanelPrefs?.layoutPreset;
    if (preset && this.layoutPresets[preset]) {
      this.layoutPreset = preset;
      this.viewMode = this.layoutPresets[preset].mode;
    }
  }

  async loadCurrentJob() {
    const { currentJob } = await chrome.storage.local.get('currentJob');
    
    if (currentJob) {
      if (currentJob.status === 'completed') {
        this.displayComic(currentJob.storyboard);
      } else if (currentJob.status === 'generating_text' || currentJob.status === 'generating_images') {
        this.showGenerationView(currentJob);
        this.startPolling();
      }
    }
  }

  bindEvents() {
    document.getElementById('mode-comic-btn')?.addEventListener('click', () => this.setPrimaryView('comic'));
    document.getElementById('mode-history-btn')?.addEventListener('click', () => this.setPrimaryView('history'));
    document.querySelector('.header-mode-toggle')?.addEventListener('keydown', (e) => this.onHeaderModeKeydown(e));
    document.getElementById('new-comic-btn')?.addEventListener('click', () => this.openPopup());
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
    generationView.classList.remove('layout-strip', 'layout-panels', 'layout-carousel', ...this.getLayoutPresetClasses());
    if (this.viewMode === 'panels') {
      generationView.classList.add('layout-panels');
    } else if (this.viewMode === 'carousel') {
      generationView.classList.add('layout-carousel');
    } else {
      generationView.classList.add('layout-strip');
    }
    const presetClass = this.layoutPresets[this.layoutPreset]?.generationClass;
    if (presetClass) generationView.classList.add(presetClass);
  }

  getLayoutPresetClasses() {
    return Array.from(new Set(Object.values(this.layoutPresets).flatMap((p) => [p.displayClass, p.generationClass]).filter(Boolean)));
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
    comicDisplay.classList.remove(...this.getLayoutPresetClasses());
    const presetClass = this.layoutPresets[this.layoutPreset]?.displayClass;
    if (presetClass) comicDisplay.classList.add(presetClass);
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
      const safeCaption = this.escapeHtml(panel.caption || '');
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
      alert(lines.join('\n\n') || 'No prompt details available.');
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
      parts.push(panel.caption || '');
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
      generating_images: 'Creating Comic Panels'
    };
    
    document.getElementById('gen-status-title').textContent = statusTitles[job.status] || 'Processing...';
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

      const safeCaption = this.escapeHtml(panel?.caption || `Panel ${index + 1}`);
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
    const poll = setInterval(async () => {
      const { currentJob } = await chrome.storage.local.get('currentJob');
      
      if (!currentJob || currentJob.status === 'completed' || currentJob.status === 'failed' || currentJob.status === 'canceled') {
        clearInterval(poll);
        
        if (currentJob?.status === 'completed') {
          this.generationStartedAtMs = 0;
          this.generationFirstPanelAtMs = 0;
          this.displayComic(currentJob.storyboard);
          await this.loadHistory();
        } else {
          this.generationStartedAtMs = 0;
          this.generationFirstPanelAtMs = 0;
          document.getElementById('generation-view').classList.add('hidden');
          document.getElementById('empty-state').classList.remove('hidden');
        }
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

  async exportComicAsCompositeImage() {
    const comic = this.currentComic;
    if (!comic?.panels?.length) throw new Error('No comic panels to export');

    const panels = comic.panels;
    const sourceTitle = comic?.source?.title || 'Untitled Comic';
    const sourceUrl = comic?.source?.url || '';
    const siteName = this.getShortSourceName(sourceUrl);

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

    const textAreaW = layout.width - (layout.margin * 2) - layout.panelThumbW - (layout.panelGap + layout.rowPad * 2);
    const lineHeight = 22;
    const titleHeight = 34;
    const urlLineHeight = 18;
    const rowMinHeight = layout.panelThumbH + layout.rowPad * 2;

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

    ctx.font = '600 16px system-ui, -apple-system, Segoe UI, sans-serif';
    const rowHeights = panels.map((panel, index) => {
      const caption = panel?.caption || `Panel ${index + 1}`;
      const prefix = `Panel ${index + 1}: `;
      const lines = this.wrapCanvasText(ctx, prefix + caption, textAreaW);
      const textHeight = 28 + (lines.length * lineHeight);
      return Math.max(rowMinHeight, textHeight + layout.rowPad * 2);
    });

    const headerHeight = 108;
    const footerHeight = 36;
    const bodyHeight = rowHeights.reduce((sum, h) => sum + h, 0) + ((panels.length - 1) * layout.rowGap);
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

    // Panel rows
    let y = cardY + headerHeight + 18;
    for (let i = 0; i < panels.length; i++) {
      const rowH = rowHeights[i];
      const rowX = layout.margin;
      const rowW = cardW;

      ctx.fillStyle = '#ffffff';
      this.drawRoundedRect(ctx, rowX, y, rowW, rowH, 14);
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      this.drawRoundedRect(ctx, rowX, y, rowW, rowH, 14);
      ctx.stroke();

      // Thumb frame
      const thumbX = rowX + layout.rowPad;
      const thumbY = y + layout.rowPad;
      ctx.fillStyle = '#f1f5f9';
      this.drawRoundedRect(ctx, thumbX, thumbY, layout.panelThumbW, layout.panelThumbH, 10);
      ctx.fill();

      const thumb = loadedThumbs[i];
      if (thumb) {
        const srcAspect = thumb.width / thumb.height;
        const dstAspect = layout.panelThumbW / layout.panelThumbH;
        let sx = 0, sy = 0, sw = thumb.width, sh = thumb.height;
        if (srcAspect > dstAspect) {
          sw = thumb.height * dstAspect;
          sx = (thumb.width - sw) / 2;
        } else {
          sh = thumb.width / dstAspect;
          sy = (thumb.height - sh) / 2;
        }
        ctx.save();
        this.drawRoundedRect(ctx, thumbX, thumbY, layout.panelThumbW, layout.panelThumbH, 10);
        ctx.clip();
        ctx.drawImage(thumb, sx, sy, sw, sh, thumbX, thumbY, layout.panelThumbW, layout.panelThumbH);
        ctx.restore();
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px system-ui, -apple-system, Segoe UI, sans-serif';
        ctx.fillText('No image', thumbX + 12, thumbY + 24);
      }

      const textX = thumbX + layout.panelThumbW + layout.panelGap;
      const textY = y + layout.rowPad + 24;
      const caption = panels[i]?.caption || '';
      const label = `Panel ${i + 1}`;

      ctx.fillStyle = '#64748b';
      ctx.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillText(label, textX, textY - 6);

      ctx.fillStyle = '#0f172a';
      ctx.font = '600 16px system-ui, -apple-system, Segoe UI, sans-serif';
      const lines = this.wrapCanvasText(ctx, caption || '(No caption)', textAreaW);
      lines.slice(0, 7).forEach((line, lineIndex) => {
        ctx.fillText(line, textX, textY + (lineIndex * lineHeight) + 16);
      });

      y += rowH + layout.rowGap;
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
      alert('Failed to export comic as a single image.');
    }
  }

  async cancelGeneration() {
    await chrome.runtime.sendMessage({ type: 'CANCEL_GENERATION' });
    document.getElementById('generation-view').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
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
      </div>
    `;
  }

  bindHistoryItemClicks(container, history) {
    container.querySelectorAll('.history-item').forEach(el => {
      const openItem = async () => {
        const item = history.find(h => h.id === el.dataset.id);
        if (item) {
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
  new ComicViewer();
});
