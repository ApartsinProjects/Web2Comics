// Keep runtime defaults local to avoid importing shared/types.js, which currently contains
// TypeScript-only declarations and is not executable as a browser module.
const DEFAULT_SETTINGS = {
  panelCount: 3,
  detailLevel: 'low',
  styleId: 'default',
  customStyleTheme: '',
  customStyleName: '',
  captionLength: 'short',
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
  huggingfaceTextModel: 'mistralai/Mistral-7B-Instruct-v0.2',
  huggingfaceImageModel: 'black-forest-labs/FLUX.1-schnell',
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

class PopupController {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.customStyles = [];
    this.extractedText = '';
    this.isGenerating = false;
    this.currentJobId = null;
    this.advancedSettingsExpanded = false;
    this.providerIsReady = false;
    this.lastWizardReadiness = {
      contentReady: false,
      settingsReady: false,
      canGenerate: false,
      issues: []
    };
    this.extractRetryTimer = null;
    this.extractRetryCount = 0;
    this.progressStartedAtMs = 0;
    this.progressFirstPanelAtMs = 0;
    
    this.init();
  }

  async appendDebugLog(event, data) {
    try {
      if (!this.settings.debugFlag) return;
      const entry = {
        ts: new Date().toISOString(),
        scope: 'popup',
        event: event,
        jobId: this.currentJobId || null,
        data: data || null
      };
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
    await this.loadRecommendedDefaults();
    await this.loadSettings();
    await this.loadCustomStyles();
    await this.checkOnboarding();
    await this.extractContent();
    this.bindEvents();
    this.updateUI();
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

  async extractContent(options = {}) {
    const contentSource = document.querySelector('input[name="contentSource"]:checked').value;
    const isRetry = !!options.isRetry;
    if (!isRetry) {
      this.extractRetryCount = 0;
      this.clearExtractRetry();
    }
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabStatus = tab?.status || 'unknown';
      const shouldRetryForLoading = contentSource === 'full' && tabStatus !== 'complete';
      if (shouldRetryForLoading && !isRetry) {
        this.updatePreview('Page is still loading. Waiting for content...');
      }
      
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXTRACT_CONTENT',
        payload: { mode: contentSource }
      });
      
      if (response && response.success) {
        this.extractedText = response.text;
        this.clearExtractRetry();
        this.extractRetryCount = 0;
        this.updatePreview(response.text);
        void this.appendDebugLog('content.extract.success', {
          chars: response.text ? response.text.length : 0,
          mode: contentSource,
          tabStatus: tabStatus,
          retry: isRetry
        });
      } else {
        var failureMessage = response?.error || 'Failed to extract content';
        this.extractedText = '';
        this.updatePreview(response?.error || 'Failed to extract content');
        void this.appendDebugLog('content.extract.failure', {
          mode: contentSource,
          error: failureMessage,
          tabStatus: tabStatus,
          retry: isRetry
        });

        if (
          contentSource === 'full' &&
          (tabStatus !== 'complete' || /could not extract enough readable content/i.test(failureMessage))
        ) {
          this.scheduleExtractRetry(tabStatus !== 'complete' ? 'tab-loading' : 'not-enough-content', 1200);
        }
      }
    } catch (error) {
      console.error('Extraction error:', error);
      var message = error && error.message ? error.message : String(error);
      this.extractedText = '';
      this.updatePreview('Unable to extract content. Retrying...');
      void this.appendDebugLog('content.extract.error', { message: message, retry: isRetry });

      if (/Receiving end does not exist|Could not establish connection|The message port closed/i.test(message)) {
        this.scheduleExtractRetry('content-script-not-ready', 1000);
        return;
      }

      this.updatePreview('Unable to extract content. Try selecting text on the page.');
    }
  }

  updatePreview(text) {
    const previewEl = document.getElementById('preview-text');
    const charCountEl = document.getElementById('char-count');
    
    if (!text || text.length === 0) {
      previewEl.innerHTML = '<span class="loading">No content found</span>';
      charCountEl.textContent = '0';
      this.updateWizardReadiness();
      return;
    }
    
    const truncated = text.length > 500 ? text.substring(0, 500) + '...' : text;
    previewEl.textContent = truncated;
    charCountEl.textContent = text.length.toLocaleString();
    this.updateWizardReadiness();
  }

  bindEvents() {
    // Onboarding
    document.getElementById('onboarding-start-btn')?.addEventListener('click', () => this.completeOnboarding());
    document.getElementById('create-comic-btn')?.addEventListener('click', () => this.showCreateComposer());
    document.getElementById('view-history-btn')?.addEventListener('click', () => this.showHistory());
    document.getElementById('back-home-btn')?.addEventListener('click', () => this.showHome());
    
    // Content source change
    document.querySelectorAll('input[name="contentSource"]').forEach(radio => {
      radio.addEventListener('change', () => this.extractContent());
    });
    
    // Refresh preview
    document.getElementById('refresh-preview-btn')?.addEventListener('click', () => this.extractContent());
    
    // Settings changes
    document.getElementById('panel-count').addEventListener('change', (e) => {
      this.settings.panelCount = parseInt(e.target.value);
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
    document.getElementById('open-viewer-btn').addEventListener('click', () => this.openSidePanel());
    
    // Cancel button
    document.getElementById('cancel-btn')?.addEventListener('click', () => this.cancelGeneration());
    
    // Settings button
    document.getElementById('settings-btn').addEventListener('click', () => this.openOptions());
    
    // History
    document.getElementById('history-btn')?.addEventListener('click', () => this.showHistory());
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
    document.getElementById('detail-level').value = this.settings.detailLevel;
    this.renderStyleOptions();
    if (this.getSelectedUserStyle() || this.settings.styleId === 'custom') {
      this.setAdvancedSettingsExpanded(true);
    } else {
      this.setAdvancedSettingsExpanded(false);
    }
    void this.refreshProviderOptions().then(() => this.updateProviderWarning());
    
    this.toggleLegacyCustomStyleEditor();
    this.updateWizardReadiness();
  }

  setAdvancedSettingsExpanded(expanded) {
    const panel = document.getElementById('advanced-settings-panel');
    const toggle = document.getElementById('advanced-settings-toggle');
    if (!panel || !toggle) return;
    this.advancedSettingsExpanded = Boolean(expanded);
    panel.classList.toggle('hidden', !this.advancedSettingsExpanded);
    toggle.setAttribute('aria-expanded', this.advancedSettingsExpanded ? 'true' : 'false');
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
      opt.textContent = 'Saved: ' + style.name;
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

    const selectedUserStyle = this.getSelectedUserStyle();
    if (selectedUserStyle) {
      customStyleContainer.classList.remove('hidden');
      customStyleNameInput.value = selectedUserStyle.name || '';
      customStyleInput.value = selectedUserStyle.description || '';
      customStyleNameInput.disabled = true;
      customStyleInput.disabled = true;
      return;
    }

    customStyleNameInput.disabled = false;
    customStyleInput.disabled = false;
    if (this.settings.styleId === 'custom') {
      customStyleContainer.classList.remove('hidden');
      customStyleInput.value = this.settings.customStyleTheme || '';
      customStyleNameInput.value = this.settings.customStyleName || '';
    } else {
      customStyleContainer.classList.add('hidden');
    }
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
    try {
      const result = await chrome.storage.local.get(['apiKeys', 'providerValidation']);
      apiKeys = result && result.apiKeys ? result.apiKeys : {};
      providerValidation = result && result.providerValidation ? result.providerValidation : {};
    } catch (error) {
      console.error('Failed to load API keys for provider filtering:', error);
    }

    const visibleValues = [];
    Array.from(providerSelect.options).forEach((option) => {
      const providerId = option.value;
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

    let nextProvider = this.settings.activeTextProvider;
    if (!visibleValues.includes(nextProvider)) {
      nextProvider = visibleValues[0] || 'cloudflare-free';
      this.settings.activeTextProvider = nextProvider;
      this.settings.activeImageProvider = await this.resolveImageProviderForTextProvider(nextProvider);
      void this.saveSettings();
    }

    providerSelect.value = nextProvider;
    void this.appendDebugLog('providers.filtered', {
      activeProvider: nextProvider,
      visibleProviders: visibleValues
    });
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
    if (!contentStep || !settingsStep || !generateStep || !readinessBox || !readinessText) return;

    const contentReady = Boolean(this.extractedText && this.extractedText.length >= 50);
    const styleReady = this.settings.styleId !== 'custom' ||
      (!!String(this.settings.customStyleName || '').trim() && !!String(this.settings.customStyleTheme || '').trim());
    const providerReady = this.providerIsReady !== false; // default optimistic until async validation check resolves
    const settingsReady = providerReady && styleReady;
    const canGenerate = contentReady && settingsReady;
    const issues = [];
    if (!contentReady) issues.push('extract more page content');
    if (!providerReady) issues.push('validate the selected provider');
    if (!styleReady) issues.push('complete custom style name and description');
    this.lastWizardReadiness = { contentReady, settingsReady, canGenerate, issues };

    [contentStep, settingsStep, generateStep].forEach((step) => {
      step.classList.remove('is-complete', 'is-warning');
    });

    if (contentReady) contentStep.classList.add('is-complete');
    else contentStep.classList.add('is-warning');

    if (settingsReady) settingsStep.classList.add('is-complete');
    else settingsStep.classList.add('is-warning');

    if (canGenerate) generateStep.classList.add('is-complete');
    else generateStep.classList.add('is-warning');

    readinessBox.classList.remove('ready', 'warn');
    const generateBtn = document.getElementById('generate-btn');
    if (generateBtn && !this.isGenerating) {
      generateBtn.disabled = !canGenerate;
      generateBtn.title = canGenerate ? '' : ('Before generating: ' + issues.join('; '));
    }
    if (canGenerate) {
      readinessBox.classList.add('ready');
      readinessText.textContent = 'Ready to generate. Your page content and provider settings look good.';
      return;
    }

    readinessBox.classList.add('warn');
    readinessText.textContent = 'Before generating: ' + issues.join('; ') + '.';
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
    void this.appendDebugLog('generation.completed_with_warnings', {
      panelErrors: panelErrors
    });

    var summary = 'Comic created, but some panels failed to render (' + panelErrors.length + ').';
    if (!this.settings.debugFlag) {
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
  }

  showCreateComposer() {
    document.getElementById('onboarding-section')?.classList.add('hidden');
    document.getElementById('home-section')?.classList.add('hidden');
    document.getElementById('progress-section')?.classList.add('hidden');
    document.getElementById('main-section')?.classList.remove('hidden');
    this.updateWizardReadiness();
  }

  async startGeneration() {
    if (this.isGenerating) return;

    if (!this.lastWizardReadiness.canGenerate) {
      const issues = (this.lastWizardReadiness.issues || []).length
        ? this.lastWizardReadiness.issues
        : ['review content and settings'];
      this.reportUserError(
        'Cannot start generation yet. Before generating: ' + issues.join('; '),
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
    void this.appendDebugLog('generation.start.clicked', {
      providerText: this.settings.activeTextProvider,
      providerImage: this.settings.activeImageProvider,
      textChars: this.extractedText.length
    });
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const resolvedStyle = this.getResolvedStylePayload();
    const selectedTextModel = this.getSelectedTextModelForProvider(this.settings.activeTextProvider);
    const selectedImageModel = this.getSelectedImageModelForProvider(this.settings.activeImageProvider);
    
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'START_GENERATION',
        payload: {
          text: this.extractedText,
          url: tab.url,
          title: tab.title,
          settings: {
            panel_count: this.settings.panelCount,
            detail_level: this.settings.detailLevel,
            style_id: resolvedStyle.styleId,
            caption_len: 'short',
            provider_text: this.settings.activeTextProvider,
            provider_image: this.settings.activeImageProvider,
            text_model: selectedTextModel,
            image_model: selectedImageModel,
            image_quality: this.settings.openaiImageQuality || 'standard',
            image_size: this.settings.openaiImageSize || '256x256',
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
            await this.openSidePanel();
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
    this.progressStartedAtMs = Date.now();
    this.progressFirstPanelAtMs = 0;
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
    if (document.getElementById('generate-btn')) {
      document.getElementById('generate-btn').disabled = true;
    }
  }

  hideProgress() {
    document.getElementById('main-section')?.classList.remove('hidden');
    document.getElementById('progress-section')?.classList.add('hidden');
    if (document.getElementById('generate-btn')) {
      document.getElementById('generate-btn').disabled = false;
      document.getElementById('generate-btn').title = '';
    }
    this.isGenerating = false;
    this.progressStartedAtMs = 0;
    this.progressFirstPanelAtMs = 0;
    this.updateWizardReadiness();
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
          this.reportCompletedWithWarnings(currentJob);
          this.hideProgress();
          this.isGenerating = false;
          if (document.getElementById('open-viewer-btn')) {
            document.getElementById('open-viewer-btn').disabled = false;
          }
          await this.addToHistory(currentJob);
          if (this.settings.autoOpenSidePanel !== false) {
            try {
              await this.openSidePanel();
              void this.appendDebugLog('generation.viewer_opened_auto', { jobId: currentJob.id || null });
            } catch (openError) {
              console.error('Failed to auto-open comic viewer:', openError);
              void this.appendDebugLog('generation.viewer_opened_auto.error', {
                message: openError && openError.message ? openError.message : String(openError)
              });
            }
          }
          void this.appendDebugLog('generation.completed', {
            panels: currentJob.storyboard?.panels?.length || 0,
            panelErrors: currentJob.panelErrors?.length || 0
          });
        } else if (currentJob.status === 'failed' || currentJob.status === 'canceled') {
          clearInterval(pollInterval);
          this.hideProgress();
          this.isGenerating = false;
          var fallbackMessage = currentJob.status === 'canceled'
            ? 'Generation was canceled.'
            : 'Generation failed. No error details were provided.';
          var message = currentJob.error ? ('Generation failed: ' + currentJob.error) : fallbackMessage;
          this.reportUserError(message, currentJob.errorDetails || '');
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
    const progressBar = document.getElementById('progress-bar');
    const panelProgress = document.getElementById('panel-progress');
    const debugLogEl = document.getElementById('progress-debug-log');
    
    const statusMap = {
      pending: 'Preparing...',
      generating_text: 'Generating storyboard...',
      generating_images: 'Rendering comic panels...',
      completed: 'Complete!',
      failed: 'Failed',
      canceled: 'Canceled'
    };
    
    if (statusEl) {
      statusEl.textContent = statusMap[job.status] || 'Processing...';
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
    if (statusDetailEl) {
      statusDetailEl.textContent = this.buildProgressTimingDetail(job, panelCount);
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
      await chrome.runtime.sendMessage({ type: 'CANCEL_GENERATION' });
      this.isGenerating = false;
      this.hideProgress();
    } catch (error) {
      console.error('Cancel error:', error);
    }
  }

  async openSidePanel() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.sidePanel.open({ tabId: tab.id });
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sidepanel/sidepanel.html'
      });
    } catch (error) {
      console.error('Failed to open side panel:', error);
      window.open('sidepanel/sidepanel.html', '_blank');
    }
  }

  openOptions() {
    chrome.runtime.openOptionsPage();
  }

  async showHistory() {
    const modal = document.getElementById('history-modal');
    const list = document.getElementById('history-list');
    try {
      const { history } = await chrome.storage.local.get('history');
      const items = Array.isArray(history) ? history : [];
      void this.appendDebugLog('history.open', { count: items.length });
      
      if (items.length === 0) {
        list.innerHTML = '<p class="empty-state">No comics generated yet</p>';
      } else {
        list.innerHTML = items.slice(0, 10).map(item => {
          var sourceTitle = item && item.source && item.source.title ? item.source.title : 'Untitled';
          var generatedAt = item && item.generated_at ? new Date(item.generated_at) : null;
          var dateText = generatedAt && !isNaN(generatedAt.getTime())
            ? generatedAt.toLocaleDateString()
            : 'Unknown date';
          var itemId = item && item.id ? item.id : '';
          var thumbnail = item && item.thumbnail ? item.thumbnail : '';
          var safeSourceTitle = this.escapeHtml(sourceTitle);
          var safeItemId = this.escapeHtml(itemId);
          return `
            <div class="history-item" data-id="${safeItemId}">
              <div class="history-thumb">
                ${thumbnail ? `<img src="${thumbnail}" alt="">` : ''}
              </div>
              <div class="history-info">
                <div class="history-title">${safeSourceTitle}</div>
                <div class="history-meta">${this.escapeHtml(dateText)}</div>
              </div>
            </div>
          `;
        }).join('');
        
        list.querySelectorAll('.history-item').forEach(el => {
          el.addEventListener('click', () => {
            void this.appendDebugLog('history.item.click', { id: el.dataset.id || null });
            this.openSidePanel();
            this.hideHistory();
          });
        });
      }
      
      modal.classList.remove('hidden');
    } catch (error) {
      console.error('Failed to open history:', error);
      void this.appendDebugLog('history.open.error', { message: error.message });
      this.reportUserError('Failed to open history.', error && error.stack ? error.stack : error.message);
    }
  }

  hideHistory() {
    document.getElementById('history-modal').classList.add('hidden');
  }

  async clearHistory() {
    if (confirm('Are you sure you want to clear all history?')) {
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
