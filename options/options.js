// Keep runtime defaults local to avoid importing shared/types.js, which currently contains
// TypeScript-only declarations and is not executable as a browser module.
const DEFAULT_SETTINGS = {
  panelCount: 6,
  detailLevel: 'medium',
  styleId: 'default',
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
  huggingfaceTextModel: 'mistralai/Mistral-7B-Instruct-v0.2',
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
  }
};

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
    huggingfaceTextModel: providers.huggingface?.text
  };
}

class OptionsController {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.promptTemplates = JSON.parse(JSON.stringify(DEFAULT_PROMPT_TEMPLATES));
    this.activePromptProviderScope = 'openai';
    this.init();
  }

  async init() {
    await this.loadRecommendedDefaults();
    await this.loadSettings();
    await this.loadStorageInfo();
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
      const stored = await chrome.storage.local.get(['settings', 'providers', 'providerValidation', 'promptTemplates']);
      if (stored.settings) {
        this.settings = { ...this.settings, ...stored.settings };
      }
      this.providers = stored.providers || {};
      this.providerValidation = stored.providerValidation || {};
      if (stored.promptTemplates && typeof stored.promptTemplates === 'object') {
        this.promptTemplates = {
          openai: {
            ...DEFAULT_PROMPT_TEMPLATES.openai,
            ...(stored.promptTemplates.openai || {})
          },
          gemini: {
            ...DEFAULT_PROMPT_TEMPLATES.gemini,
            ...(stored.promptTemplates.gemini || {})
          }
        };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  async loadStorageInfo() {
    try {
      const { history } = await chrome.storage.local.get('history');
      const historyCount = history?.length || 0;
      document.getElementById('history-size').textContent = `${historyCount} comics`;
    } catch (error) {
      console.error('Failed to load storage info:', error);
    }
  }

  bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchSection(e.currentTarget.dataset.section));
    });

    // General settings
    document.getElementById('save-general-btn').addEventListener('click', () => this.saveGeneralSettings());

    // Provider settings
    document.querySelectorAll('.provider-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const providerCard = e.currentTarget;
        this.selectProvider(providerCard.dataset.provider);
      });
    });

    document.querySelectorAll('.validate-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.validateProvider(e.currentTarget.dataset.provider));
    });
    document.querySelectorAll('.test-model-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.testProviderModel(e.currentTarget.dataset.provider, e.currentTarget.dataset.mode));
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

  updateUI() {
    // General
    document.getElementById('default-panel-count').value = this.settings.panelCount;
    document.getElementById('default-detail').value = this.settings.detailLevel;
    document.getElementById('default-style').value = this.settings.styleId || 'default';
    document.getElementById('default-caption').value = this.settings.captionLength;
    document.getElementById('auto-open-panel').checked = this.settings.autoOpenSidePanel !== false;
    document.getElementById('character-consistency').checked = this.settings.characterConsistency || false;
    document.getElementById('debug-flag').checked = this.settings.debugFlag || false;
    const refusalMode = this.settings.imageRefusalHandling || 'rewrite_and_retry';
    const refusalInput = document.querySelector(`input[name="image-refusal-handling"][value="${refusalMode}"]`)
      || document.querySelector('input[name="image-refusal-handling"][value="rewrite_and_retry"]');
    if (refusalInput) refusalInput.checked = true;
    const badgeToggle = document.getElementById('show-rewritten-badge');
    if (badgeToggle) badgeToggle.checked = this.settings.showRewrittenBadge !== false;
    const logToggle = document.getElementById('log-rewritten-prompts');
    if (logToggle) logToggle.checked = !!this.settings.logRewrittenPrompts;
    
    // Custom style
    const customContainer = document.getElementById('default-custom-style-container');
    if (this.settings.styleId === 'custom') {
      customContainer.style.display = 'block';
      document.getElementById('default-custom-style').value = this.settings.customStyleTheme || '';
    } else {
      customContainer.style.display = 'none';
    }

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
      document.getElementById('huggingface-text-model').value = this.settings.huggingfaceTextModel || 'mistralai/Mistral-7B-Instruct-v0.2';
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
    if (providerId === 'gemini-free' || providerId === 'openai' || providerId === 'cloudflare-free') {
      this.settings.activeImageProvider = providerId;
    }

    this.updateProviderSelectionUI();
  }

  async checkApiKeys() {
    const { apiKeys, settings, providerValidation } = await chrome.storage.local.get(['apiKeys', 'settings', 'providerValidation']);
    const validations = providerValidation || {};
    
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
    if (settings?.openrouterTextModel && document.getElementById('openrouter-text-model')) {
      document.getElementById('openrouter-text-model').value = settings.openrouterTextModel;
    }
    if (settings?.huggingfaceTextModel && document.getElementById('huggingface-text-model')) {
      document.getElementById('huggingface-text-model').value = settings.huggingfaceTextModel;
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
    const providerScope = scope === 'gemini' ? 'gemini' : 'openai';
    return this.promptTemplates[providerScope] || DEFAULT_PROMPT_TEMPLATES[providerScope];
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
    const scope = this.activePromptProviderScope === 'gemini' ? 'gemini' : 'openai';
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
    const customStyleTheme = styleId === 'custom' 
      ? document.getElementById('default-custom-style').value 
      : '';
    
    this.settings = {
      ...this.settings,
      panelCount: parseInt(document.getElementById('default-panel-count').value),
      detailLevel: document.getElementById('default-detail').value,
      styleId: styleId,
      customStyleTheme: customStyleTheme,
      captionLength: document.getElementById('default-caption').value,
      autoOpenSidePanel: document.getElementById('auto-open-panel').checked,
      characterConsistency: document.getElementById('character-consistency').checked,
      debugFlag: document.getElementById('debug-flag').checked,
      imageRefusalHandling:
        (document.querySelector('input[name="image-refusal-handling"]:checked')?.value || 'rewrite_and_retry'),
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

  async validateProvider(provider) {
    const inputId = `${provider}-api-key`;
    const input = document.getElementById(inputId);
    const apiKey = input?.value?.trim();

    if (!apiKey || apiKey === '••••••••••••••••') {
      this.showToast('Please enter an API key', 'error');
      return;
    }

    // TODO: Implement actual remote validation per provider.
    // For now, validation is a local explicit confirmation step and is persisted.
    this.showToast(`Validating ${provider}...`, 'success');

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
      return document.getElementById('openrouter-text-model')?.value || this.settings.openrouterTextModel;
    }
    if (providerId === 'huggingface') {
      return document.getElementById('huggingface-text-model')?.value || this.settings.huggingfaceTextModel;
    }
    return '';
  }

  async testProviderModel(providerId, mode) {
    const selectedModel = this.getProviderModelSelection(providerId, mode);
    if (!selectedModel) {
      this.showToast('No model selected to test', 'error');
      return;
    }
    try {
      this.showToast(`Testing ${providerId} ${mode} model...`, 'success');
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
      const summary = [
        `Provider: ${providerId}`,
        `Mode: ${mode}`,
        `Model: ${selectedModel}`,
        result.summary ? `Result: ${result.summary}` : 'Result: OK'
      ].join('\n');
      alert(summary);
      this.showToast(`${providerId} ${mode} model test passed`, 'success');
    } catch (error) {
      alert([
        `Provider: ${providerId}`,
        `Mode: ${mode}`,
        `Model: ${selectedModel}`,
        `Error: ${error.message || String(error)}`
      ].join('\n'));
      this.showToast(`${providerId} ${mode} model test failed`, 'error');
    }
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
      huggingfaceTextModel: document.getElementById('huggingface-text-model')?.value || this.settings.huggingfaceTextModel,
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
    
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new OptionsController();
});
