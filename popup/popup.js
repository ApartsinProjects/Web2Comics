// Keep runtime defaults local to avoid importing shared/types.js, which currently contains
// TypeScript-only declarations and is not executable as a browser module.
const DEFAULT_SETTINGS = {
  panelCount: 3,
  objective: 'explain-like-im-five',
  detailLevel: 'low',
  styleId: 'default',
  customStyleTheme: '',
  customStyleName: '',
  captionLength: 'short',
  outputLanguage: 'en',
  activeTextProvider: 'gemini-free',
  activeImageProvider: 'gemini-free',
  textModel: 'gpt-4o-mini',
  imageModel: 'dall-e-2',
  geminiTextModel: 'gemini-2.5-flash',
  geminiImageModel: 'gemini-2.0-flash-exp-image-generation',
  cloudflareTextModel: '@cf/meta/llama-3.1-8b-instruct',
  cloudflareImageModel: '@cf/black-forest-labs/flux-1-schnell',
  openrouterTextModel: 'openai/gpt-oss-20b:free',
  openrouterImageModel: 'google/gemini-2.5-flash-image-preview',
  openrouterImageSize: '1K',
  huggingfaceTextModel: 'mistralai/Mistral-7B-Instruct-v0.2',
  huggingfaceImageModel: 'black-forest-labs/FLUX.1-schnell',
  huggingfaceImageSize: '512x512',
  huggingfaceImageQuality: 'fastest',
  openaiImageQuality: 'standard',
  openaiImageSize: '256x256',
  characterConsistency: false,
  debugFlag: false,
  imageRefusalHandling: 'rewrite_and_retry',
  showRewrittenBadge: true,
  logRewrittenPrompts: false,
  maxCacheSize: 100,
  autoOpenSidePanel: true
};

const CREATE_NEW_STYLE_VALUE = '__create_new_style__';
const USER_STYLE_PREFIX = 'user:';
const IMAGE_CAPABLE_PROVIDERS = new Set(['openai', 'gemini-free', 'cloudflare-free', 'huggingface', 'openrouter']);
const PROVIDER_LABELS = {
  'gemini-free': 'Gemini',
  'openai': 'OpenAI',
  'cloudflare-free': 'Cloudflare',
  'openrouter': 'OpenRouter',
  'huggingface': 'Hugging Face'
};
const SUPPORTED_OUTPUT_LANGUAGES = new Set(['en', 'auto', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh']);

function mapRecommendedSettingsPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  if (payload.settings && typeof payload.settings === 'object') return payload.settings;
  const providers = payload.providers || {};
  return {
    textModel: providers.openai?.text,
    imageModel: providers.openai?.image,
    geminiTextModel: providers.gemini?.text,
    geminiImageModel: providers.gemini?.image,
    cloudflareTextModel: providers.cloudflare?.text,
    cloudflareImageModel: providers.cloudflare?.image,
    openrouterTextModel: providers.openrouter?.text,
    openrouterImageModel: providers.openrouter?.image,
    huggingfaceTextModel: providers.huggingface?.text,
    huggingfaceImageModel: providers.huggingface?.image
  };
}

function getProviderDisplayLabel(providerId) {
  return PROVIDER_LABELS[String(providerId || '')] || String(providerId || 'provider');
}

class PopupController {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.customStyles = [];
    this.extractedText = '';
    this.isGenerating = false;
    this.currentJobId = null;
    this.advancedSettingsExpanded = false;
    this.providerIsReady = null;
    this.hasAnyConfiguredProviders = false;
    this.lastWizardReadiness = {
      contentReady: false,
      settingsReady: false,
      canGenerate: false,
      issues: []
    };
    this.extractRetryTimer = null;
    this.extractRetryCount = 0;
    this.extractFallbackTried = false;
    this.progressStartedAtMs = 0;
    this.progressFirstPanelAtMs = 0;
    this.cancelRequestedByUser = false;
    this.extractionCandidates = [];
    this.selectedExtractionCandidateId = '';
    this.selectionFallbackActive = false;
    this.userCollapsedContent = false;
    this.userCollapsedOptions = false;
    this.autoExpandedContentOnce = false;
    this.autoExpandedOptionsOnce = false;
    this.suppressExtraIntentTracking = false;
    this.lastReadinessState = null;
    this.lastOptionsOpenTs = 0;
    this.extractionQuality = null;
    this.selectedCandidateSummary = '';
    this.selectedCandidateScore = 0;
    this.selectedStoryTitle = '';
    this.storySelectionLockedByUser = false;
    this.storyPreviewCache = {};
    this.extractRequestSeq = 0;
    this.storyDetectionInFlight = 0;
    this.currentPageUrl = '';
    this.currentSiteProfile = 'generic';
    this.hasCompletedFirstGeneration = false;
    this.composerMode = 'page';
    this.manualStoryText = '';
    
    this.init();
  }

  async appendDebugLog(event, data) {
    try {
      const verboseTestLogs = Boolean(globalThis && globalThis.__WEB2COMICS_TEST_LOGS__);
      if (!this.settings.debugFlag && !verboseTestLogs) return;
      const entry = {
        ts: new Date().toISOString(),
        scope: 'popup',
        event: event,
        jobId: this.currentJobId || null,
        data: data || null
      };
      if (verboseTestLogs) {
        try { console.info('[Web2Comics:test][popup]', event, data || null); } catch (_) {}
      }
      const { debugLogs } = await chrome.storage.local.get('debugLogs');
      const logs = Array.isArray(debugLogs) ? debugLogs : [];
      logs.push(entry);
      if (logs.length > 500) logs.splice(0, logs.length - 500);
      await chrome.storage.local.set({ debugLogs: logs });
    } catch (e) {
      console.error('Failed to append debug log:', e);
    }
  }

  escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async init() {
    this.renderExtensionVersion();
    await this.loadRecommendedDefaults();
    await this.loadSettings();
    await this.loadManualStoryDraft();
    await this.loadCustomStyles();
    await this.loadFirstSuccessState();
    await this.checkOnboarding();
    this.bindEvents();
    const consumedContextSelection = await this.consumePendingComposerPrefill();
    if (!consumedContextSelection) {
      void this.extractContent().catch((error) => {
        console.error('Initial extraction failed:', error);
      });
    }
    this.updateUI();
  }

  renderExtensionVersion() {
    try {
      const version = String(chrome?.runtime?.getManifest?.().version || '').trim();
      if (!version) return;
      const label = document.getElementById('popup-version-label');
      if (label) label.textContent = `v${version}`;
    } catch (_) {}
  }

  async consumePendingComposerPrefill() {
    try {
      const stored = await chrome.storage.local.get('pendingComposerPrefill');
      const payload = stored && stored.pendingComposerPrefill ? stored.pendingComposerPrefill : null;
      if (!payload || typeof payload !== 'object') return false;
      const selectedText = String(payload.text || '').trim();
      await chrome.storage.local.remove('pendingComposerPrefill');
      if (!selectedText) return false;

      this.currentPageUrl = String(payload.sourceUrl || this.currentPageUrl || '');
      this.currentSiteProfile = this.classifySiteProfile(this.currentPageUrl);
      this.updateSiteProfileHint();
      this.setComposerMode('page');
      this.setSelectedContentSource('selection');
      this.storySelectionLockedByUser = true;
      this.selectionFallbackActive = false;
      this.extractFallbackTried = true;
      this.extractedText = selectedText;
      this.extractionCandidates = [];
      this.selectedExtractionCandidateId = '';
      this.selectedCandidateSummary = '';
      this.selectedCandidateScore = 0;
      this.selectedStoryTitle = '';
      this.extractionQuality = {
        confidence: 'high',
        score: 0.96,
        reason: 'User-selected text from context menu'
      };
      this.updateCandidateSelector();
      this.updatePreview(selectedText);
      this.showCreateComposer();
      void this.appendDebugLog('content.prefill.context_menu_selection', {
        chars: selectedText.length,
        source: payload.source || 'context-menu-selection'
      });
      return true;
    } catch (error) {
      console.error('Failed to consume pending composer prefill:', error);
      return false;
    }
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

  async loadFirstSuccessState() {
    try {
      const stored = await chrome.storage.local.get('firstSuccessfulGenerationAt');
      this.hasCompletedFirstGeneration = !!stored.firstSuccessfulGenerationAt;
    } catch (_) {
      this.hasCompletedFirstGeneration = false;
    }
  }

  async loadRecommendedDefaults() {
    try {
      if (typeof fetch !== 'function' || !chrome?.runtime?.getURL) return;
      const url = chrome.runtime.getURL('shared/recommended-model-set.local.json');
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      const recommendedSettings = mapRecommendedSettingsPayload(json);
      if (!recommendedSettings || typeof recommendedSettings !== 'object') return;
      this.settings = { ...DEFAULT_SETTINGS, ...recommendedSettings };
    } catch (_) {
      // Optional local file. Ignore if missing/unreadable.
    }
  }

  async loadSettings() {
    try {
      const stored = await chrome.storage.local.get(['settings', 'providers']);
      if (stored.settings) {
        this.settings = { ...this.settings, ...stored.settings };
      }
      this.settings.outputLanguage = this.normalizeOutputLanguage(this.settings.outputLanguage);
      void this.appendDebugLog('settings.loaded', {
        provider: this.settings.activeTextProvider,
        debugFlag: !!this.settings.debugFlag
      });
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  async loadCustomStyles() {
    try {
      const { customStyles } = await chrome.storage.local.get('customStyles');
      this.customStyles = Array.isArray(customStyles) ? customStyles : [];
    } catch (error) {
      console.error('Failed to load custom styles:', error);
      this.customStyles = [];
    }
  }

  async checkOnboarding() {
    const onboardingSection = document.getElementById('onboarding-section');
    const homeSection = document.getElementById('home-section');
    const mainSection = document.getElementById('main-section');

    // Onboarding/welcome panel removed: always start at the launcher.
    onboardingSection?.classList.add('hidden');
    homeSection?.classList.remove('hidden');
    mainSection?.classList.add('hidden');
  }

  normalizeOutputLanguage(value) {
    const candidate = String(value || '').trim();
    if (SUPPORTED_OUTPUT_LANGUAGES.has(candidate)) return candidate;
    return 'en';
  }

  classifySiteProfile(url) {
    const value = String(url || '').toLowerCase();
    if (!value) return 'generic';
    if (/wikipedia\.org\/wiki\//.test(value)) return 'wikipedia';
    if (/(cnn\.com|bbc\.com|apnews\.com|reuters\.com|npr\.org|nytimes\.com|wsj\.com|theguardian\.com)/.test(value)) return 'news';
    if (/(facebook\.com|x\.com|twitter\.com|reddit\.com|linkedin\.com)/.test(value)) return 'social';
    return 'generic';
  }

  updateSiteProfileHint() {
    const hint = document.getElementById('site-profile-hint');
    if (!hint) return;
    const profile = this.currentSiteProfile || 'generic';
    const messages = {
      wikipedia: 'Wikipedia mode is active: lead + key sections are prioritized for better story detection.',
      news: 'News mode is active: narrative article body is prioritized over side rails and navigation.',
      social: 'Social mode is active: likely post bodies are prioritized and UI chrome is filtered.',
      generic: 'General mode is active: auto-scoring ranks high-signal text blocks before generation.'
    };
    hint.textContent = messages[profile] || messages.generic;
    hint.classList.remove('hidden');
  }

  updateFirstRunVisibility() {
    const optionsSection = document.getElementById('options-extra-section');
    const advancedToggle = document.getElementById('advanced-settings-toggle');
    if (!optionsSection || !advancedToggle) return;
    const isFirstRun = !this.hasCompletedFirstGeneration;
    optionsSection.classList.toggle('hidden', isFirstRun);
    if (isFirstRun) this.setAdvancedSettingsExpanded(false);
  }

  getCandidateIndexFromId(candidateId) {
    const id = String(candidateId || '');
    if (!id) return -1;
    const candidates = Array.isArray(this.extractionCandidates) ? this.extractionCandidates : [];
    const exactIndex = candidates.findIndex((candidate) => String(candidate?.id || '') === id);
    if (exactIndex >= 0) return exactIndex;
    if (!/^candidate_\d+$/i.test(id)) return -1;
    const idx = Number(id.replace('candidate_', ''));
    return Number.isInteger(idx) ? idx : -1;
  }

  getSelectedCandidateOption() {
    const idx = this.getCandidateIndexFromId(this.selectedExtractionCandidateId);
    if (idx < 0 || !Array.isArray(this.extractionCandidates)) return null;
    return this.extractionCandidates[idx] || null;
  }

  updateStoryFlowHint() {
    const hintEl = document.getElementById('story-flow-hint');
    if (!hintEl) return;
    if (this.isManualComposerMode()) {
      hintEl.classList.add('hidden');
      hintEl.textContent = '';
      return;
    }

    const mode = this.getSelectedContentSource();
    if (!this.extractedText || !String(this.extractedText).trim()) {
      hintEl.classList.add('hidden');
      hintEl.textContent = '';
      return;
    }

    if (mode === 'selection') {
      hintEl.textContent = 'Using highlighted text from page selection.';
      hintEl.classList.remove('hidden');
      return;
    }

    const candidates = Array.isArray(this.extractionCandidates) ? this.extractionCandidates : [];
    const selected = this.getSelectedCandidateOption();
    if (!candidates.length || !selected) {
      hintEl.textContent = 'Scanning page for top stories...';
      hintEl.classList.remove('hidden');
      return;
    }

    const summary = this.getCandidateDisplaySummary(selected);
    const selectedLabel = this.storySelectionLockedByUser ? 'Selected story' : 'Auto-selected top story';
    const summaryMethod = String(selected.summaryMethod || selected.summary_method || '');
    const summarizerNote = summaryMethod === 'chrome-summarizer'
      ? ' (Chrome Summarizer)'
      : '';
    hintEl.textContent = `${selectedLabel}${summarizerNote}: ${summary}`;
    hintEl.classList.remove('hidden');
  }

  setStoryDetectionProgress(active, message) {
    const shell = document.getElementById('story-detection-progress');
    const textEl = document.getElementById('story-detection-progress-text');
    const subtextEl = document.getElementById('story-detection-progress-subtext');
    const emojiEl = shell ? shell.querySelector('.story-detection-emoji') : null;
    if (!shell || !textEl) return;
    if (active) {
      textEl.textContent = String(message || 'Detecting top stories on page...');
      if (subtextEl) {
        const msg = String(message || '').toLowerCase();
        if (msg.includes('refining') || msg.includes('retry')) {
          subtextEl.textContent = 'Tightening relevance and isolating the cleanest narrative...';
          if (emojiEl) emojiEl.textContent = '🧭';
        } else {
          subtextEl.textContent = 'Scanning sections and ranking the clearest story...';
          if (emojiEl) emojiEl.textContent = '🔎';
        }
      }
      shell.classList.remove('hidden');
    } else {
      shell.classList.add('hidden');
    }
  }

  async loadManualStoryDraft() {
    try {
      const stored = await chrome.storage.local.get('manualStoryDraft');
      this.manualStoryText = String(stored?.manualStoryDraft || '');
    } catch (_) {
      this.manualStoryText = '';
    }
  }

  async saveManualStoryDraft() {
    try {
      await chrome.storage.local.set({ manualStoryDraft: this.manualStoryText || '' });
    } catch (_) {}
  }

  beginStoryDetectionProgress(isRetry) {
    this.storyDetectionInFlight += 1;
    const message = isRetry
      ? 'Refining story detection...'
      : 'Detecting top stories on page...';
    this.setStoryDetectionProgress(true, message);
    this.updateWizardReadiness();
  }

  endStoryDetectionProgress() {
    this.storyDetectionInFlight = Math.max(0, Number(this.storyDetectionInFlight || 0) - 1);
    if (this.storyDetectionInFlight === 0) {
      this.setStoryDetectionProgress(false);
    }
    this.updateWizardReadiness();
  }

  evaluateGroundingConfidence() {
    const quality = this.extractionQuality || {};
    const option = this.getSelectedCandidateOption();
    const score = Number(option?.score || this.selectedCandidateScore || 0);
    const words = Number(quality.words || 0);
    const boilerplate = Number(quality.boilerplateHits || 0);
    const uniqueRatio = Number(quality.uniqueRatio || 0);
    const shortLines = Number(quality.shortLineRatio || 1);
    const pass = !!quality.pass;

    if (pass && words >= 180 && score >= 120 && uniqueRatio >= 0.22 && shortLines <= 0.55 && boilerplate <= 6) {
      return { level: 'high', text: 'Story detection confidence is high. The selected story looks clear and specific.' };
    }
    if (pass && words >= 90 && score >= 60 && shortLines <= 0.8 && boilerplate <= 12) {
      return { level: 'medium', text: 'Story detection confidence is medium. Generate now, or pick a tighter story.' };
    }
    return { level: 'low', text: 'Story detection confidence is low. Auto-pick a tighter section before generating.' };
  }

  updateQualityConfidenceUI() {
    const shell = document.getElementById('quality-confidence');
    const badge = document.getElementById('quality-confidence-badge');
    const levelEl = document.getElementById('quality-confidence-level');
    const text = document.getElementById('quality-confidence-text');
    const storyPickerBtn = document.getElementById('story-picker-btn');
    if (!shell || !badge || !text || !levelEl) return;
    if (this.isManualComposerMode()) {
      shell.classList.add('hidden');
      if (storyPickerBtn) storyPickerBtn.classList.add('hidden');
      return;
    }
    if (!this.extractedText) {
      shell.classList.add('hidden');
      if (storyPickerBtn) storyPickerBtn.classList.add('hidden');
      this.updateStoryFlowHint();
      return;
    }
    const confidence = this.evaluateGroundingConfidence();
    badge.classList.remove('high', 'medium', 'low');
    badge.classList.add(confidence.level);
    badge.textContent = '';
    badge.setAttribute('aria-label', 'Story detection confidence ' + confidence.level);
    badge.setAttribute('title', 'Story detection confidence ' + confidence.level);
    levelEl.classList.remove('high', 'medium', 'low');
    levelEl.classList.add(confidence.level);
    levelEl.textContent = confidence.level === 'high'
      ? 'High'
      : confidence.level === 'medium'
        ? 'Medium'
        : 'Low';
    text.textContent = confidence.text;
    shell.classList.remove('hidden');

    if (storyPickerBtn) {
      const canPickStory = this.getSelectedContentSource() === 'full' && Array.isArray(this.extractionCandidates) && this.extractionCandidates.length > 0;
      storyPickerBtn.classList.toggle('hidden', !canPickStory);
      storyPickerBtn.disabled = !canPickStory;
    }
    this.updateStoryFlowHint();
  }

  async autoPickBestStorySection() {
    const candidates = Array.isArray(this.extractionCandidates) ? this.extractionCandidates : [];
    if (!candidates.length) return;
    this.storySelectionLockedByUser = true;
    let bestIndex = 0;
    let bestScore = Number(candidates[0]?.score || -Infinity);
    for (let i = 1; i < candidates.length; i++) {
      const score = Number(candidates[i]?.score || -Infinity);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    const candidateId = String(candidates[bestIndex]?.id || '');
    if (!candidateId) return;
    this.selectedExtractionCandidateId = candidateId;
    const select = document.getElementById('content-candidate-select');
    if (select) select.value = candidateId;
    await this.extractContent({ selectedCandidateId: candidateId });
  }

  clearExtractRetry() {
    if (this.extractRetryTimer) {
      clearTimeout(this.extractRetryTimer);
      this.extractRetryTimer = null;
    }
  }

  scheduleExtractRetry(reason, delayMs = 1200) {
    if (this.extractRetryCount >= 6) return;
    this.clearExtractRetry();
    this.extractRetryCount += 1;
    void this.appendDebugLog('content.extract.retry_scheduled', {
      reason,
      attempt: this.extractRetryCount,
      delayMs
    });
    this.extractRetryTimer = setTimeout(() => {
      this.extractRetryTimer = null;
      this.extractContent({ isRetry: true });
    }, delayMs);
  }

  isManualComposerMode() {
    return this.composerMode === 'manual';
  }

  deriveManualStoryTitle(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return 'Custom Story';
    const sentence = normalized.split(/[.!?\n]/).find((line) => String(line || '').trim()) || normalized;
    return sentence.trim().slice(0, 80) || 'Custom Story';
  }

  updateManualStoryCount() {
    const countEl = document.getElementById('manual-story-char-count');
    if (countEl) countEl.textContent = String((this.manualStoryText || '').length.toLocaleString());
  }

  setComposerMode(mode) {
    const normalizedMode = mode === 'manual' ? 'manual' : 'page';
    const previousMode = this.composerMode;
    this.composerMode = normalizedMode;

    const manual = normalizedMode === 'manual';
    document.getElementById('manual-story-editor')?.classList.toggle('hidden', !manual);
    document.getElementById('site-profile-hint')?.classList.toggle('hidden', manual);
    document.querySelector('.content-source')?.classList.toggle('hidden', manual);
    document.getElementById('extracted-preview-block')?.classList.toggle('hidden', manual);
    document.getElementById('model-context-preview-block')?.classList.toggle('hidden', manual);
    document.getElementById('story-detection-progress')?.classList.toggle('hidden', manual);
    document.getElementById('quality-confidence')?.classList.toggle('hidden', manual);

    if (manual) {
      this.storyDetectionInFlight = 0;
      this.setStoryDetectionProgress(false);
      this.selectionFallbackActive = false;
      this.clearExtractRetry();
      this.extractRetryCount = 0;
      const input = document.getElementById('manual-story-input');
      if (input && input.value !== String(this.manualStoryText || '')) {
        input.value = String(this.manualStoryText || '');
      }
      this.updateManualStoryCount();
      this.extractedText = String(this.manualStoryText || '');
      this.selectedStoryTitle = this.deriveManualStoryTitle(this.manualStoryText);
      this.updatePreview(this.extractedText);
      this.setExtraSectionOpen('content-extra-section', true);
    } else {
      this.refreshSelectionFallbackUI();
      if (previousMode === 'manual') {
        void this.extractContent({ isRetry: false });
      }
    }
  }

  onManualStoryInputChanged() {
    const input = document.getElementById('manual-story-input');
    this.manualStoryText = String(input?.value || '');
    this.extractedText = this.manualStoryText;
    this.selectedStoryTitle = this.deriveManualStoryTitle(this.manualStoryText);
    this.updateManualStoryCount();
    this.updatePreview(this.manualStoryText);
    void this.saveManualStoryDraft();
  }

  getSelectedContentSource() {
    if (this.isManualComposerMode()) return 'manual';
    return document.querySelector('input[name="contentSource"]:checked')?.value || 'full';
  }

  setSelectedContentSource(mode) {
    const radio = document.querySelector(`input[name="contentSource"][value="${mode}"]`);
    if (radio) radio.checked = true;
  }

  tryFallbackContentExtraction(contentSource, failureReason) {
    if (contentSource !== 'full' || this.extractFallbackTried) return false;
    this.extractFallbackTried = true;
    this.selectionFallbackActive = true;
    this.clearExtractRetry();
    this.extractRetryCount = 0;
    this.setSelectedContentSource('selection');
    this.selectedExtractionCandidateId = '';
    this.extractionCandidates = [];
    this.selectedStoryTitle = '';
    this.updateCandidateSelector();
    this.updatePreview('Full-page extraction failed. Trying selected text mode...');
    void this.appendDebugLog('content.extract.fallback_to_selection', {
      reason: failureReason || 'unknown'
    });
    void this.extractContent({ isRetry: false, fallbackTriggered: true });
    return true;
  }

  async extractContent(options = {}) {
    if (this.isManualComposerMode()) {
      this.extractedText = String(this.manualStoryText || '');
      this.updatePreview(this.extractedText);
      return;
    }

    const requestSeq = ++this.extractRequestSeq;
    const contentSource = this.getSelectedContentSource();
    const isRetry = !!options.isRetry;
    const trackStoryDetection = contentSource === 'full';
    if (trackStoryDetection) {
      this.beginStoryDetectionProgress(isRetry);
      // Clear stale story UI immediately so prior-page candidate panes do not flash
      // while the new page is being analyzed.
      if (!isRetry && !options.selectedCandidateId) {
        this.extractionCandidates = [];
        this.selectedExtractionCandidateId = '';
        this.selectedCandidateSummary = '';
        this.selectedCandidateScore = 0;
        this.selectedStoryTitle = '';
        this.updateCandidateSelector();
        this.updateQualityConfidenceUI();
      }
    }
    if (!isRetry) {
      this.extractRetryCount = 0;
      this.clearExtractRetry();
      if (!options.fallbackTriggered) {
        this.extractFallbackTried = false;
      }
    }
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.currentPageUrl = String(tab?.url || '');
      this.currentSiteProfile = this.classifySiteProfile(this.currentPageUrl);
      this.updateSiteProfileHint();
      const tabStatus = tab?.status || 'unknown';
      const shouldRetryForLoading = contentSource === 'full' && tabStatus !== 'complete';
      if (shouldRetryForLoading && !isRetry) {
        this.updatePreview('Page is still loading. Waiting for content...');
      }
      
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXTRACT_CONTENT',
        payload: {
          mode: contentSource,
          selectedCandidateId: options.selectedCandidateId || this.selectedExtractionCandidateId || ''
        }
      });
      if (requestSeq !== this.extractRequestSeq) return;
      
      if (response && response.success) {
        this.extractedText = response.text;
        this.extractionQuality = response.quality || null;
      if (contentSource === 'full') {
        this.selectionFallbackActive = false;
      }
      this.extractionCandidates = Array.isArray(response.candidates) ? response.candidates : [];
      this.storyPreviewCache = {};
      let preferredCandidateId = response.selectedCandidateId || response.autoSelectedCandidateId || '';
      if (contentSource === 'full') {
        const llmStoriesApplied = await this.processStoriesWithLlm(response, tab, options);
        if (llmStoriesApplied) {
          preferredCandidateId = this.selectedExtractionCandidateId || preferredCandidateId;
        }
      }
        if (contentSource === 'full') {
          this.selectedExtractionCandidateId =
            preferredCandidateId ||
            this.selectedExtractionCandidateId ||
            options.selectedCandidateId ||
            (this.extractionCandidates[0] && this.extractionCandidates[0].id) ||
            '';
        } else {
          this.selectedExtractionCandidateId = '';
        }
        const selectedOption = this.getSelectedCandidateOption();
        this.selectedCandidateSummary = selectedOption?.summary || '';
        this.selectedCandidateScore = Number(selectedOption?.score || 0);
        this.selectedStoryTitle = String(selectedOption?.title || '').trim();
        this.updateCandidateSelector();
        this.clearExtractRetry();
        this.extractRetryCount = 0;
        this.updatePreview(response.text);
        this.updateQualityConfidenceUI();
        void this.appendDebugLog('content.extract.success', {
          chars: response.text ? response.text.length : 0,
          mode: contentSource,
          tabStatus: tabStatus,
          retry: isRetry
        });
      } else {
        var failureMessage = response?.error || 'Failed to extract content';
        const notEnoughContent = /could not extract enough readable content/i.test(failureMessage);
        this.extractedText = '';
        this.extractionQuality = response?.quality || null;
        if (contentSource !== 'full') {
          this.extractionCandidates = [];
          this.selectedExtractionCandidateId = '';
          this.selectedStoryTitle = '';
          this.updateCandidateSelector();
        }
        this.updatePreview(response?.error || 'Failed to extract content');
        this.updateQualityConfidenceUI();
        void this.appendDebugLog('content.extract.failure', {
          mode: contentSource,
          error: failureMessage,
          tabStatus: tabStatus,
          retry: isRetry
        });

        if (contentSource === 'full') {
          if (tabStatus !== 'complete') {
            this.scheduleExtractRetry('tab-loading', 1200);
            return;
          }

          if (notEnoughContent) {
            // Retry immediately a couple of times before switching modes.
            if (this.extractRetryCount < 2) {
              this.extractRetryCount += 1;
              void this.appendDebugLog('content.extract.retry_inline', {
                reason: 'not-enough-content',
                attempt: this.extractRetryCount
              });
              await this.extractContent({ isRetry: true });
              return;
            }
            if (this.tryFallbackContentExtraction(contentSource, 'not-enough-content')) {
              return;
            }
          }
        }
      }
    } catch (error) {
      if (requestSeq !== this.extractRequestSeq) return;
      console.error('Extraction error:', error);
      var message = error && error.message ? error.message : String(error);
      void this.appendDebugLog('content.extract.error', { message: message, retry: isRetry });

      if (/Receiving end does not exist|Could not establish connection|The message port closed/i.test(message)) {
        const reinjected = await this.tryReinjectContentScript();
        this.updatePreview(reinjected ? 'Preparing page content extraction... Retrying...' : 'Unable to extract content yet. Retrying...');
        this.scheduleExtractRetry(reinjected ? 'content-script-reinjected' : 'content-script-not-ready', 1000);
        return;
      }

      if (
        /could not extract enough readable content/i.test(message) &&
        this.tryFallbackContentExtraction(contentSource, message)
      ) {
        return;
      }

      const hasExistingFullContent = contentSource === 'full' && String(this.extractedText || '').trim().length >= 50;
      if (!hasExistingFullContent) {
        this.extractedText = '';
        this.extractionQuality = null;
      }
      if (contentSource !== 'full') {
        this.extractionCandidates = [];
        this.selectedExtractionCandidateId = '';
        this.selectedStoryTitle = '';
        this.updateCandidateSelector();
      }
      this.updatePreview('Unable to extract content. Try selecting text on the page.');
      this.updateQualityConfidenceUI();
    } finally {
      if (trackStoryDetection) {
        this.endStoryDetectionProgress();
      }
    }
  }

  async processStoriesWithLlm(extractResponse, tab, options = {}) {
    try {
      const candidatePayloads = Array.isArray(extractResponse?.candidatePayloads) ? extractResponse.candidatePayloads : [];
      const sourceText = String(extractResponse?.fullSourceText || extractResponse?.text || '').trim();
      const sourceHtml = String(extractResponse?.sourceHtml || '').trim();
      if (!sourceText && !sourceHtml) return false;

      const response = await chrome.runtime.sendMessage({
        type: 'PROCESS_CONTENT_STORIES',
        payload: {
          sourceText: sourceText,
          sourceHtml: sourceHtml,
          candidatePayloads: candidatePayloads,
          sourceUrl: String(tab?.url || this.currentPageUrl || ''),
          sourceTitle: String(tab?.title || ''),
          preferredProvider: this.settings.activeTextProvider || 'gemini-free',
          settings: this.settings
        }
      });
      if (!response || response.success === false) return false;
      const stories = Array.isArray(response.stories) ? response.stories : [];
      if (!stories.length) return false;

      this.extractionCandidates = stories.map((story, idx) => ({
        id: String(story?.id || ('story_' + (idx + 1))),
        title: String(story?.title || ('Story ' + (idx + 1))),
        summary: String(story?.summary || ''),
        score: Number(story?.score || 0),
        chars: Number(story?.chars || String(story?.text || '').length || 0),
        sourceCandidateId: String(story?.sourceCandidateId || story?.candidate_id || ''),
        text: String(story?.text || ''),
        summaryMethod: 'llm'
      }));

      const requestedCandidateId = String(options.selectedCandidateId || '').trim();
      let resolvedRequestedStoryId = '';
      if (requestedCandidateId) {
        const byStoryId = this.extractionCandidates.find((candidate) => String(candidate?.id || '') === requestedCandidateId);
        const bySourceCandidateId = byStoryId ? null : this.extractionCandidates.find((candidate) => (
          String(candidate?.sourceCandidateId || '') === requestedCandidateId
        ));
        resolvedRequestedStoryId = String((byStoryId || bySourceCandidateId || {}).id || '');
      }
      const hasRequestedCandidate = Boolean(resolvedRequestedStoryId);
      const selectedStoryId = String(
        (hasRequestedCandidate ? resolvedRequestedStoryId : '') ||
        response.selectedStoryId ||
        (this.extractionCandidates[0] && this.extractionCandidates[0].id) ||
        ''
      );
      this.selectedExtractionCandidateId = selectedStoryId;
      const selectedStory = this.getSelectedCandidateOption() || this.extractionCandidates[0] || null;
      if (selectedStory) {
        this.extractedText = String(selectedStory.text || this.extractedText || '');
        this.selectedCandidateSummary = String(selectedStory.summary || '');
        this.selectedCandidateScore = Number(selectedStory.score || 0);
        this.selectedStoryTitle = String(selectedStory.title || '').trim();
      }
      void this.appendDebugLog('content.story_selection.llm.success', {
        providerUsed: response.providerUsed || '',
        storyCount: this.extractionCandidates.length,
        selectedStoryId: this.selectedExtractionCandidateId
      });
      return true;
    } catch (error) {
      void this.appendDebugLog('content.story_selection.llm.error', {
        message: error?.message || String(error)
      });
      return false;
    }
  }

  async tryReinjectContentScript() {
    try {
      if (!chrome?.scripting?.executeScript) return false;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return false;
      const url = String(tab.url || '');
      if (!/^https?:/i.test(url)) return false;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/content-script.js']
      });
      void this.appendDebugLog('content.extract.reinject.success', { tabId: tab.id });
      return true;
    } catch (error) {
      void this.appendDebugLog('content.extract.reinject.failure', {
        message: error && error.message ? error.message : String(error)
      });
      return false;
    }
  }

  updatePreview(text) {
    const previewEl = document.getElementById('preview-text');
    const charCountEl = document.getElementById('char-count');
    const modelPreviewEl = document.getElementById('model-context-preview-text');
    const modelCharCountEl = document.getElementById('model-context-char-count');
    
    if (!text || text.length === 0) {
      previewEl.innerHTML = '<span class="loading">No content found</span>';
      charCountEl.textContent = '0';
      if (modelPreviewEl) {
        modelPreviewEl.innerHTML = '<span class="loading">No model context yet</span>';
      }
      if (modelCharCountEl) modelCharCountEl.textContent = '0';
      this.updateQualityConfidenceUI();
      this.updateWizardReadiness();
      return;
    }
    
    const truncated = text.length > 500 ? text.substring(0, 500) + '...' : text;
    const modelSnippetRaw = text.length > 1000 ? text.substring(0, 1000) : text;
    const modelSnippet = text.length > 1000 ? (modelSnippetRaw + '...') : modelSnippetRaw;
    previewEl.textContent = truncated;
    charCountEl.textContent = text.length.toLocaleString();
    if (modelPreviewEl) modelPreviewEl.textContent = modelSnippet;
    if (modelCharCountEl) modelCharCountEl.textContent = modelSnippetRaw.length.toLocaleString();
    this.updateQualityConfidenceUI();
    this.updateWizardReadiness();
  }

  updateCandidateSelector() {
    const wrap = document.getElementById('content-candidate-wrap');
    const select = document.getElementById('content-candidate-select');
    if (!wrap || !select) {
      this.updateQualityConfidenceUI();
      return;
    }

    const candidates = Array.isArray(this.extractionCandidates) ? this.extractionCandidates : [];
    const shouldShow = false;
    wrap.classList.toggle('hidden', !shouldShow);
    if (!shouldShow) {
      this.updateQualityConfidenceUI();
      return;
    }

    const current = this.selectedExtractionCandidateId || (candidates[0] && candidates[0].id) || '';
    select.innerHTML = candidates.map((c, idx) => {
      const label = `${String(c.summary || 'Suggested section').slice(0, 140)} (${Number(c.chars || 0).toLocaleString()} chars)`;
      return `<option value="${this.escapeHtml(c.id || '')}">${this.escapeHtml(label)}</option>`;
    }).join('');
    select.value = current;
    if (select.value !== current && candidates[0]) {
      select.value = candidates[0].id || '';
      this.selectedExtractionCandidateId = select.value;
    }
    const selectedOption = this.getSelectedCandidateOption();
    this.selectedCandidateSummary = selectedOption?.summary || '';
    this.selectedCandidateScore = Number(selectedOption?.score || 0);
    this.selectedStoryTitle = String(selectedOption?.title || this.selectedStoryTitle || '').trim();
    this.updateQualityConfidenceUI();
  }

  getCandidateDisplaySummary(candidate) {
    const storyTitle = String(candidate?.title || '').trim();
    const raw = String(candidate?.summary || '').trim();
    if (raw && storyTitle) return (storyTitle + ': ' + raw).slice(0, 220);
    if (raw) return raw.slice(0, 220);
    if (storyTitle) return storyTitle.slice(0, 220);
    return 'No summary available';
  }

  renderStoryPickerList() {
    const list = document.getElementById('story-picker-list');
    if (!list) return;
    const candidates = Array.isArray(this.extractionCandidates) ? this.extractionCandidates : [];
    if (!candidates.length) {
      list.innerHTML = '<p class="empty-state">No detected stories yet.</p>';
      return;
    }
    list.innerHTML = candidates.map((candidate, idx) => {
      const id = String(candidate?.id || ('candidate_' + idx));
      const isActive = id === this.selectedExtractionCandidateId;
      const storyTitle = String(candidate?.title || '').trim();
      const title = `${storyTitle || ('Story ' + (idx + 1))} • ${Number(candidate?.chars || 0).toLocaleString()} chars • score ${Number(candidate?.score || 0).toFixed(0)}`;
      const summary = this.getCandidateDisplaySummary(candidate);
      return [
        `<div class="story-picker-entry" data-candidate-id="${this.escapeHtml(id)}">`,
        '<div class="story-picker-entry-head">',
        `<button type="button" class="story-picker-item${isActive ? ' active' : ''}" data-candidate-id="${this.escapeHtml(id)}">`,
        `<span class="story-picker-item-title">${this.escapeHtml(title)}</span>`,
        `<span class="story-picker-item-summary">${this.escapeHtml(summary)}</span>`,
        '</button>',
        `<button type="button" class="story-picker-expand-btn" data-candidate-id="${this.escapeHtml(id)}" aria-expanded="false" title="Preview full story">+</button>`,
        '</div>',
        `<div class="story-picker-preview hidden" data-candidate-id="${this.escapeHtml(id)}">`,
        '<div class="story-picker-preview-text"><span class="loading">Click + to preview full extracted story...</span></div>',
        '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  async loadStoryPreview(candidateId) {
    const key = String(candidateId || '').trim();
    if (!key) return 'No story preview available.';
    if (typeof this.storyPreviewCache[key] === 'string') return this.storyPreviewCache[key];
    const localCandidate = this.getCandidateIndexFromId(key) >= 0 ? this.getSelectedCandidateOption() : null;
    const matchedCandidate = Array.isArray(this.extractionCandidates)
      ? this.extractionCandidates.find((candidate) => String(candidate?.id || '') === key)
      : null;
    const inlineText = String((matchedCandidate && matchedCandidate.text) || (localCandidate && localCandidate.text) || '').trim();
    if (inlineText) {
      const localPreview = inlineText.length > 1800 ? (inlineText.slice(0, 1800) + '\n...[truncated]') : inlineText;
      this.storyPreviewCache[key] = localPreview;
      return localPreview;
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXTRACT_CONTENT',
        payload: {
          mode: 'full',
          selectedCandidateId: key
        }
      });
      const text = String(response?.text || '').trim();
      const preview = text
        ? (text.length > 1800 ? (text.slice(0, 1800) + '\n...[truncated]') : text)
        : 'No preview content available for this story.';
      this.storyPreviewCache[key] = preview;
      return preview;
    } catch (error) {
      return 'Could not load story preview.';
    }
  }

  async toggleStoryPreview(candidateId) {
    const key = String(candidateId || '').trim();
    if (!key) return;
    const previewEl = Array.from(document.querySelectorAll('.story-picker-preview'))
      .find((el) => String(el?.dataset?.candidateId || '') === key);
    const expandBtn = Array.from(document.querySelectorAll('.story-picker-expand-btn'))
      .find((el) => String(el?.dataset?.candidateId || '') === key);
    if (!previewEl || !expandBtn) return;
    const isHidden = previewEl.classList.contains('hidden');
    if (!isHidden) {
      previewEl.classList.add('hidden');
      expandBtn.textContent = '+';
      expandBtn.setAttribute('aria-expanded', 'false');
      return;
    }
    previewEl.classList.remove('hidden');
    expandBtn.textContent = '−';
    expandBtn.setAttribute('aria-expanded', 'true');
    const textEl = previewEl.querySelector('.story-picker-preview-text');
    if (!textEl) return;
    textEl.innerHTML = '<span class="loading">Loading preview...</span>';
    const previewText = await this.loadStoryPreview(key);
    textEl.textContent = previewText;
  }

  openStoryPicker() {
    const modal = document.getElementById('story-picker-modal');
    if (!modal) return;
    this.renderStoryPickerList();
    modal.classList.remove('hidden');
  }

  hideStoryPicker() {
    const modal = document.getElementById('story-picker-modal');
    if (!modal) return;
    modal.classList.add('hidden');
  }

  async selectStoryCandidate(candidateId) {
    const nextCandidateId = String(candidateId || '').trim();
    if (!nextCandidateId) return;
    this.storySelectionLockedByUser = true;
    this.selectedExtractionCandidateId = nextCandidateId;
    const select = document.getElementById('content-candidate-select');
    if (select) select.value = nextCandidateId;
    const selectedOption = this.getSelectedCandidateOption();
    this.selectedCandidateSummary = selectedOption?.summary || '';
    this.selectedCandidateScore = Number(selectedOption?.score || 0);
    this.selectedStoryTitle = String(selectedOption?.title || '').trim();
    // Prevent accidental generation from stale text while switching stories.
    this.extractedText = '';
    this.updatePreview('Loading selected story...');
    this.updateStoryFlowHint();
    this.updateQualityConfidenceUI();
    this.hideStoryPicker();
    await this.extractContent({ selectedCandidateId: nextCandidateId });
  }

  bindEvents() {
    // Onboarding
    document.getElementById('onboarding-start-btn')?.addEventListener('click', () => this.completeOnboarding());
    document.getElementById('create-comic-btn')?.addEventListener('click', () => this.showCreateComposer('page'));
    document.getElementById('create-from-text-btn')?.addEventListener('click', () => this.showCreateComposer('manual'));
    document.getElementById('view-history-btn')?.addEventListener('click', () => this.openCollectionViewFromLauncher());
    document.getElementById('back-home-btn')?.addEventListener('click', () => this.showHome());
    document.getElementById('manual-story-input')?.addEventListener('input', () => this.onManualStoryInputChanged());
    document.getElementById('content-extra-section')?.addEventListener('toggle', (e) => {
      if (this.suppressExtraIntentTracking) return;
      this.userCollapsedContent = !(e && e.target && e.target.open);
    });
    document.getElementById('options-extra-section')?.addEventListener('toggle', (e) => {
      if (this.suppressExtraIntentTracking) return;
      this.userCollapsedOptions = !(e && e.target && e.target.open);
    });
    
    // Content source change
    document.querySelectorAll('input[name="contentSource"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (this.isManualComposerMode()) return;
        this.storySelectionLockedByUser = this.getSelectedContentSource() === 'selection';
        if (this.getSelectedContentSource() !== 'full') {
          this.selectedExtractionCandidateId = '';
          this.selectedStoryTitle = '';
          this.extractionCandidates = [];
          this.updateCandidateSelector();
        }
        this.refreshSelectionFallbackUI();
        this.extractContent();
      });
    });
    // Refresh preview
    document.getElementById('refresh-preview-btn')?.addEventListener('click', () => this.extractContent());
    document.getElementById('auto-pick-best-btn')?.addEventListener('click', () => this.autoPickBestStorySection());
    document.getElementById('story-picker-btn')?.addEventListener('click', () => this.openStoryPicker());
    document.getElementById('close-story-picker-btn')?.addEventListener('click', () => this.hideStoryPicker());
    document.getElementById('close-story-picker-footer-btn')?.addEventListener('click', () => this.hideStoryPicker());
    document.getElementById('story-picker-list')?.addEventListener('click', (event) => {
      const expandBtn = event?.target?.closest?.('.story-picker-expand-btn');
      if (expandBtn) {
        const previewCandidateId = expandBtn?.dataset?.candidateId || '';
        if (!previewCandidateId) return;
        void this.toggleStoryPreview(previewCandidateId);
        return;
      }
      const btn = event?.target?.closest?.('.story-picker-item');
      const candidateId = btn?.dataset?.candidateId || '';
      if (!candidateId) return;
      void this.selectStoryCandidate(candidateId);
    });
    
    // Settings changes
    document.getElementById('panel-count').addEventListener('change', (e) => {
      this.settings.panelCount = parseInt(e.target.value);
      this.saveSettings();
      this.updateWizardReadiness();
    });

    document.getElementById('objective').addEventListener('change', (e) => {
      this.settings.objective = e.target.value || 'explain-like-im-five';
      this.saveSettings();
      this.updateWizardReadiness();
    });
    document.getElementById('output-language')?.addEventListener('change', (e) => {
      this.settings.outputLanguage = this.normalizeOutputLanguage(e.target.value);
      this.saveSettings();
      this.updateWizardReadiness();
    });
    
    document.getElementById('detail-level').addEventListener('change', (e) => {
      this.settings.detailLevel = e.target.value;
      this.saveSettings();
      this.updateWizardReadiness();
    });
    
    document.getElementById('style-preset').addEventListener('change', (e) => {
      if (e.target.value === CREATE_NEW_STYLE_VALUE) {
        e.target.value = this.getCurrentStyleSelectValue();
        this.openStyleModal();
        return;
      }

      this.settings.styleId = e.target.value;
      this.syncLegacyCustomStyleFieldsFromSelection();
      if (this.settings.styleId === 'custom' || this.getSelectedUserStyle()) {
        this.setAdvancedSettingsExpanded(true);
      }
      this.toggleLegacyCustomStyleEditor();
      this.saveSettings();
      this.updateWizardReadiness();
    });
    
    document.getElementById('custom-style-input').addEventListener('input', (e) => {
      this.settings.customStyleTheme = e.target.value;
      this.saveSettings();
      this.updateWizardReadiness();
    });

    document.getElementById('custom-style-name-input').addEventListener('input', (e) => {
      this.settings.customStyleName = e.target.value;
      this.saveSettings();
      this.updateWizardReadiness();
    });

    document.getElementById('close-style-modal-btn')?.addEventListener('click', () => this.closeStyleModal());
    document.getElementById('cancel-style-modal-btn')?.addEventListener('click', () => this.closeStyleModal());
    document.getElementById('save-style-modal-btn')?.addEventListener('click', () => this.saveNewCustomStyle());
    document.getElementById('advanced-settings-toggle')?.addEventListener('click', () => {
      this.setAdvancedSettingsExpanded(!this.advancedSettingsExpanded);
    });
    
    document.getElementById('provider-preset').addEventListener('change', async (e) => {
      const selectedProvider = e.target.value;
      this.settings.activeTextProvider = selectedProvider;
      this.settings.activeImageProvider = await this.resolveImageProviderForTextProvider(selectedProvider);
      this.updateProviderWarning();
      this.saveSettings();
      this.updateWizardReadiness();
    });
    
    // Generate button
    document.getElementById('generate-btn').addEventListener('click', () => this.startGeneration());
    
    // Open viewer button
    document.getElementById('open-viewer-btn').addEventListener('click', async () => {
      const opened = await this.openSidePanel({ userInitiated: true });
      if (opened) this.closePopupWindow();
    });
    document.getElementById('configure-providers-btn')?.addEventListener('click', () => this.openOptions());
    document.getElementById('readiness-next-btn')?.addEventListener('click', () => this.handleReadinessNextAction());
    document.getElementById('retry-providers-btn')?.addEventListener('click', async () => {
      await this.refreshProviderOptions();
      await this.updateProviderWarning();
      this.updateWizardReadiness();
    });
    document.getElementById('selection-hint-btn')?.addEventListener('click', () => this.showSelectionHintOnPage());
    document.getElementById('retry-full-extract-btn')?.addEventListener('click', () => {
      this.selectionFallbackActive = false;
      this.extractFallbackTried = false;
      this.storySelectionLockedByUser = false;
      this.setSelectedContentSource('full');
      this.refreshSelectionFallbackUI();
      this.extractContent({ isRetry: false });
    });
    
    // Cancel button
    document.getElementById('cancel-btn')?.addEventListener('click', () => this.cancelGeneration());
    
    // Settings button
    document.getElementById('settings-btn').addEventListener('click', () => this.openOptions());
    document.getElementById('download-logs-btn')?.addEventListener('click', () => this.downloadDebugLogs());
    
    // History
    document.getElementById('history-btn')?.addEventListener('click', () => this.handleHistoryFooterClick());
    document.getElementById('close-history-btn')?.addEventListener('click', () => this.hideHistory());
    document.getElementById('clear-history-btn')?.addEventListener('click', () => this.clearHistory());
    
    // Configure key link
    document.getElementById('configure-key-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openOptions();
    });
  }

  updateUI() {
    // Update form values from settings
    document.getElementById('panel-count').value = this.settings.panelCount;
    document.getElementById('objective').value = this.settings.objective || 'explain-like-im-five';
    this.settings.outputLanguage = this.normalizeOutputLanguage(this.settings.outputLanguage);
    document.getElementById('output-language').value = this.settings.outputLanguage;
    this.normalizePanelCountSetting();
    document.getElementById('detail-level').value = this.settings.detailLevel;
    this.renderStyleOptions();
    if (this.getSelectedUserStyle() || this.settings.styleId === 'custom') {
      this.setAdvancedSettingsExpanded(true);
    } else {
      this.setAdvancedSettingsExpanded(false);
    }
    void this.refreshProviderOptions().then(() => this.updateProviderWarning());
    
    this.toggleLegacyCustomStyleEditor();
    this.updateFirstRunVisibility();
    const manualInput = document.getElementById('manual-story-input');
    if (manualInput) manualInput.value = String(this.manualStoryText || '');
    this.updateManualStoryCount();
    this.setComposerMode('page');
    this.refreshSelectionFallbackUI();
    this.updateWizardReadiness();
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
      void this.appendDebugLog('debugLogs.export.popup', { count: logs.length });
    } catch (error) {
      console.error('Failed to export debug logs from popup:', error);
      this.showError('Failed to export debug logs.');
    }
  }

  normalizePanelCountSetting() {
    const select = document.getElementById('panel-count');
    const raw = parseInt(this.settings.panelCount, 10);
    const allowed = select
      ? Array.from(select.options)
          .map((opt) => parseInt(opt.value, 10))
          .filter((n) => Number.isFinite(n))
      : [3, 4, 5, 6, 8, 10, 12];
    const fallback = allowed.includes(3) ? 3 : (allowed[0] || 3);
    const normalized = allowed.includes(raw) ? raw : fallback;
    this.settings.panelCount = normalized;
    if (select && select.value !== String(normalized)) {
      select.value = String(normalized);
    }
  }

  setAdvancedSettingsExpanded(expanded) {
    const panel = document.getElementById('advanced-settings-panel');
    const toggle = document.getElementById('advanced-settings-toggle');
    if (!panel || !toggle) return;
    this.advancedSettingsExpanded = Boolean(expanded);
    if (this.advancedSettingsExpanded) {
      const imagesCard = document.getElementById('customize-images-card');
      if (imagesCard && imagesCard.tagName === 'DETAILS') imagesCard.open = true;
    }
    panel.classList.toggle('hidden', !this.advancedSettingsExpanded);
    toggle.setAttribute('aria-expanded', this.advancedSettingsExpanded ? 'true' : 'false');
  }

  setExtraSectionOpen(sectionId, isOpen) {
    const section = document.getElementById(sectionId);
    if (!section || section.tagName !== 'DETAILS') return;
    this.suppressExtraIntentTracking = true;
    section.open = Boolean(isOpen);
    setTimeout(() => { this.suppressExtraIntentTracking = false; }, 0);
  }

  updateQuickReadinessChips(state, canonicalText) {
    const contentChip = document.getElementById('chip-content');
    const providerChip = document.getElementById('chip-provider');
    const readyChip = document.getElementById('chip-ready');
    const applyChip = (el, text, cls) => {
      if (!el) return;
      el.classList.remove('pending', 'ready', 'warn');
      el.classList.add(cls);
      el.textContent = text;
    };

    applyChip(
      contentChip,
      state.contentReady ? 'Source: ready' : 'Source: action needed',
      state.contentReady ? 'ready' : 'warn'
    );
    applyChip(
      providerChip,
      state.settingsReady ? 'Provider: ready' : 'Provider: action needed',
      state.settingsReady ? 'ready' : 'warn'
    );
    applyChip(
      readyChip,
      state.canGenerate ? 'Generate: ready' : 'Generate: action needed',
      state.canGenerate ? 'ready' : 'warn'
    );
    if (canonicalText) {
      const quick = document.getElementById('quick-readiness-chips');
      if (quick) quick.title = canonicalText;
    }
  }

  getReadinessNextAction(readinessState) {
    if (!readinessState || readinessState.canGenerate) return null;
    if (!this.hasAnyConfiguredProviders) {
      return {
        id: 'open-settings',
        label: 'Connect Provider',
        handler: () => this.openOptions()
      };
    }
    if (!readinessState.settingsReady) {
      return {
        id: 'open-customize',
        label: 'Open Customize',
        handler: () => this.setExtraSectionOpen('options-extra-section', true)
      };
    }
    // Keep the readiness area calm while source analysis runs; story picking is available
    // via the dedicated Stories button once candidates are ready.
    if (!readinessState.contentReady) return null;
    return null;
  }

  updateReadinessActionControl(readinessState) {
    const nextBtn = document.getElementById('readiness-next-btn');
    if (!nextBtn) return;
    if (!this.hasAnyConfiguredProviders) {
      nextBtn.classList.add('hidden');
      nextBtn.dataset.actionId = '';
      return;
    }
    const action = this.getReadinessNextAction(readinessState);
    if (!action) {
      nextBtn.classList.add('hidden');
      nextBtn.dataset.actionId = '';
      return;
    }
    nextBtn.textContent = action.label;
    nextBtn.dataset.actionId = action.id;
    nextBtn.classList.remove('hidden');
  }

  handleReadinessNextAction() {
    const actionId = String(document.getElementById('readiness-next-btn')?.dataset?.actionId || '');
    if (!actionId) return;
    if (actionId === 'open-story-picker') {
      this.openStoryPicker();
      return;
    }
    if (actionId === 'open-settings') {
      this.openOptions();
      return;
    }
    if (actionId === 'open-customize') {
      this.setExtraSectionOpen('options-extra-section', true);
    }
  }

  refreshSelectionFallbackUI() {
    const note = document.getElementById('selection-fallback-note');
    if (!note) return;
    if (this.isManualComposerMode()) {
      note.classList.add('hidden');
      return;
    }
    const show = this.selectionFallbackActive || this.getSelectedContentSource() === 'selection';
    note.classList.toggle('hidden', !show);
  }

  async showSelectionHintOnPage() {
    try {
      if (!chrome?.scripting?.executeScript) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const id = '__web2comics_selection_hint__';
          document.getElementById(id)?.remove();
          const el = document.createElement('div');
          el.id = id;
          el.textContent = 'Web2Comics: highlight relevant text, then reopen the extension and click Re-scan.';
          Object.assign(el.style, {
            position: 'fixed',
            zIndex: '2147483647',
            top: '12px',
            right: '12px',
            maxWidth: '320px',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid #d18b00',
            background: '#fff7e6',
            color: '#7c2d12',
            fontSize: '13px',
            fontFamily: 'Arial, sans-serif',
            boxShadow: '0 4px 10px rgba(0,0,0,0.18)'
          });
          document.body.appendChild(el);
          setTimeout(() => el.remove(), 5000);
        }
      });
      this.closePopupWindow();
    } catch (error) {
      void this.appendDebugLog('content.selection_hint.error', {
        message: error && error.message ? error.message : String(error)
      });
    }
  }

  getCurrentStyleSelectValue() {
    return this.settings.styleId || 'default';
  }

  renderStyleOptions() {
    const select = document.getElementById('style-preset');
    if (!select) return;

    Array.from(select.querySelectorAll('option[data-custom-style="true"]')).forEach((opt) => opt.remove());
    const createOpt = select.querySelector(`option[value="${CREATE_NEW_STYLE_VALUE}"]`);

    (this.customStyles || []).forEach((style) => {
      if (!style || !style.id || !style.name) return;
      const opt = document.createElement('option');
      opt.value = USER_STYLE_PREFIX + style.id;
      opt.textContent = style.name;
      opt.dataset.customStyle = 'true';
      if (createOpt) {
        select.insertBefore(opt, createOpt);
      } else {
        select.appendChild(opt);
      }
    });

    const currentValue = this.getCurrentStyleSelectValue();
    const available = Array.from(select.options).map((opt) => opt.value);
    if (!available.includes(currentValue)) {
      this.settings.styleId = 'default';
    }
    select.value = this.getCurrentStyleSelectValue();
    this.syncLegacyCustomStyleFieldsFromSelection();
  }

  toggleLegacyCustomStyleEditor() {
    const customStyleContainer = document.getElementById('custom-style-container');
    const customStyleInput = document.getElementById('custom-style-input');
    const customStyleNameInput = document.getElementById('custom-style-name-input');
    if (!customStyleContainer || !customStyleInput || !customStyleNameInput) return;
    customStyleContainer.classList.add('hidden');
  }

  getSelectedUserStyle() {
    const styleId = this.settings.styleId || '';
    if (!styleId.startsWith(USER_STYLE_PREFIX)) return null;
    const id = styleId.slice(USER_STYLE_PREFIX.length);
    return (this.customStyles || []).find((style) => style && style.id === id) || null;
  }

  syncLegacyCustomStyleFieldsFromSelection() {
    const selectedUserStyle = this.getSelectedUserStyle();
    if (!selectedUserStyle) return;
    this.settings.customStyleName = selectedUserStyle.name || '';
    this.settings.customStyleTheme = selectedUserStyle.description || '';
  }

  getResolvedStylePayload() {
    const selectedUserStyle = this.getSelectedUserStyle();
    if (selectedUserStyle) {
      return {
        styleId: 'custom',
        customStyleName: selectedUserStyle.name || '',
        customStyleTheme: selectedUserStyle.description || ''
      };
    }

    return {
      styleId: this.settings.styleId || 'default',
      customStyleName: this.settings.customStyleName || '',
      customStyleTheme: this.settings.customStyleTheme || ''
    };
  }

  openStyleModal() {
    const modal = document.getElementById('style-modal');
    if (!modal) return;
    document.getElementById('new-style-name-input').value = '';
    document.getElementById('new-style-description-input').value = '';
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('new-style-name-input')?.focus(), 0);
  }

  closeStyleModal() {
    document.getElementById('style-modal')?.classList.add('hidden');
  }

  slugifyStyleId(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 40) || ('style-' + Date.now());
  }

  async saveNewCustomStyle() {
    const nameInput = document.getElementById('new-style-name-input');
    const descInput = document.getElementById('new-style-description-input');
    const name = (nameInput?.value || '').trim();
    const description = (descInput?.value || '').trim();

    if (!name) {
      alert('Please enter a style name.');
      return;
    }
    if (!description) {
      alert('Please enter a style description.');
      return;
    }

    const baseId = this.slugifyStyleId(name);
    let finalId = baseId;
    let suffix = 2;
    while ((this.customStyles || []).some((style) => style && style.id === finalId)) {
      finalId = baseId + '-' + suffix;
      suffix += 1;
    }

    const styleEntry = {
      id: finalId,
      name: name,
      description: description,
      createdAt: new Date().toISOString()
    };

    this.customStyles = [...(this.customStyles || []), styleEntry];
    await chrome.storage.local.set({ customStyles: this.customStyles });

    this.settings.styleId = USER_STYLE_PREFIX + styleEntry.id;
    this.settings.customStyleName = styleEntry.name;
    this.settings.customStyleTheme = styleEntry.description;
    this.setAdvancedSettingsExpanded(true);
    await this.saveSettings();

    this.renderStyleOptions();
    this.toggleLegacyCustomStyleEditor();
    this.closeStyleModal();
    void this.appendDebugLog('styles.custom.created', { id: styleEntry.id, name: styleEntry.name });
  }

  async refreshProviderOptions() {
    const providerSelect = document.getElementById('provider-preset');
    if (!providerSelect) return;

    const requiresKeyMap = {
      'gemini-free': 'gemini',
      'openai': 'openai',
      'openrouter': 'openrouter',
      'huggingface': 'huggingface'
    };
    const validationKeyMap = {
      'gemini-free': 'gemini',
      'openai': 'openai',
      'openrouter': 'openrouter',
      'huggingface': 'huggingface'
    };

    let apiKeys = {};
    let providerValidation = {};
    let cloudflareConfig = {};
    let cloudflareLegacy = {};
    try {
      const result = await chrome.storage.local.get(['apiKeys', 'providerValidation', 'cloudflareConfig', 'cloudflare']);
      apiKeys = result && result.apiKeys ? result.apiKeys : {};
      providerValidation = result && result.providerValidation ? result.providerValidation : {};
      cloudflareConfig = result && result.cloudflareConfig ? result.cloudflareConfig : {};
      cloudflareLegacy = result && result.cloudflare ? result.cloudflare : {};
    } catch (error) {
      console.error('Failed to load API keys for provider filtering:', error);
    }

    const hasCloudflareAuth = (() => {
      const cfg = cloudflareConfig || cloudflareLegacy || {};
      const accountId = cfg.accountId || cfg.account_id || '';
      const apiToken = cfg.apiToken || cfg.api_token || apiKeys.cloudflare || '';
      const email = cfg.email || '';
      const apiKey = cfg.apiKey || cfg.api_key || '';
      return Boolean(accountId && (apiToken || (email && apiKey)));
    })();

    const visibleValues = [];
    Array.from(providerSelect.options).forEach((option) => {
      const providerId = option.value;
      if (!providerId) return;
      if (providerId === 'cloudflare-free') {
        option.hidden = !hasCloudflareAuth;
        option.disabled = !hasCloudflareAuth;
        if (hasCloudflareAuth) visibleValues.push(providerId);
        return;
      }
      const keyName = requiresKeyMap[providerId];
      const validationKey = validationKeyMap[providerId];
      const hasKey = keyName ? Boolean(apiKeys && apiKeys[keyName]) : true;
      const isValidated = validationKey ? Boolean(providerValidation && providerValidation[validationKey] && providerValidation[validationKey].valid) : true;
      // Transitional compatibility: if no validation record exists yet, allow key-based providers.
      const configured = keyName ? (hasKey && (isValidated || !(providerValidation && Object.keys(providerValidation).length))) : true;
      option.hidden = !configured;
      option.disabled = !configured;
      if (configured) visibleValues.push(providerId);
    });
    this.hasAnyConfiguredProviders = visibleValues.length > 0;
    providerSelect.disabled = visibleValues.length === 0;

    let nextProvider = this.settings.activeTextProvider;
    if (!visibleValues.includes(nextProvider)) {
      nextProvider = visibleValues[0] || '';
      if (nextProvider) {
        this.settings.activeTextProvider = nextProvider;
        this.settings.activeImageProvider = await this.resolveImageProviderForTextProvider(nextProvider);
        void this.saveSettings();
      }
    }

    if (nextProvider) {
      providerSelect.value = nextProvider;
    }
    void this.appendDebugLog('providers.filtered', {
      activeProvider: nextProvider,
      visibleProviders: visibleValues,
      hasAnyConfiguredProviders: this.hasAnyConfiguredProviders
    });
    this.updateProviderWarning();
  }

  async resolveImageProviderForTextProvider(textProvider) {
    if (IMAGE_CAPABLE_PROVIDERS.has(textProvider)) {
      return textProvider;
    }

    // Keep current image provider if still image-capable and configured/usable.
    if (IMAGE_CAPABLE_PROVIDERS.has(this.settings.activeImageProvider)) {
      return this.settings.activeImageProvider;
    }

    try {
      const { apiKeys } = await chrome.storage.local.get('apiKeys');
      if (apiKeys?.openai) return 'openai';
      if (apiKeys?.gemini) return 'gemini-free';
    } catch (_) {}

    // Last-resort fallback; generation will still surface a clear error if unavailable.
    return 'openai';
  }

  async updateProviderWarning() {
    const warning = document.getElementById('api-key-warning');
    if (!this.hasAnyConfiguredProviders) {
      warning.classList.add('hidden');
      this.providerIsReady = false;
      this.updateWizardReadiness();
      return;
    }
    const provider = this.settings.activeTextProvider;

    const requiresKey = provider === 'gemini-free' || provider === 'openai' || provider === 'openrouter' || provider === 'huggingface';
    if (!requiresKey) {
      warning.classList.add('hidden');
      this.providerIsReady = true;
      this.updateWizardReadiness();
      return;
    }

    try {
      const { apiKeys, providerValidation } = await chrome.storage.local.get(['apiKeys', 'providerValidation']);
      const providerKeyMap = {
        'gemini-free': 'gemini',
        'openai': 'openai',
        'openrouter': 'openrouter',
        'huggingface': 'huggingface'
      };
      const keyName = providerKeyMap[provider];
      const hasKey = Boolean(apiKeys && apiKeys[keyName]);
      const hasValidationRecord = Boolean(providerValidation && Object.keys(providerValidation).length);
      const isValidated = Boolean(providerValidation && providerValidation[keyName] && providerValidation[keyName].valid);
      const isReady = hasKey && (isValidated || !hasValidationRecord);

      this.providerIsReady = isReady;
      if (isReady) {
        warning.classList.add('hidden');
      } else {
        warning.classList.remove('hidden');
      }
      this.updateWizardReadiness();
    } catch (error) {
      console.error('Failed to check API key status:', error);
      warning.classList.remove('hidden');
      this.providerIsReady = false;
      this.updateWizardReadiness();
    }
  }

  updateWizardReadiness() {
    const contentStep = document.getElementById('wizard-step-content');
    const settingsStep = document.getElementById('wizard-step-settings');
    const generateStep = document.getElementById('wizard-step-generate');
    const readinessBox = document.getElementById('wizard-readiness');
    const readinessText = document.getElementById('wizard-readiness-text');
    if (!readinessBox || !readinessText) return;

    const manualMode = this.isManualComposerMode();
    const sourceBusy = !manualMode && Number(this.storyDetectionInFlight || 0) > 0;
    const contentReady = !sourceBusy && Boolean(this.extractedText && this.extractedText.length >= 50);
    const styleReady = true;
    const providerReady = this.hasAnyConfiguredProviders && (this.providerIsReady !== false);
    const settingsReady = providerReady && styleReady;
    const canGenerate = contentReady && settingsReady;
    const issues = [];
    if (sourceBusy) {
      issues.push('Story selection is being updated, please wait');
    } else if (!contentReady) {
      issues.push(
        manualMode
          ? 'Paste or type at least 50 characters in Story Text'
          : this.getSelectedContentSource() === 'selection'
          ? 'Highlight text on the page to continue'
          : 'Wait for top stories to be detected or choose highlighted text'
      );
    }
    if (!this.hasAnyConfiguredProviders) issues.push('Connect a model provider in Settings');
    else if (!providerReady) issues.push('Finish provider setup in Settings');
    if (!styleReady) issues.push('Complete style details');
    this.lastWizardReadiness = { contentReady, settingsReady, canGenerate, issues, sourceBusy, manualMode };
    const canonicalText = this.getReadinessGuidance({
      canGenerate,
      contentReady,
      providerReady,
      hasAnyConfiguredProviders: this.hasAnyConfiguredProviders
    });
    this.updateQuickReadinessChips({ contentReady, settingsReady, canGenerate }, canonicalText);
    this.updateReadinessActionControl(this.lastWizardReadiness);
    const quickChips = document.getElementById('quick-readiness-chips');
    if (quickChips) quickChips.classList.toggle('hidden', canGenerate);

    [contentStep, settingsStep, generateStep]
      .filter(Boolean)
      .forEach((step) => {
        step.classList.remove('is-complete', 'is-warning');
      });

    if (contentStep) {
      if (contentReady) contentStep.classList.add('is-complete');
      else contentStep.classList.add('is-warning');
    }
    if (settingsStep) {
      if (settingsReady) settingsStep.classList.add('is-complete');
      else settingsStep.classList.add('is-warning');
    }
    if (generateStep) {
      if (canGenerate) generateStep.classList.add('is-complete');
      else generateStep.classList.add('is-warning');
    }

    readinessBox.classList.remove('ready', 'warn');
    const generateBtn = document.getElementById('generate-btn');
    const configureProvidersCta = document.getElementById('configure-providers-cta');
    if (generateBtn && !this.isGenerating) {
      generateBtn.disabled = !canGenerate;
      generateBtn.title = canGenerate ? '' : ('Next step: ' + issues.join('; '));
    }
    if (configureProvidersCta) {
      configureProvidersCta.classList.toggle('hidden', this.hasAnyConfiguredProviders);
    }
    const providersHint = document.getElementById('configure-providers-hint');
    if (providersHint) providersHint.classList.toggle('hidden', this.hasAnyConfiguredProviders);
    this.refreshSelectionFallbackUI();

    const mainVisible = !document.getElementById('main-section')?.classList.contains('hidden');
    if (mainVisible && !this.isGenerating) {
      const shouldOpenOptions = !settingsReady && !this.userCollapsedOptions && !this.autoExpandedOptionsOnce;
      if (shouldOpenOptions) {
        this.setExtraSectionOpen('options-extra-section', true);
        this.autoExpandedOptionsOnce = true;
      }
    }

    if (canGenerate) {
      readinessBox.classList.add('hidden');
      readinessBox.classList.add('ready');
      readinessText.textContent = canonicalText;
      this.lastReadinessState = { contentReady, settingsReady, canGenerate };
      return;
    }

    readinessBox.classList.remove('hidden');
    readinessBox.classList.add('warn');
    readinessText.textContent = canonicalText;
    this.lastReadinessState = { contentReady, settingsReady, canGenerate };
  }

  getReadinessGuidance(state) {
    if (state?.canGenerate) return 'Ready to generate.';
    if (state?.sourceBusy) return 'Story analysis in progress. Please wait a moment.';
    if (!state?.hasAnyConfiguredProviders) return 'Connect a model provider in Settings to continue.';
    if (!state?.providerReady) return 'Complete provider setup in Settings.';
    if (!state?.contentReady) {
      if (this.isManualComposerMode()) {
        return 'Paste or type story text (minimum 50 characters).';
      }
      if (this.getSelectedContentSource() === 'selection') {
        return 'Select text on the page, then click Re-scan.';
      }
      return 'Analyzing page content. Please wait.';
    }
    return 'Review settings, then generate.';
  }

  async saveSettings() {
    try {
      await chrome.storage.local.set({ settings: this.settings });
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  reportUserError(title, details) {
    void this.appendDebugLog('ui.error.alert', { title: title, details: details || null });
    if (this.settings.debugFlag && details) {
      alert(title + '\n\n' + details);
      return;
    }
    alert(title);
  }

  reportCompletedWithWarnings(job) {
    var panelErrors = (job && job.panelErrors) || [];
    if (!panelErrors.length) return;
    var verboseTestLogs = Boolean(globalThis && globalThis.__WEB2COMICS_TEST_LOGS__);
    void this.appendDebugLog('generation.completed_with_warnings', {
      panelErrors: panelErrors
    });

    var summary = 'Comic created, but some panels failed to render (' + panelErrors.length + ').';
    if (!this.settings.debugFlag && !verboseTestLogs) {
      summary += '\n\nEnable "Debug flag" in Settings to see error details.';
      alert(summary);
      return;
    }

    var details = panelErrors
      .slice(0, 5)
      .map(function(err) { return (err.panelId || ('panel_' + (err.panelIndex + 1))) + ': ' + err.message; })
      .join('\n');

    if (panelErrors.length > 5) {
      details += '\n...and ' + (panelErrors.length - 5) + ' more';
    }

    alert(summary + '\n\n' + details);
  }

  async completeOnboarding() {
    // Legacy no-op path retained for compatibility with older tests/buttons.
    this.showHome();
  }

  showHome() {
    document.getElementById('onboarding-section')?.classList.add('hidden');
    document.getElementById('progress-section')?.classList.add('hidden');
    document.getElementById('main-section')?.classList.add('hidden');
    document.getElementById('home-section')?.classList.remove('hidden');
    this.storyDetectionInFlight = 0;
    this.setStoryDetectionProgress(false);
  }

  showCreateComposer(mode = 'page') {
    document.getElementById('onboarding-section')?.classList.add('hidden');
    document.getElementById('home-section')?.classList.add('hidden');
    document.getElementById('progress-section')?.classList.add('hidden');
    document.getElementById('main-section')?.classList.remove('hidden');
    if (!this.lastReadinessState) {
      this.setExtraSectionOpen('content-extra-section', false);
      this.setExtraSectionOpen('options-extra-section', false);
    }
    this.setComposerMode(mode);
    this.updateFirstRunVisibility();
    this.refreshSelectionFallbackUI();
    this.updateWizardReadiness();
    if (this.isManualComposerMode()) {
      document.getElementById('manual-story-input')?.focus();
    } else {
      document.getElementById('generate-btn')?.focus();
    }
  }

  async openCollectionViewFromLauncher() {
    const opened = await this.openSidePanel({ userInitiated: true, initialView: 'history' });
    if (opened) this.closePopupWindow();
  }

  async handleHistoryFooterClick() {
    const composerVisible = !document.getElementById('main-section')?.classList.contains('hidden');
    if (composerVisible) {
      await this.openCollectionViewFromLauncher();
      return;
    }
    await this.showHistory();
  }

  async startGeneration() {
    if (this.isGenerating) return;

    this.normalizePanelCountSetting();
    const panelSelect = document.getElementById('panel-count');
    if (panelSelect) {
      const uiPanelCount = parseInt(panelSelect.value, 10);
      if (Number.isFinite(uiPanelCount)) {
        this.settings.panelCount = uiPanelCount;
      }
    }

    if (!this.lastWizardReadiness.canGenerate) {
      const issues = (this.lastWizardReadiness.issues || []).length
        ? this.lastWizardReadiness.issues
        : ['Select article content and provider settings'];
      this.reportUserError(
        'Cannot start generation yet. Next step: ' + issues.join('; '),
        'Fix these items first:\n- ' + issues.join('\n- ')
      );
      return;
    }
    
    if (!this.extractedText || this.extractedText.length < 50) {
      alert('Please ensure there is enough content to generate a comic.');
      return;
    }
    
    this.isGenerating = true;
    this.showProgress();
    void this.trackMetric('generation_start', {
      objective: this.settings.objective || 'explain-like-im-five',
      provider_text: this.settings.activeTextProvider,
      provider_image: this.settings.activeImageProvider,
      domain: (() => {
        try { return new URL(String(this.currentPageUrl || '')).hostname || ''; } catch (_) { return ''; }
      })()
    });
    void this.appendDebugLog('generation.start.clicked', {
      providerText: this.settings.activeTextProvider,
      providerImage: this.settings.activeImageProvider,
      textChars: this.extractedText.length
    });
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const resolvedStyle = this.getResolvedStylePayload();
    const selectedTextModel = this.getSelectedTextModelForProvider(this.settings.activeTextProvider);
    const selectedImageModel = this.getSelectedImageModelForProvider(this.settings.activeImageProvider);
    const selectedImageQuality = this.getSelectedImageQualityForProvider(this.settings.activeImageProvider);
    const selectedImageSize = this.getSelectedImageSizeForProvider(this.settings.activeImageProvider);
    const isManualSource = this.isManualComposerMode();
    const manualStoryText = isManualSource ? String(this.extractedText || '').trim() : '';
    const manualStoryTitle = isManualSource ? this.deriveManualStoryTitle(manualStoryText) : '';
    const sourceUrl = isManualSource ? '' : String(tab?.url || this.currentPageUrl || '');
    const sourceTitle = isManualSource
      ? manualStoryTitle
      : String(this.selectedStoryTitle || tab?.title || 'Untitled');
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'START_GENERATION',
        payload: {
          text: this.extractedText,
          url: sourceUrl,
          title: sourceTitle,
          sourceMode: isManualSource ? 'manual' : 'page',
          manualSourceText: manualStoryText,
          manualSourceTitle: manualStoryTitle,
          settings: {
            panel_count: this.settings.panelCount,
            objective: this.settings.objective || 'explain-like-im-five',
            output_language: this.settings.outputLanguage || 'en',
            detail_level: this.settings.detailLevel,
            style_id: resolvedStyle.styleId,
            caption_len: 'short',
            provider_text: this.settings.activeTextProvider,
            provider_image: this.settings.activeImageProvider,
            text_model: selectedTextModel,
            image_model: selectedImageModel,
            image_quality: selectedImageQuality,
            image_size: selectedImageSize,
            custom_style_theme: resolvedStyle.customStyleTheme || '',
            custom_style_name: resolvedStyle.customStyleName || '',
            debug_flag: !!this.settings.debugFlag,
            image_refusal_handling: this.settings.imageRefusalHandling || 'rewrite_and_retry',
            show_rewritten_badge: this.settings.showRewrittenBadge !== false,
            log_rewritten_prompts: !!this.settings.logRewrittenPrompts
          }
        }
      });
      
      if (response && response.success) {
        this.currentJobId = response.jobId;
        void this.appendDebugLog('generation.start.accepted', { jobId: response.jobId, response: response });
        if (this.settings.autoOpenSidePanel !== false) {
          try {
            await this.openSidePanel({ userInitiated: false });
            void this.appendDebugLog('generation.viewer_opened_auto_progress', { jobId: response.jobId });
          } catch (openError) {
            console.error('Failed to auto-open viewer on generation start:', openError);
            void this.appendDebugLog('generation.viewer_opened_auto_progress.error', {
              message: openError && openError.message ? openError.message : String(openError)
            });
          }
        }
        this.startProgressPolling();
      } else {
        throw new Error(response?.error || 'Generation failed to start');
      }
    } catch (error) {
      console.error('Generation error:', error);
      this.hideProgress();
      this.isGenerating = false;
      this.reportUserError('Failed to start generation: ' + error.message, error && error.stack ? error.stack : '');
    }
  }

  getSelectedTextModelForProvider(providerId) {
    switch (providerId) {
      case 'openai':
        return this.settings.textModel || 'gpt-4o-mini';
      case 'gemini-free':
        return this.settings.geminiTextModel || 'gemini-2.5-flash';
      case 'cloudflare-free':
        return this.settings.cloudflareTextModel || '@cf/meta/llama-3.1-8b-instruct';
      case 'openrouter':
        return this.settings.openrouterTextModel || 'openai/gpt-oss-20b:free';
      case 'huggingface':
        return this.settings.huggingfaceTextModel || 'mistralai/Mistral-7B-Instruct-v0.2';
      default:
        return this.settings.textModel || '';
    }
  }

  getSelectedImageModelForProvider(providerId) {
    switch (providerId) {
      case 'openai':
        return this.settings.imageModel || 'dall-e-2';
      case 'gemini-free':
        return this.settings.geminiImageModel || 'gemini-2.0-flash-exp-image-generation';
      case 'cloudflare-free':
        return this.settings.cloudflareImageModel || '@cf/black-forest-labs/flux-1-schnell';
      case 'openrouter':
        return this.settings.openrouterImageModel || 'google/gemini-2.5-flash-image-preview';
      case 'huggingface':
        return this.settings.huggingfaceImageModel || 'black-forest-labs/FLUX.1-schnell';
      default:
        return this.settings.imageModel || '';
    }
  }

  getSelectedImageQualityForProvider(providerId) {
    switch (providerId) {
      case 'openai':
        return this.settings.openaiImageQuality || 'standard';
      case 'huggingface':
        return this.settings.huggingfaceImageQuality || 'fastest';
      default:
        return '';
    }
  }

  getSelectedImageSizeForProvider(providerId) {
    switch (providerId) {
      case 'openai':
        return this.settings.openaiImageSize || '256x256';
      case 'openrouter':
        return this.settings.openrouterImageSize || '1K';
      case 'huggingface':
        return this.settings.huggingfaceImageSize || '512x512';
      default:
        return '';
    }
  }

  showProgress() {
    document.getElementById('home-section')?.classList.add('hidden');
    document.getElementById('main-section')?.classList.add('hidden');
    document.getElementById('progress-section')?.classList.remove('hidden');
    if (document.getElementById('progress-status')) {
      document.getElementById('progress-status').textContent = 'Preparing...';
    }
    if (document.getElementById('progress-status-detail')) {
      document.getElementById('progress-status-detail').textContent = 'Elapsed 0s | Waiting for updates...';
    }
    if (document.getElementById('progress-caption-quality')) {
      document.getElementById('progress-caption-quality').textContent = '';
      document.getElementById('progress-caption-quality').classList.add('hidden');
    }
    this.progressStartedAtMs = Date.now();
    this.progressFirstPanelAtMs = 0;
    this.cancelRequestedByUser = false;
    var debugLogEl = document.getElementById('progress-debug-log');
    if (debugLogEl) {
      debugLogEl.innerHTML = '';
      debugLogEl.classList.toggle('hidden', !this.settings.debugFlag);
    }
    if (document.getElementById('progress-bar')) {
      document.getElementById('progress-bar').style.width = '0%';
    }
    if (document.getElementById('panel-progress')) {
      document.getElementById('panel-progress').innerHTML = '';
    }
    this.showComicifyProgressModal();
    if (document.getElementById('generate-btn')) {
      document.getElementById('generate-btn').disabled = true;
    }
  }

  hideProgress() {
    document.getElementById('main-section')?.classList.remove('hidden');
    document.getElementById('progress-section')?.classList.add('hidden');
    this.hideComicifyProgressModal();
    if (document.getElementById('generate-btn')) {
      document.getElementById('generate-btn').disabled = false;
      document.getElementById('generate-btn').title = '';
    }
    this.isGenerating = false;
    this.progressStartedAtMs = 0;
    this.progressFirstPanelAtMs = 0;
    this.cancelRequestedByUser = false;
    this.updateWizardReadiness();
  }

  showComicifyProgressModal() {
    const modal = document.getElementById('comicify-progress-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const subtitle = document.getElementById('comicify-progress-subtitle');
    const detail = document.getElementById('comicify-progress-detail');
    const percent = document.getElementById('comicify-progress-percent');
    const bar = document.getElementById('comicify-progress-bar');
    const emoji = document.getElementById('comicify-progress-emoji');
    if (subtitle) subtitle.textContent = 'Warming up your storyboards...';
    if (detail) detail.textContent = 'Elapsed 0s | Waiting for updates...';
    if (percent) percent.textContent = '0%';
    if (bar) bar.style.width = '0%';
    if (emoji) emoji.textContent = '🎨';
  }

  hideComicifyProgressModal() {
    document.getElementById('comicify-progress-modal')?.classList.add('hidden');
  }

  getProgressStatusLabel(status) {
    const statusMap = {
      pending: 'Preparing...',
      generating_text: 'Generating storyboard...',
      generating_images: 'Rendering comic panels...',
      completed: 'Complete!',
      failed: 'Failed',
      canceled: 'Canceled'
    };
    return statusMap[status] || 'Processing...';
  }

  updateComicifyProgressModal(job, panelCount) {
    const title = document.getElementById('comicify-progress-title');
    const subtitle = document.getElementById('comicify-progress-subtitle');
    const detail = document.getElementById('comicify-progress-detail');
    const percentEl = document.getElementById('comicify-progress-percent');
    const bar = document.getElementById('comicify-progress-bar');
    const emoji = document.getElementById('comicify-progress-emoji');
    if (!title && !subtitle && !detail && !percentEl && !bar && !emoji) return;

    const status = String(job?.status || '').toLowerCase();
    const totalPanels = Math.max(0, Number(panelCount || 0));
    const completedPanels = Math.max(0, Number(job?.completedPanels || 0));
    let percent = 0;
    if (status === 'completed') {
      percent = 100;
    } else if (totalPanels > 0) {
      percent = Math.max(0, Math.min(99, Math.round((completedPanels / totalPanels) * 100)));
    } else if (status === 'generating_text') {
      percent = 12;
    } else if (status === 'pending') {
      percent = 4;
    }

    const playfulSubtitleMap = {
      pending: 'Sharpening pencils and checking colors...',
      generating_text: 'Finding the best story beats...',
      generating_images: 'Drawing panel magic...',
      completed: 'Your comic is ready!',
      failed: 'That run stumbled. Try again.',
      canceled: 'Comicify stopped.'
    };
    const emojiMap = {
      pending: '🧭',
      generating_text: '🧠',
      generating_images: '🖌️',
      completed: '✅',
      failed: '⚠️',
      canceled: '⏹️'
    };

    if (title) title.textContent = this.getProgressStatusLabel(status);
    if (subtitle) subtitle.textContent = playfulSubtitleMap[status] || 'Working on your comic...';
    if (detail) detail.textContent = this.buildProgressTimingDetail(job, panelCount);
    if (percentEl) percentEl.textContent = percent + '%';
    if (bar) bar.style.width = percent + '%';
    if (emoji) emoji.textContent = emojiMap[status] || '🎨';
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

  buildProgressTimingDetail(job, panelCount) {
    const now = Date.now();
    const startedAtMs = this.progressStartedAtMs || now;
    const elapsedMs = Math.max(0, now - startedAtMs);
    const totalPanels = Math.max(0, panelCount || 0);
    const completedPanels = Math.max(0, Number(job?.completedPanels || 0));
    const currentIndex = Math.max(0, Number(job?.currentPanelIndex || 0));
    const retryState = job && job.retryState ? job.retryState : null;
    let phaseText = 'Waiting for updates...';

    if (job.status === 'generating_text') {
      phaseText = 'Building storyboard';
    } else if (job.status === 'generating_images') {
      if (totalPanels > 0) {
        const activePanel = Math.min(totalPanels, currentIndex + 1);
        phaseText = `Rendering panels (${completedPanels}/${totalPanels} done, panel ${activePanel}/${totalPanels} active)`;
      } else {
        phaseText = 'Rendering comic panels';
      }
    } else if (job.status === 'completed') {
      phaseText = totalPanels > 0 ? `Completed (${totalPanels}/${totalPanels} panels)` : 'Completed';
    } else if (job.status === 'failed') {
      phaseText = 'Failed';
    } else if (job.status === 'canceled') {
      phaseText = 'Canceled';
    } else if (job.status === 'pending') {
      phaseText = 'Preparing generation job';
    }

    if (job.status === 'generating_images' && retryState && retryState.delayMs > 0) {
      const retryAtMs = retryState.retryAt ? new Date(retryState.retryAt).getTime() : (now + Number(retryState.delayMs || 0));
      const remainingMs = Math.max(0, retryAtMs - now);
      const providerLabel = getProviderDisplayLabel(retryState.provider);
      if (retryState.type === 'rate_limit') {
        phaseText = `Rate limited by ${providerLabel}; retrying panel ${(Number(retryState.panelIndex) || 0) + 1} in ${this.formatDurationShort(remainingMs)}`;
      } else {
        phaseText = `Retrying panel ${(Number(retryState.panelIndex) || 0) + 1} after temporary error (${this.formatDurationShort(remainingMs)})`;
      }
    }

    if (!this.progressFirstPanelAtMs && completedPanels >= 1) {
      this.progressFirstPanelAtMs = now;
    }

    let etaText = 'ETA: calculating...';
    if (job.status === 'completed') {
      etaText = 'ETA: done';
    } else if (job.status === 'failed' || job.status === 'canceled') {
      etaText = 'ETA: n/a';
    } else if (totalPanels > 0 && completedPanels >= 1) {
      const remainingPanels = Math.max(0, totalPanels - completedPanels);
      const perPanelMs = elapsedMs / completedPanels;
      const etaMs = Math.max(0, remainingPanels * perPanelMs);
      etaText = 'ETA: ~' + this.formatDurationShort(etaMs);
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

  startProgressPolling() {
    var lastStatus = null;
    var consecutiveReadErrors = 0;
    const pollInterval = setInterval(async () => {
      if (!this.isGenerating) {
        clearInterval(pollInterval);
        return;
      }
      
      try {
        const storageResult = await chrome.storage.local.get('currentJob');
        const currentJob = storageResult && storageResult.currentJob;
        
        if (!currentJob) {
          clearInterval(pollInterval);
          return;
        }
        
        consecutiveReadErrors = 0;
        try {
          this.updateProgressUI(currentJob);
        } catch (uiError) {
          console.error('Progress UI render error:', uiError);
          void this.appendDebugLog('generation.progress_ui.error', {
            message: uiError.message || String(uiError)
          });
          const statusEl = document.getElementById('progress-status');
          if (statusEl) {
            statusEl.textContent = (currentJob.status || 'Processing') + '...';
          }
        }
        if (currentJob.status !== lastStatus) {
          lastStatus = currentJob.status;
          void this.appendDebugLog('generation.status', {
            status: currentJob.status,
            completedPanels: currentJob.completedPanels,
            currentPanelIndex: currentJob.currentPanelIndex
          });
        }
        
        if (currentJob.status === 'completed') {
          clearInterval(pollInterval);
          if (!this.hasCompletedFirstGeneration) {
            this.hasCompletedFirstGeneration = true;
            await chrome.storage.local.set({ firstSuccessfulGenerationAt: new Date().toISOString() });
          }
          this.reportCompletedWithWarnings(currentJob);
          this.hideProgress();
          this.isGenerating = false;
          this.showHome();
          if (document.getElementById('open-viewer-btn')) {
            document.getElementById('open-viewer-btn').disabled = false;
          }
          await this.addToHistory(currentJob);
          try {
            // Completion behavior: move user to viewer-only mode.
            const opened = await this.openSidePanel({ userInitiated: false });
            void this.appendDebugLog('generation.viewer_opened_auto', { jobId: currentJob.id || null, opened: !!opened });
          } catch (openError) {
            console.error('Failed to auto-open comic viewer:', openError);
            void this.appendDebugLog('generation.viewer_opened_auto.error', {
              message: openError && openError.message ? openError.message : String(openError)
            });
          } finally {
            this.closePopupWindow();
          }
          void this.appendDebugLog('generation.completed', {
            panels: currentJob.storyboard?.panels?.length || 0,
            panelErrors: currentJob.panelErrors?.length || 0
          });
        } else if (currentJob.status === 'failed' || currentJob.status === 'canceled') {
          clearInterval(pollInterval);
          const userCanceled = currentJob.status === 'canceled' && this.cancelRequestedByUser;
          this.hideProgress();
          this.isGenerating = false;
          var fallbackMessage = currentJob.status === 'canceled'
            ? 'Generation was canceled.'
            : 'Generation failed. No error details were provided.';
          var message = currentJob.error ? ('Generation failed: ' + currentJob.error) : fallbackMessage;
          if (!userCanceled) {
            this.reportUserError(message, currentJob.errorDetails || '');
          } else {
            void this.appendDebugLog('generation.canceled.user', { jobId: currentJob.id || null });
          }
          this.cancelRequestedByUser = false;
          this.showHome();
        }
      } catch (error) {
        console.error('Poll error:', error);
        consecutiveReadErrors += 1;
        void this.appendDebugLog('generation.progress_read.error', {
          count: consecutiveReadErrors,
          message: error.message || String(error)
        });
        if (consecutiveReadErrors >= 3) {
          this.reportUserError('Failed to read generation progress.', error && error.stack ? error.stack : error.message);
          clearInterval(pollInterval);
          this.hideProgress();
        }
      }
    }, 500);
  }

  updateProgressUI(job) {
    const statusEl = document.getElementById('progress-status');
    const statusDetailEl = document.getElementById('progress-status-detail');
    const captionQualityEl = document.getElementById('progress-caption-quality');
    const progressBar = document.getElementById('progress-bar');
    const panelProgress = document.getElementById('panel-progress');
    const debugLogEl = document.getElementById('progress-debug-log');
    
    if (statusEl) {
      statusEl.textContent = this.getProgressStatusLabel(job.status);
    }
    if (debugLogEl) {
      debugLogEl.classList.toggle('hidden', !this.settings.debugFlag);
      if (this.settings.debugFlag) {
        var events = Array.isArray(job.progressEvents) ? job.progressEvents.slice(-8) : [];
        debugLogEl.innerHTML = events.map(function(evt) {
          var time = '';
          try {
            time = new Date(evt.ts).toLocaleTimeString();
          } catch (e) {}
          return `
            <div class="progress-debug-item">
              <span class="progress-debug-time">${time}</span>
              <span>${evt.message || evt.type || 'Event'}</span>
              ${evt.detail ? `<span class="progress-debug-detail">${evt.detail}</span>` : ''}
            </div>
          `;
        }).join('');
      }
    }
    
    const panels = Array.isArray(job?.storyboard?.panels) ? job.storyboard.panels : null;
    const panelCount = panels ? panels.length : (job?.settings?.panel_count || 0);
    this.updateComicifyProgressModal(job, panelCount);
    if (statusDetailEl) {
      statusDetailEl.textContent = this.buildProgressTimingDetail(job, panelCount);
    }
    if (captionQualityEl) {
      const captionSummary = this.settings.debugFlag ? this.buildCaptionQualitySummary(job) : '';
      captionQualityEl.textContent = captionSummary;
      captionQualityEl.classList.toggle('hidden', !captionSummary);
    }
    if (panels) {
      const totalPanels = panels.length;
      const completed = job.completedPanels ?? 0;
      const percent = job.status === 'completed'
        ? 100
        : Math.round((completed / Math.max(totalPanels, 1)) * 100);
      if (progressBar) {
        progressBar.style.width = percent + '%';
      }
      
      if (!panelProgress) return;
      panelProgress.innerHTML = panels.map((panel, index) => {
        const safePanel = panel && typeof panel === 'object' ? panel : {};
        const isComplete = Boolean(safePanel.artifacts?.image_blob_ref) || (job.status === 'completed' && index < completed);
        const hasError = Boolean(safePanel.artifacts?.error);
        const isGenerating =
          job.status === 'generating_images' &&
          index === (job.currentPanelIndex ?? 0) &&
          !isComplete &&
          !hasError;

        const statusClass = hasError ? 'error' : isComplete ? 'done' : isGenerating ? 'generating' : 'pending';
        const statusText = hasError
          ? 'Error'
          : isComplete
            ? '✓ Done'
            : isGenerating
              ? 'Rendering...'
              : job.status === 'generating_text'
                ? 'Queued'
                : 'Waiting...';
        
        const safeCaption = this.escapeHtml(safePanel.caption || `Panel ${index + 1}`);
        return `
          <div class="panel-item">
            <div class="panel-thumb">
              ${safePanel.artifacts?.image_blob_ref 
                ? `<img src="${safePanel.artifacts.image_blob_ref}" alt="Panel ${index + 1}">`
                : hasError
                  ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 16h.01"/></svg>`
                  : isGenerating
                    ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2"><circle cx="12" cy="12" r="9" opacity="0.35"/><path d="M12 6v6l4 2"/></svg>`
                    : `<svg width="24" height="24" fill="var(--text-muted)"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`
              }
            </div>
            <div class="panel-info">
              <div class="panel-caption">${safeCaption}</div>
              <div class="panel-status ${statusClass}">
                ${statusText}
              </div>
            </div>
          </div>
        `;
      }).join('');
    } else if (job.status === 'generating_text') {
      if (progressBar) {
        progressBar.style.width = '10%';
      }
      if (panelProgress) {
        panelProgress.innerHTML = `
        <div class="panel-item">
          <div class="panel-thumb">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2">
              <circle cx="12" cy="12" r="9" opacity="0.35"/>
              <path d="M12 6v6l4 2"/>
            </svg>
          </div>
          <div class="panel-info">
            <div class="panel-caption">Storyboard</div>
            <div class="panel-status generating">Analyzing page and writing panel beats...</div>
          </div>
        </div>
      `;
      }
    }
  }

  async cancelGeneration() {
    try {
      this.cancelRequestedByUser = true;
      const cancelBtn = document.getElementById('cancel-btn');
      if (cancelBtn) cancelBtn.disabled = true;
      const statusEl = document.getElementById('progress-status');
      const detailEl = document.getElementById('progress-status-detail');
      if (statusEl) statusEl.textContent = 'Canceling...';
      if (detailEl) detailEl.textContent = 'Waiting for provider requests to stop...';
      await chrome.runtime.sendMessage({ type: 'CANCEL_GENERATION' });
    } catch (error) {
      console.error('Cancel error:', error);
      this.cancelRequestedByUser = false;
      const cancelBtn = document.getElementById('cancel-btn');
      if (cancelBtn) cancelBtn.disabled = false;
    }
  }

  async openSidePanel(options = {}) {
    const userInitiated = !!(options && options.userInitiated);
    const requestedView = String(options && options.initialView ? options.initialView : '').trim().toLowerCase();
    const initialView = requestedView === 'history' || requestedView === 'comic' ? requestedView : '';
    const sidePanelPath = initialView ? `sidepanel/sidepanel.html?view=${initialView}` : 'sidepanel/sidepanel.html';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (initialView) {
        try {
          await chrome.storage.local.set({ sidepanelInitialView: initialView });
        } catch (_) {}
      }
      await chrome.sidePanel.open({ tabId: tab.id });
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: sidePanelPath
      });
      return true;
    } catch (error) {
      const message = error && error.message ? error.message : String(error || '');
      if (!userInitiated && /user gesture/i.test(message)) {
        void this.appendDebugLog('sidepanel.open.skipped.user_gesture_required', { message });
        return false;
      }
      console.error('Failed to open side panel:', error);
      try {
        window.open(sidePanelPath, '_blank');
      } catch (_) {}
      return false;
    }
  }

  openOptions() {
    this.lastOptionsOpenTs = Date.now();
    chrome.runtime.openOptionsPage();
  }

  closePopupWindow() {
    try {
      window.close();
    } catch (_) {}
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

  getHistoryImageSources(item, maxCount = 4) {
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
    return images.slice(0, limit);
  }

  renderHistoryThumbMarkup(item) {
    const images = this.getHistoryImageSources(item, 4);
    if (!images.length) {
      return '<div class="history-thumb-empty" aria-hidden="true">No image</div>';
    }
    if (images.length === 1) {
      const src = this.escapeHtml(images[0]);
      return `<img src="${src}" alt="Comic thumbnail">`;
    }
    const collageCells = images.slice(0, 4).map((src) =>
      `<span class="history-thumb-cell"><img src="${this.escapeHtml(src)}" alt=""></span>`
    ).join('');
    return `<div class="history-thumb-collage" aria-hidden="true">${collageCells}</div>`;
  }

  async showHistory() {
    const modal = document.getElementById('history-modal');
    const list = document.getElementById('history-list');
    try {
      const { history, historyThumbnails } = await chrome.storage.local.get(['history', 'historyThumbnails']);
      const thumbMap = (historyThumbnails && typeof historyThumbnails === 'object') ? historyThumbnails : {};
      const items = (Array.isArray(history) ? history : []).map((item) => {
        const id = String(item && item.id || '').trim();
        if (!id) return item;
        const mapped = this.resolveImageSourceValue(thumbMap[id]);
        if (!mapped || this.resolveImageSourceValue(item?.thumbnail)) return item;
        return {
          ...(item || {}),
          thumbnail: mapped
        };
      });
      void this.appendDebugLog('history.open', { count: items.length });
      
      if (items.length === 0) {
        list.innerHTML = '<p class="empty-state">No comics generated yet</p>';
      } else {
        list.innerHTML = items.slice(0, 10).map(item => {
          var sourceTitle = item && item.source && item.source.title ? item.source.title : 'Untitled';
          var generatedAt = item && item.generated_at ? new Date(item.generated_at) : null;
          var dateText = generatedAt && !isNaN(generatedAt.getTime())
            ? generatedAt.toLocaleString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
            : 'Unknown date';
          var itemId = item && item.id ? item.id : '';
          var safeSourceTitle = this.escapeHtml(sourceTitle);
          var safeItemId = this.escapeHtml(itemId);
          var thumbMarkup = this.renderHistoryThumbMarkup(item);
          return `
            <div class="history-item" data-id="${safeItemId}">
              <div class="history-thumb">
                ${thumbMarkup}
              </div>
              <div class="history-info">
                <div class="history-title">${safeSourceTitle}</div>
                <div class="history-meta">${this.escapeHtml(dateText)}</div>
              </div>
              <button
                type="button"
                class="history-item-delete-btn"
                data-action="delete-history-item"
                aria-label="Delete comic from My Collection"
                title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 7h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  <path d="M7 7l1 12a1 1 0 0 0 1 .9h6a1 1 0 0 0 1-.9L17 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  <path d="M10 11v5M14 11v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          `;
        }).join('');
        
        list.querySelectorAll('.history-item').forEach(el => {
          el.addEventListener('click', (event) => {
            if (event?.target?.closest?.('.history-item-delete-btn')) return;
            void this.appendDebugLog('history.item.click', { id: el.dataset.id || null });
            const selectedId = el.dataset.id || null;
            chrome.storage.local.set({ selectedHistoryComicId: selectedId }).catch(() => {});
            this.openSidePanel({ userInitiated: true }).then((opened) => {
              if (opened) this.closePopupWindow();
            });
            this.hideHistory();
          });
        });

        list.querySelectorAll('.history-item-delete-btn').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const itemEl = e.currentTarget.closest('.history-item');
            const itemId = itemEl && itemEl.dataset ? itemEl.dataset.id : '';
            if (!itemId) return;
            if (!confirm('Delete this comic from My Collection?')) return;
            const { history: currentHistory } = await chrome.storage.local.get('history');
            const nextHistory = (Array.isArray(currentHistory) ? currentHistory : []).filter((h) => h && h.id !== itemId);
            const payload = { history: nextHistory };
            try {
              const { historyThumbnails: currentThumbs } = await chrome.storage.local.get('historyThumbnails');
              const nextThumbs = { ...((currentThumbs && typeof currentThumbs === 'object') ? currentThumbs : {}) };
              delete nextThumbs[itemId];
              payload.historyThumbnails = nextThumbs;
            } catch (_) {}
            const { selectedHistoryComicId } = await chrome.storage.local.get('selectedHistoryComicId');
            if (selectedHistoryComicId === itemId) payload.selectedHistoryComicId = null;
            await chrome.storage.local.set(payload);
            void this.appendDebugLog('history.item.deleted', { id: itemId, via: 'popup' });
            await this.showHistory();
          });
        });
      }
      
      modal.classList.remove('hidden');
    } catch (error) {
      console.error('Failed to open My Collection:', error);
      void this.appendDebugLog('history.open.error', { message: error.message });
      this.reportUserError('Failed to open My Collection.', error && error.stack ? error.stack : error.message);
    }
  }

  hideHistory() {
    document.getElementById('history-modal').classList.add('hidden');
  }

  async clearHistory() {
    if (confirm('Are you sure you want to clear all items from My Collection?')) {
      await chrome.storage.local.set({ history: [] });
      void this.appendDebugLog('history.cleared');
      this.showHistory();
    }
  }

  async addToHistory(job) {
    // History persistence is handled by the service worker on completion.
    // Keep this method as a lightweight hook for compatibility and logging.
    if (!job || !job.id) return;
    void this.appendDebugLog('history.added', { id: job.id, via: 'service-worker' });
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  const controller = new PopupController();
  if (typeof window !== 'undefined') {
    window.__popupController = controller;
  }
});
