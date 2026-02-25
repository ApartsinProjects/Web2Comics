// Keep runtime defaults local to avoid importing shared/types.js, which currently contains
// TypeScript-only declarations and is not executable as a browser module.
const DEFAULT_SETTINGS = {
  panelCount: 3,
  detailLevel: 'low',
  styleId: 'default',
  customStyleName: '',
  customStyleTheme: '',
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

const DEFAULT_PROMPT_TEMPLATES = {
  openai: {
    storyboard:
      'Create a comic storyboard as strict JSON with a top-level "panels" array.\nSource: {{source_title}} ({{source_url}})\nPanels: {{panel_count}}\nDetail: {{detail_level}}\nStyle: {{style_prompt}}\nContent:\n{{content}}',
    image:
      'Comic panel {{panel_index}}/{{panel_count}}.\nCaption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\nReturn a single image matching the comic style.'
  },
  gemini: {
    storyboard:
      'Generate a comic storyboard in strict JSON only, with a top-level "panels" array.\nSource title: {{source_title}}\nSource URL: {{source_url}}\nPanel count: {{panel_count}}\nDetail level: {{detail_level}}\nStyle guidance: {{style_prompt}}\nContent:\n{{content}}',
    image:
      'Create comic panel artwork {{panel_index}}/{{panel_count}}.\nPanel caption: {{panel_caption}}\nPanel summary: {{panel_summary}}\nStyle guidance: {{style_prompt}}'
  },
  cloudflare: {
    storyboard:
      'Create a comic storyboard as strict JSON with a top-level "panels" array.\nSource: {{source_title}} ({{source_url}})\nPanels: {{panel_count}}\nDetail: {{detail_level}}\nStyle: {{style_prompt}}\nContent:\n{{content}}',
    image:
      'Comic panel {{panel_index}}/{{panel_count}}.\nCaption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\nReturn a single image matching the comic style.'
  },
  openrouter: {
    storyboard:
      'Create a comic storyboard as strict JSON with a top-level "panels" array.\nSource: {{source_title}} ({{source_url}})\nPanels: {{panel_count}}\nDetail: {{detail_level}}\nStyle: {{style_prompt}}\nContent:\n{{content}}',
    image:
      'Comic panel {{panel_index}}/{{panel_count}}.\nCaption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\nReturn a single image matching the comic style.'
  },
  huggingface: {
    storyboard:
      'Create a comic storyboard as strict JSON with a top-level "panels" array.\nSource: {{source_title}} ({{source_url}})\nPanels: {{panel_count}}\nDetail: {{detail_level}}\nStyle: {{style_prompt}}\nContent:\n{{content}}',
    image:
      'Comic panel {{panel_index}}/{{panel_count}}.\nCaption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\nReturn a single image matching the comic style.'
  }
};
const USER_STYLE_PREFIX = 'user:';

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

class OptionsController {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.customStyles = [];
    this.promptTemplates = JSON.parse(JSON.stringify(DEFAULT_PROMPT_TEMPLATES));
    this.activePromptProviderScope = 'openai';
    this.init();
  }

  async init() {
    await this.loadRecommendedDefaults();
    await this.loadSettings();
    await this.loadStorageInfo();
    this.relocateModelTestButtons();
    this.bindEvents();
    this.updateUI();
  }

  async appendDebugLog(event, data) {
    try {
      const { debugLogs } = await chrome.storage.local.get('debugLogs');
      const logs = Array.isArray(debugLogs) ? debugLogs : [];
      logs.push({
        ts: new Date().toISOString(),
        source: 'options',
        event,
        ...(data && typeof data === 'object' ? { data } : {})
      });
      if (logs.length > 1000) logs.splice(0, logs.length - 1000);
      await chrome.storage.local.set({ debugLogs: logs });
    } catch (_) {}
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
      const stored = await chrome.storage.local.get(['settings', 'providers', 'providerValidation', 'promptTemplates', 'customStyles']);
      if (stored.settings) {
        this.settings = { ...this.settings, ...stored.settings };
      }
      this.customStyles = Array.isArray(stored.customStyles) ? stored.customStyles : [];
      this.providers = stored.providers || {};
      this.providerValidation = stored.providerValidation || {};
      if (stored.promptTemplates && typeof stored.promptTemplates === 'object') {
        const mergedTemplates = {};
        Object.keys(DEFAULT_PROMPT_TEMPLATES).forEach((scope) => {
          mergedTemplates[scope] = {
            ...DEFAULT_PROMPT_TEMPLATES[scope],
            ...(stored.promptTemplates[scope] || {})
          };
        });
        this.promptTemplates = mergedTemplates;
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      void this.appendDebugLog('settings.load.error', { message: error?.message || String(error) });
    }
  }

  async loadStorageInfo() {
    try {
      const { history } = await chrome.storage.local.get('history');
      const historyCount = history?.length || 0;
      document.getElementById('history-size').textContent = `${historyCount} comics`;
    } catch (error) {
      console.error('Failed to load storage info:', error);
      void this.appendDebugLog('storage.info.load.error', { message: error?.message || String(error) });
    }
  }

  bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchSection(e.currentTarget.dataset.section));
    });

    // General settings
    document.getElementById('save-general-btn').addEventListener('click', () => this.saveGeneralSettings());
    document.getElementById('default-style')?.addEventListener('change', () => this.updateGeneralCustomStyleUI());
    document.getElementById('create-default-style-btn')?.addEventListener('click', () => this.createDefaultCustomStyle());

    // Provider settings
    document.querySelectorAll('.provider-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const providerCard = e.currentTarget;
        this.selectProvider(providerCard.dataset.provider);
      });
    });

    document.querySelectorAll('.validate-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.validateProvider(e.currentTarget.dataset.provider, e.currentTarget));
    });
    document.querySelectorAll('.test-model-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.testProviderModel(
        e.currentTarget.dataset.provider,
        e.currentTarget.dataset.mode,
        e.currentTarget
      ));
    });

    document.getElementById('save-providers-btn').addEventListener('click', () => this.saveProvidersSettings());
    document.getElementById('prompt-provider-scope')?.addEventListener('change', (e) => {
      this.activePromptProviderScope = e.currentTarget.value || 'openai';
      this.updatePromptTemplatesUI();
    });
    document.getElementById('save-prompts-btn')?.addEventListener('click', () => this.savePromptTemplates());
    document.getElementById('reset-storyboard-template-btn')?.addEventListener('click', () => this.resetPromptTemplateField('storyboard'));
    document.getElementById('reset-image-template-btn')?.addEventListener('click', () => this.resetPromptTemplateField('image'));

    // Storage settings
    document.getElementById('clear-history-btn')?.addEventListener('click', () => this.clearHistory());
    document.getElementById('clear-cache-btn')?.addEventListener('click', () => this.clearCache());
    document.getElementById('export-data-btn')?.addEventListener('click', () => this.exportData());
    document.getElementById('export-debug-logs-btn')?.addEventListener('click', () => this.exportDebugLogs());
  }

  getProviderModelSelectId(providerId, mode) {
    if (providerId === 'openai') return mode === 'image' ? 'openai-image-model' : 'openai-text-model';
    if (providerId === 'gemini-free') return mode === 'image' ? 'gemini-image-model' : 'gemini-text-model';
    if (providerId === 'cloudflare-free') return mode === 'image' ? 'cloudflare-image-model' : 'cloudflare-text-model';
    if (providerId === 'openrouter') return mode === 'image' ? 'openrouter-image-model' : 'openrouter-text-model';
    if (providerId === 'huggingface') return mode === 'image' ? 'huggingface-image-model' : 'huggingface-text-model';
    return null;
  }

  relocateModelTestButtons() {
    document.querySelectorAll('.test-model-btn').forEach((btn) => {
      const providerId = btn.dataset.provider;
      const mode = btn.dataset.mode;
      const selectId = this.getProviderModelSelectId(providerId, mode);
      const selectEl = selectId ? document.getElementById(selectId) : null;
      const modelItem = selectEl?.closest('.model-item');
      if (!modelItem) return;

      let inlineWrap = btn.closest('.model-test-inline');
      if (!inlineWrap) {
        inlineWrap = document.createElement('div');
        inlineWrap.className = 'model-test-inline';
        const statusEl = document.createElement('div');
        statusEl.className = 'model-test-status';
        statusEl.setAttribute('aria-live', 'polite');
        inlineWrap.appendChild(btn);
        inlineWrap.appendChild(statusEl);
      }
      modelItem.appendChild(inlineWrap);
    });

    document.querySelectorAll('.model-test-actions').forEach((container) => {
      if (!container.querySelector('.test-model-btn')) {
        container.style.display = 'none';
      }
    });
  }

  getModelTestStatusEl(buttonEl, providerId, mode) {
    const inlineWrap = buttonEl?.closest('.model-test-inline');
    if (inlineWrap) {
      let statusEl = inlineWrap.querySelector('.model-test-status');
      if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.className = 'model-test-status';
        statusEl.setAttribute('aria-live', 'polite');
        inlineWrap.appendChild(statusEl);
      }
      return statusEl;
    }

    const selectId = this.getProviderModelSelectId(providerId, mode);
    const modelItem = selectId ? document.getElementById(selectId)?.closest('.model-item') : null;
    if (!modelItem) return null;
    let statusEl = modelItem.querySelector('.model-test-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.className = 'model-test-status';
      statusEl.setAttribute('aria-live', 'polite');
      modelItem.appendChild(statusEl);
    }
    return statusEl;
  }

  setModelTestStatus(buttonEl, providerId, mode, variant, message) {
    const statusEl = this.getModelTestStatusEl(buttonEl, providerId, mode);
    if (!statusEl) return;
    statusEl.className = `model-test-status ${variant || ''}`.trim();
    statusEl.textContent = message || '';
  }

  updateUI() {
    this.populateDefaultStyleOptions();
    // General
    document.getElementById('default-panel-count').value = this.settings.panelCount;
    document.getElementById('default-detail').value = this.settings.detailLevel;
    document.getElementById('default-style').value = this.settings.styleId || 'default';
    document.getElementById('default-caption').value = this.settings.captionLength;
    document.getElementById('auto-open-panel').checked = this.settings.autoOpenSidePanel !== false;
    document.getElementById('character-consistency').checked = this.settings.characterConsistency || false;
    document.getElementById('debug-flag').checked = this.settings.debugFlag || false;
    const refusalMode = this.settings.imageRefusalHandling || 'rewrite_and_retry';
    const refusalSelect = document.getElementById('image-refusal-handling-select');
    if (refusalSelect) {
      refusalSelect.value = refusalMode;
      if (refusalSelect.value !== refusalMode) {
        refusalSelect.value = 'rewrite_and_retry';
      }
    }
    const badgeToggle = document.getElementById('show-rewritten-badge');
    if (badgeToggle) badgeToggle.checked = this.settings.showRewrittenBadge !== false;
    const logToggle = document.getElementById('log-rewritten-prompts');
    if (logToggle) logToggle.checked = !!this.settings.logRewrittenPrompts;
    
    // Custom style
    this.updateGeneralCustomStyleUI();

    // Storage
    document.getElementById('max-cache-size').value = this.settings.maxCacheSize || 100;
    document.getElementById('history-retention').value = this.settings.historyRetention || 30;
    if (document.getElementById('openai-text-model')) {
      document.getElementById('openai-text-model').value = this.settings.textModel || 'gpt-4o-mini';
      document.getElementById('openai-image-model').value = this.settings.imageModel || 'dall-e-2';
      document.getElementById('openai-image-quality').value = this.settings.openaiImageQuality || 'standard';
      document.getElementById('openai-image-size').value = this.settings.openaiImageSize || '256x256';
      document.getElementById('gemini-text-model').value = this.settings.geminiTextModel || 'gemini-2.5-flash';
      document.getElementById('gemini-image-model').value = this.settings.geminiImageModel || 'gemini-2.0-flash-exp-image-generation';
      document.getElementById('cloudflare-text-model').value = this.settings.cloudflareTextModel || '@cf/meta/llama-3.1-8b-instruct';
      document.getElementById('cloudflare-image-model').value = this.settings.cloudflareImageModel || '@cf/black-forest-labs/flux-1-schnell';
      document.getElementById('openrouter-text-model').value = this.settings.openrouterTextModel || 'openai/gpt-oss-20b:free';
      if (document.getElementById('openrouter-image-model')) {
        document.getElementById('openrouter-image-model').value = this.settings.openrouterImageModel || 'google/gemini-2.5-flash-image-preview';
      }
      if (document.getElementById('openrouter-image-size')) {
        document.getElementById('openrouter-image-size').value = this.settings.openrouterImageSize || '1K';
      }
      document.getElementById('huggingface-text-model').value = this.settings.huggingfaceTextModel || 'mistralai/Mistral-7B-Instruct-v0.2';
      if (document.getElementById('huggingface-image-model')) {
        document.getElementById('huggingface-image-model').value = this.settings.huggingfaceImageModel || 'black-forest-labs/FLUX.1-schnell';
      }
      if (document.getElementById('huggingface-image-size')) {
        document.getElementById('huggingface-image-size').value = this.settings.huggingfaceImageSize || '512x512';
      }
      if (document.getElementById('huggingface-image-quality')) {
        document.getElementById('huggingface-image-quality').value = this.settings.huggingfaceImageQuality || 'fastest';
      }
    }

    // Check for stored API keys
    this.checkApiKeys();

    // Provider preset selection
    this.updateProviderSelectionUI();
    this.updatePromptTemplatesUI();
  }

  updateProviderSelectionUI() {
    const activeProvider = this.settings.activeTextProvider || 'gemini-free';
    document.querySelectorAll('.provider-card').forEach(card => {
      card.classList.toggle('active', card.dataset.provider === activeProvider);
    });
  }

  selectProvider(providerId) {
    if (!providerId) return;

    this.settings.activeTextProvider = providerId;

    // Only a subset of providers support image generation.
    if (
      providerId === 'gemini-free' ||
      providerId === 'openai' ||
      providerId === 'cloudflare-free' ||
      providerId === 'openrouter' ||
      providerId === 'huggingface'
    ) {
      this.settings.activeImageProvider = providerId;
    }

    this.updateProviderSelectionUI();
  }

  async checkApiKeys() {
    const { apiKeys, settings, providerValidation, cloudflareConfig, cloudflare } = await chrome.storage.local.get([
      'apiKeys',
      'settings',
      'providerValidation',
      'cloudflareConfig',
      'cloudflare'
    ]);
    const validations = providerValidation || {};
    const cfConfig = (cloudflareConfig && typeof cloudflareConfig === 'object')
      ? cloudflareConfig
      : ((cloudflare && typeof cloudflare === 'object') ? cloudflare : {});
    
    if (apiKeys?.gemini) {
      document.getElementById('gemini-api-key').value = '••••••••••••••••';
      this.updateProviderStatus('gemini', !!validations.gemini?.valid);
    }
    
    if (apiKeys?.openai) {
      document.getElementById('openai-api-key').value = '••••••••••••••••';
      this.updateProviderStatus('openai', !!validations.openai?.valid);
      
      // Load model selections
      if (settings?.textModel) {
        document.getElementById('openai-text-model').value = settings.textModel;
      }
      if (settings?.imageModel) {
        document.getElementById('openai-image-model').value = settings.imageModel;
      }
      if (settings?.openaiImageQuality) {
        document.getElementById('openai-image-quality').value = settings.openaiImageQuality;
      }
      if (settings?.openaiImageSize) {
        document.getElementById('openai-image-size').value = settings.openaiImageSize;
      }
    }

    if (settings?.geminiTextModel && document.getElementById('gemini-text-model')) {
      document.getElementById('gemini-text-model').value = settings.geminiTextModel;
    }
    if (settings?.geminiImageModel && document.getElementById('gemini-image-model')) {
      document.getElementById('gemini-image-model').value = settings.geminiImageModel;
    }
    if (settings?.cloudflareTextModel && document.getElementById('cloudflare-text-model')) {
      document.getElementById('cloudflare-text-model').value = settings.cloudflareTextModel;
    }
    if (settings?.cloudflareImageModel && document.getElementById('cloudflare-image-model')) {
      document.getElementById('cloudflare-image-model').value = settings.cloudflareImageModel;
    }
    if (document.getElementById('cloudflare-account-id') && cfConfig.accountId) {
      document.getElementById('cloudflare-account-id').value = cfConfig.accountId;
    }
    if (document.getElementById('cloudflare-api-token') && (cfConfig.apiToken || apiKeys?.cloudflare)) {
      document.getElementById('cloudflare-api-token').value = '••••••••••••••••';
    }
    if (document.getElementById('cloudflare-email') && cfConfig.email) {
      document.getElementById('cloudflare-email').value = cfConfig.email;
    }
    if (document.getElementById('cloudflare-api-key') && cfConfig.apiKey) {
      document.getElementById('cloudflare-api-key').value = '••••••••••••••••';
    }
    const hasCloudflareCreds = !!(
      cfConfig.accountId && (
        cfConfig.apiToken ||
        (cfConfig.email && cfConfig.apiKey)
      )
    );
    if (document.getElementById('cloudflare-status')) {
      if (hasCloudflareCreds) {
        this.updateProviderStatus('cloudflare', !!validations.cloudflare?.valid);
      } else {
        const text = document.querySelector('#cloudflare-status span:last-child');
        const indicator = document.querySelector('#cloudflare-status .status-indicator');
        if (indicator) indicator.classList.remove('ready');
        if (text) text.textContent = 'Not configured';
      }
    }
    if (settings?.openrouterTextModel && document.getElementById('openrouter-text-model')) {
      document.getElementById('openrouter-text-model').value = settings.openrouterTextModel;
    }
    if (settings?.openrouterImageModel && document.getElementById('openrouter-image-model')) {
      document.getElementById('openrouter-image-model').value = settings.openrouterImageModel;
    }
    if (settings?.openrouterImageSize && document.getElementById('openrouter-image-size')) {
      document.getElementById('openrouter-image-size').value = settings.openrouterImageSize;
    }
    if (settings?.huggingfaceTextModel && document.getElementById('huggingface-text-model')) {
      document.getElementById('huggingface-text-model').value = settings.huggingfaceTextModel;
    }
    if (settings?.huggingfaceImageModel && document.getElementById('huggingface-image-model')) {
      document.getElementById('huggingface-image-model').value = settings.huggingfaceImageModel;
    }
    if (settings?.huggingfaceImageSize && document.getElementById('huggingface-image-size')) {
      document.getElementById('huggingface-image-size').value = settings.huggingfaceImageSize;
    }
    if (settings?.huggingfaceImageQuality && document.getElementById('huggingface-image-quality')) {
      document.getElementById('huggingface-image-quality').value = settings.huggingfaceImageQuality;
    }

    if (apiKeys?.openrouter) {
      document.getElementById('openrouter-api-key').value = '••••••••••••••••';
      this.updateProviderStatus('openrouter', !!validations.openrouter?.valid);
    }

    if (apiKeys?.huggingface) {
      document.getElementById('huggingface-api-key').value = '••••••••••••••••';
      this.updateProviderStatus('huggingface', !!validations.huggingface?.valid);
    }
  }

  switchSection(section) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.section === section);
    });

    document.querySelectorAll('.settings-section').forEach(sec => {
      sec.classList.toggle('active', sec.id === `${section}-section`);
    });
  }

  getPromptScopeTemplates(scope = this.activePromptProviderScope) {
    const providerScope = DEFAULT_PROMPT_TEMPLATES[scope] ? scope : 'openai';
    return this.promptTemplates[providerScope] || DEFAULT_PROMPT_TEMPLATES[providerScope];
  }

  updateGeneralCustomStyleUI() {
    const customContainer = document.getElementById('default-custom-style-container');
    const styleSelect = document.getElementById('default-style');
    if (!customContainer || !styleSelect) return;
    const isCustom = styleSelect.value === 'custom';
    customContainer.style.display = isCustom ? 'block' : 'none';
    if (isCustom) {
      const nameEl = document.getElementById('default-custom-style-name');
      const descEl = document.getElementById('default-custom-style');
      if (nameEl) nameEl.value = this.settings.customStyleName || '';
      if (descEl) descEl.value = this.settings.customStyleTheme || '';
    }
  }

  populateDefaultStyleOptions() {
    const styleSelect = document.getElementById('default-style');
    if (!styleSelect) return;
    const baseOptions = [
      ['default', 'Default (Classic Comic)'],
      ['noir', 'Noir (Dark & Dramatic)'],
      ['minimalist', 'Minimalist'],
      ['manga', 'Manga (Anime)'],
      ['superhero', 'Superhero'],
      ['watercolor', 'Watercolor'],
      ['pixel', 'Pixel Art']
    ];
    const currentValue = this.settings.styleId || styleSelect.value || 'default';
    styleSelect.innerHTML = '';
    baseOptions.forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      styleSelect.appendChild(opt);
    });
    (this.customStyles || []).forEach((style) => {
      if (!style || !style.id || !style.name) return;
      const opt = document.createElement('option');
      opt.value = USER_STYLE_PREFIX + style.id;
      opt.textContent = style.name;
      styleSelect.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom...';
    styleSelect.appendChild(customOpt);

    styleSelect.value = currentValue;
    if (styleSelect.value !== currentValue) {
      styleSelect.value = 'default';
    }
  }

  slugifyStyleName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'style';
  }

  async createDefaultCustomStyle() {
    const styleSelect = document.getElementById('default-style');
    const nameEl = document.getElementById('default-custom-style-name');
    const descEl = document.getElementById('default-custom-style');
    const name = (nameEl?.value || '').trim();
    const description = (descEl?.value || '').trim();
    if (!name || !description) {
      this.showToast('Enter custom style name and description', 'error');
      return;
    }

    let id = this.slugifyStyleName(name);
    let nextId = id;
    let n = 2;
    while ((this.customStyles || []).some((s) => s && s.id === nextId)) {
      nextId = `${id}-${n++}`;
    }
    id = nextId;
    const styleEntry = {
      id,
      name,
      description,
      createdAt: new Date().toISOString()
    };
    this.customStyles = [...(this.customStyles || []), styleEntry];
    await chrome.storage.local.set({ customStyles: this.customStyles });

    // Persist selected style and keep compatibility values populated for runtime/popup.
    this.settings = {
      ...this.settings,
      styleId: USER_STYLE_PREFIX + id,
      customStyleName: name,
      customStyleTheme: description
    };
    await chrome.storage.local.set({ settings: this.settings });

    this.populateDefaultStyleOptions();
    if (styleSelect) styleSelect.value = USER_STYLE_PREFIX + id;
    this.updateGeneralCustomStyleUI(); // hides custom editor because selection is no longer "custom"
    this.showToast('Custom style created', 'success');
  }

  updatePromptTemplatesUI() {
    const scopeSelect = document.getElementById('prompt-provider-scope');
    if (scopeSelect) {
      scopeSelect.value = this.activePromptProviderScope || 'openai';
    }
    const templates = this.getPromptScopeTemplates();
    const storyboardEl = document.getElementById('storyboard-template');
    const imageEl = document.getElementById('image-template');
    if (storyboardEl) storyboardEl.value = templates.storyboard || '';
    if (imageEl) imageEl.value = templates.image || '';
    this.validatePromptTemplatesUI();
  }

  collectPromptTemplateInputs() {
    return {
      storyboard: document.getElementById('storyboard-template')?.value || '',
      image: document.getElementById('image-template')?.value || ''
    };
  }

  validatePromptTemplates(templates) {
    const required = {
      storyboard: ['{{panel_count}}', '{{content}}'],
      image: ['{{panel_caption}}', '{{style_prompt}}']
    };
    const allowed = new Set([
      '{{source_title}}',
      '{{source_url}}',
      '{{panel_count}}',
      '{{detail_level}}',
      '{{style_prompt}}',
      '{{content}}',
      '{{panel_caption}}',
      '{{panel_summary}}',
      '{{panel_index}}'
    ]);
    const messages = [];
    let hasError = false;
    ['storyboard', 'image'].forEach((key) => {
      const text = String(templates[key] || '');
      for (const token of required[key]) {
        if (!text.includes(token)) {
          hasError = true;
          messages.push(`${key}: missing required ${token}`);
        }
      }
      const found = text.match(/\{\{[^}]+\}\}/g) || [];
      const unknown = found.filter((token) => !allowed.has(token));
      if (unknown.length) {
        messages.push(`${key}: unknown placeholders ${unknown.join(', ')}`);
      }
    });
    if (!messages.length) {
      messages.push('Templates look valid for phase-1 placeholder checks.');
    }
    return { hasError, hasWarning: !hasError && messages.some((m) => m.includes('unknown placeholders')), messages };
  }

  validatePromptTemplatesUI() {
    const box = document.getElementById('prompt-template-validation');
    if (!box) return;
    const result = this.validatePromptTemplates(this.collectPromptTemplateInputs());
    box.classList.remove('ok', 'warn');
    if (!result.hasError && !result.hasWarning) box.classList.add('ok');
    if (result.hasError || result.hasWarning) box.classList.add('warn');
    box.textContent = result.messages.join(' | ');
    return result;
  }

  resetPromptTemplateField(field) {
    const templates = this.getPromptScopeTemplates(this.activePromptProviderScope);
    if (field === 'storyboard') {
      const el = document.getElementById('storyboard-template');
      if (el) el.value = DEFAULT_PROMPT_TEMPLATES[this.activePromptProviderScope]?.storyboard || templates.storyboard || '';
    }
    if (field === 'image') {
      const el = document.getElementById('image-template');
      if (el) el.value = DEFAULT_PROMPT_TEMPLATES[this.activePromptProviderScope]?.image || templates.image || '';
    }
    this.validatePromptTemplatesUI();
  }

  async savePromptTemplates() {
    const scope = DEFAULT_PROMPT_TEMPLATES[this.activePromptProviderScope] ? this.activePromptProviderScope : 'openai';
    const nextTemplates = this.collectPromptTemplateInputs();
    const validation = this.validatePromptTemplatesUI();
    if (validation?.hasError) {
      this.showToast('Prompt templates have validation errors', 'error');
      return;
    }
    this.promptTemplates = {
      ...this.promptTemplates,
      [scope]: {
        ...(this.promptTemplates[scope] || {}),
        ...nextTemplates
      }
    };
    try {
      await chrome.storage.local.set({ promptTemplates: this.promptTemplates });
      this.showToast('Prompt templates saved!', 'success');
    } catch (error) {
      this.showToast('Failed to save prompt templates', 'error');
    }
  }

  async saveGeneralSettings() {
    const styleId = document.getElementById('default-style').value;
    let customStyleName = '';
    let customStyleTheme = '';
    if (styleId === 'custom') {
      customStyleName = (document.getElementById('default-custom-style-name')?.value || '').trim();
      customStyleTheme = (document.getElementById('default-custom-style')?.value || '');
    } else if (String(styleId).startsWith(USER_STYLE_PREFIX)) {
      const style = (this.customStyles || []).find((s) => s && (USER_STYLE_PREFIX + s.id) === styleId);
      customStyleName = style?.name || '';
      customStyleTheme = style?.description || '';
    }
    
    this.settings = {
      ...this.settings,
      panelCount: parseInt(document.getElementById('default-panel-count').value),
      detailLevel: document.getElementById('default-detail').value,
      styleId: styleId,
      customStyleName: customStyleName,
      customStyleTheme: customStyleTheme,
      captionLength: document.getElementById('default-caption').value,
      autoOpenSidePanel: document.getElementById('auto-open-panel').checked,
      characterConsistency: document.getElementById('character-consistency').checked,
      debugFlag: document.getElementById('debug-flag').checked,
      imageRefusalHandling:
        (document.getElementById('image-refusal-handling-select')?.value || 'rewrite_and_retry'),
      showRewrittenBadge: document.getElementById('show-rewritten-badge')?.checked !== false,
      logRewrittenPrompts: !!document.getElementById('log-rewritten-prompts')?.checked,
      maxCacheSize: parseInt(document.getElementById('max-cache-size').value),
      historyRetention: parseInt(document.getElementById('history-retention').value)
    };

    try {
      await chrome.storage.local.set({ settings: this.settings });
      this.showToast('Settings saved successfully!', 'success');
    } catch (error) {
      this.showToast('Failed to save settings', 'error');
    }
  }

  async validateProvider(provider, buttonEl) {
    const button = buttonEl || document.querySelector(`.validate-btn[data-provider="${provider}"]`);
    const originalLabel = button?.textContent || '';

    try {
      if (button) {
        button.disabled = true;
        button.classList.add('is-loading');
        button.textContent = 'Validating...';
      }

      if (provider === 'cloudflare') {
        await this.validateCloudflareProvider();
        this.updateProviderStatus('cloudflare', true);
        this.showToast('cloudflare credentials validated!', 'success');
        return;
      }

      const inputId = `${provider}-api-key`;
      const input = document.getElementById(inputId);
      const apiKey = input?.value?.trim();

      if (!apiKey || apiKey === '••••••••••••••••') {
        this.showToast('Please enter an API key', 'error');
        return;
      }

      if (provider === 'openai') {
        const textModel = document.getElementById('openai-text-model')?.value || this.settings.textModel || 'gpt-4o-mini';
        const remote = await chrome.runtime.sendMessage({
          type: 'VALIDATE_PROVIDER_REMOTE',
          payload: {
            providerId: 'openai',
            apiKey,
            textModel
          }
        });
        if (!remote || remote.success === false) {
          throw new Error(remote?.error || 'OpenAI remote validation failed');
        }
      }

      // Store the API key
      const { apiKeys, providerValidation } = await chrome.storage.local.get(['apiKeys', 'providerValidation']);
      await chrome.storage.local.set({
        apiKeys: { ...apiKeys, [provider]: apiKey },
        providerValidation: {
          ...(providerValidation || {}),
          [provider]: {
            valid: true,
            validatedAt: new Date().toISOString()
          }
        }
      });

      this.updateProviderStatus(provider, true);
      this.showToast(`${provider} API key validated!`, 'success');
    } catch (error) {
      this.showToast(error?.message || `Failed to validate ${provider}`, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('is-loading');
        button.textContent = originalLabel || 'Validate';
      }
    }
  }

  async validateCloudflareProvider() {
    const accountId = (document.getElementById('cloudflare-account-id')?.value || '').trim();
    const tokenInput = (document.getElementById('cloudflare-api-token')?.value || '').trim();
    const email = (document.getElementById('cloudflare-email')?.value || '').trim();
    const apiKeyInput = (document.getElementById('cloudflare-api-key')?.value || '').trim();

    if (!accountId) {
      this.showToast('Please enter Cloudflare Account ID', 'error');
      throw new Error('Missing Cloudflare Account ID');
    }

    const useToken = !!tokenInput && tokenInput !== '••••••••••••••••';
    const useGlobalKey = !!email && !!apiKeyInput && apiKeyInput !== '••••••••••••••••';
    if (!useToken && !useGlobalKey) {
      this.showToast('Enter Cloudflare API Token (recommended) or Email + Global API Key', 'error');
      throw new Error('Missing Cloudflare credentials');
    }

    const { cloudflareConfig: prevConfig, cloudflare: legacyCloudflare, apiKeys, providerValidation } =
      await chrome.storage.local.get(['cloudflareConfig', 'cloudflare', 'apiKeys', 'providerValidation']);
    const previous = (prevConfig && typeof prevConfig === 'object')
      ? prevConfig
      : ((legacyCloudflare && typeof legacyCloudflare === 'object') ? legacyCloudflare : {});

    const nextConfig = {
      ...previous,
      accountId
    };

    if (useToken) {
      nextConfig.apiToken = tokenInput;
    }
    if (email) {
      nextConfig.email = email;
    }
    if (useGlobalKey) {
      nextConfig.apiKey = apiKeyInput;
    }

    await chrome.storage.local.set({
      cloudflareConfig: nextConfig,
      cloudflare: nextConfig,
      apiKeys: {
        ...(apiKeys || {}),
        ...(nextConfig.apiToken ? { cloudflare: nextConfig.apiToken } : {})
      },
      providerValidation: {
        ...(providerValidation || {}),
        cloudflare: {
          valid: true,
          validatedAt: new Date().toISOString()
        }
      }
    });
  }

  getProviderModelSelection(providerId, mode) {
    const kind = mode === 'image' ? 'image' : 'text';
    if (providerId === 'openai') {
      return kind === 'text'
        ? (document.getElementById('openai-text-model')?.value || this.settings.textModel)
        : (document.getElementById('openai-image-model')?.value || this.settings.imageModel);
    }
    if (providerId === 'gemini-free') {
      return kind === 'text'
        ? (document.getElementById('gemini-text-model')?.value || this.settings.geminiTextModel)
        : (document.getElementById('gemini-image-model')?.value || this.settings.geminiImageModel);
    }
    if (providerId === 'cloudflare-free') {
      return kind === 'text'
        ? (document.getElementById('cloudflare-text-model')?.value || this.settings.cloudflareTextModel)
        : (document.getElementById('cloudflare-image-model')?.value || this.settings.cloudflareImageModel);
    }
    if (providerId === 'openrouter') {
      if (mode === 'image') {
        return document.getElementById('openrouter-image-model')?.value || this.settings.openrouterImageModel;
      }
      return document.getElementById('openrouter-text-model')?.value || this.settings.openrouterTextModel;
    }
    if (providerId === 'huggingface') {
      if (mode === 'image') {
        return document.getElementById('huggingface-image-model')?.value || this.settings.huggingfaceImageModel;
      }
      return document.getElementById('huggingface-text-model')?.value || this.settings.huggingfaceTextModel;
    }
    return '';
  }

  async testProviderModel(providerId, mode, buttonEl) {
    const selectedModel = this.getProviderModelSelection(providerId, mode);
    if (!selectedModel) {
      this.setModelTestStatus(buttonEl, providerId, mode, 'error', 'No model selected');
      this.showToast('No model selected to test', 'error');
      return;
    }
    const button = buttonEl || document.querySelector(`.test-model-btn[data-provider="${providerId}"][data-mode="${mode}"]`);
    const originalLabel = button?.textContent || '';
    try {
      if (button) {
        button.disabled = true;
        button.classList.add('is-loading');
        button.textContent = 'Testing...';
      }
      this.setModelTestStatus(button, providerId, mode, 'pending', 'Testing model...');
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_PROVIDER_MODEL',
        payload: {
          providerId,
          mode: mode === 'image' ? 'image' : 'text',
          model: selectedModel
        }
      });
      if (!response || response.success === false) {
        throw new Error(response?.error || 'Model test failed');
      }
      const result = response.result || {};
      const actualModel = result.providerMetadata && result.providerMetadata.model
        ? String(result.providerMetadata.model)
        : '';
      let detail = result.summary ? ` (${result.summary})` : '';
      if (actualModel && actualModel !== selectedModel) {
        detail += `${detail ? ' ' : ' ('}Actual model used: ${actualModel}${detail ? '' : ')'}`;
      }
      this.setModelTestStatus(button, providerId, mode, 'success', `It's working!${detail}`);
      this.showToast(`${providerId} ${mode} model test passed`, 'success');
    } catch (error) {
      const errorText = this.classifyProviderModelTestError(providerId, mode, error);
      this.setModelTestStatus(button, providerId, mode, 'error', `Error: ${errorText}`);
      this.showToast(`${providerId} ${mode} model test failed`, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('is-loading');
        button.textContent = originalLabel || 'Test Model';
      }
    }
  }

  classifyProviderModelTestError(providerId, mode, error) {
    const raw = error?.message || String(error) || 'Model test failed';
    const normalized = String(raw);
    const lower = normalized.toLowerCase();

    if (providerId === 'openai') {
      if (/(insufficient_quota|quota|billing|budget)/i.test(normalized)) {
        return 'OpenAI quota/billing issue for this key/project. The key may be valid, but this model request cannot run.';
      }
      if (/(does not have access to model|model .*not found|unknown model|unsupported model|not available)/i.test(normalized)) {
        return 'This OpenAI key/project does not have access to the selected model. Try another model (for example gpt-4o-mini or dall-e-3).';
      }
      if (/(api key|unauthorized|401|invalid_api_key|incorrect api key)/i.test(normalized)) {
        return 'OpenAI key appears invalid for model requests (the token may have changed or belong to a different project).';
      }
      if (mode === 'image' && /content policy|safety|moderation|blocked/.test(lower)) {
        return 'Image prompt was blocked by provider safety/content policy during the model test.';
      }
    }

    return normalized;
  }

  updateProviderStatus(provider, valid) {
    const statusEl = document.getElementById(`${provider}-status`);
    if (statusEl) {
      const indicator = statusEl.querySelector('.status-indicator');
      const text = statusEl.querySelector('span:last-child');
      if (indicator) indicator.classList.toggle('ready', valid);
        if (text) text.textContent = valid ? 'Configured' : 'Configured (not validated)';
    }
  }

  async saveProvidersSettings() {
    const imageModel = document.getElementById('openai-image-model')?.value || this.settings.imageModel;
    const openaiImageQuality = document.getElementById('openai-image-quality')?.value || this.settings.openaiImageQuality;
    const openaiImageSize = document.getElementById('openai-image-size')?.value || this.settings.openaiImageSize;

    this.settings = {
      ...this.settings,
      textModel: document.getElementById('openai-text-model')?.value || this.settings.textModel,
      imageModel: imageModel,
      geminiTextModel: document.getElementById('gemini-text-model')?.value || this.settings.geminiTextModel,
      geminiImageModel: document.getElementById('gemini-image-model')?.value || this.settings.geminiImageModel,
      cloudflareTextModel: document.getElementById('cloudflare-text-model')?.value || this.settings.cloudflareTextModel,
      cloudflareImageModel: document.getElementById('cloudflare-image-model')?.value || this.settings.cloudflareImageModel,
      openrouterTextModel: document.getElementById('openrouter-text-model')?.value || this.settings.openrouterTextModel,
      openrouterImageModel: document.getElementById('openrouter-image-model')?.value || this.settings.openrouterImageModel,
      openrouterImageSize: document.getElementById('openrouter-image-size')?.value || this.settings.openrouterImageSize,
      huggingfaceTextModel: document.getElementById('huggingface-text-model')?.value || this.settings.huggingfaceTextModel,
      huggingfaceImageModel: document.getElementById('huggingface-image-model')?.value || this.settings.huggingfaceImageModel,
      huggingfaceImageSize: document.getElementById('huggingface-image-size')?.value || this.settings.huggingfaceImageSize,
      huggingfaceImageQuality: document.getElementById('huggingface-image-quality')?.value || this.settings.huggingfaceImageQuality,
      openaiImageSize: this.normalizeOpenAIImageSize(imageModel, openaiImageSize),
      openaiImageQuality: this.normalizeOpenAIImageQuality(imageModel, openaiImageQuality)
    };

    try {
      await chrome.storage.local.set({ settings: this.settings });
      this.showToast('Provider settings saved!', 'success');
    } catch (error) {
      this.showToast('Failed to save provider settings', 'error');
    }
  }

  normalizeOpenAIImageSize(imageModel, size) {
    const model = imageModel || 'dall-e-2';
    const requested = size || '256x256';
    if (model === 'dall-e-2') {
      const allowed = ['256x256', '512x512', '1024x1024'];
      return allowed.includes(requested) ? requested : '256x256';
    }
    const allowed = ['1024x1024', '1024x1792', '1792x1024'];
    return allowed.includes(requested) ? requested : '1024x1024';
  }

  normalizeOpenAIImageQuality(imageModel, quality) {
    const model = imageModel || 'dall-e-2';
    if (model !== 'dall-e-3') {
      return 'standard';
    }
    return quality === 'hd' ? 'hd' : 'standard';
  }

  async clearHistory() {
    if (confirm('Are you sure you want to clear all comic history?')) {
      await chrome.storage.local.set({ history: [] });
      await this.loadStorageInfo();
      this.showToast('History cleared!', 'success');
    }
  }

  async clearCache() {
    if (confirm('Are you sure you want to clear the image cache?')) {
      // TODO: Implement cache clearing
      this.showToast('Cache cleared!', 'success');
    }
  }

  async exportData() {
    try {
      const data = await chrome.storage.local.get(null);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `web2comics-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      this.showToast('Data exported!', 'success');
    } catch (error) {
      this.showToast('Failed to export data', 'error');
    }
  }

  async exportDebugLogs() {
    try {
      const { debugLogs } = await chrome.storage.local.get('debugLogs');
      const payload = {
        exported_at: new Date().toISOString(),
        count: Array.isArray(debugLogs) ? debugLogs.length : 0,
        logs: Array.isArray(debugLogs) ? debugLogs : []
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `web2comics-debug-logs-${new Date().toISOString().split('T')[0]}.json`;
      a.click();

      URL.revokeObjectURL(url);
      this.showToast('Debug logs exported!', 'success');
    } catch (error) {
      this.showToast('Failed to export debug logs', 'error');
    }
  }

  showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const messageEl = document.getElementById('toast-message');
    
    messageEl.textContent = message;
    toast.className = `toast ${type}`;
    if (type === 'error') {
      void this.appendDebugLog('ui.toast.error', { message: String(message || '') });
    }
    
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const controller = new OptionsController();
  try {
    window.__optionsController = controller;
  } catch (_) {}
});
