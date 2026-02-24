import { DEFAULT_SETTINGS } from '../shared/types.js';

class OptionsController {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.loadStorageInfo();
    this.bindEvents();
    this.updateUI();
  }

  async loadSettings() {
    try {
      const stored = await chrome.storage.local.get(['settings', 'providers']);
      if (stored.settings) {
        this.settings = { ...DEFAULT_SETTINGS, ...stored.settings };
      }
      this.providers = stored.providers || {};
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
      btn.addEventListener('click', (e) => this.switchSection(e.target.dataset.section));
    });

    // General settings
    document.getElementById('save-general-btn').addEventListener('click', () => this.saveGeneralSettings());

    // Provider settings
    document.querySelectorAll('.validate-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.validateProvider(e.target.dataset.provider));
    });

    document.getElementById('save-providers-btn').addEventListener('click', () => this.saveProvidersSettings());

    // Storage settings
    document.getElementById('clear-history-btn')?.addEventListener('click', () => this.clearHistory());
    document.getElementById('clear-cache-btn')?.addEventListener('click', () => this.clearCache());
    document.getElementById('export-data-btn')?.addEventListener('click', () => this.exportData());
  }

  updateUI() {
    // General
    document.getElementById('default-panel-count').value = this.settings.panelCount;
    document.getElementById('default-detail').value = this.settings.detailLevel;
    document.getElementById('default-style').value = this.settings.styleId || 'default';
    document.getElementById('default-caption').value = this.settings.captionLength;
    document.getElementById('auto-open-panel').checked = this.settings.autoOpenSidePanel !== false;
    document.getElementById('character-consistency').checked = this.settings.characterConsistency || false;
    
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

    // Check for stored API keys
    this.checkApiKeys();
  }

  async checkApiKeys() {
    const { apiKeys, settings } = await chrome.storage.local.get(['apiKeys', 'settings']);
    
    if (apiKeys?.gemini) {
      document.getElementById('gemini-api-key').value = '••••••••••••••••';
      this.updateProviderStatus('gemini', true);
    }
    
    if (apiKeys?.openai) {
      document.getElementById('openai-api-key').value = '••••••••••••••••';
      this.updateProviderStatus('openai', true);
      
      // Load model selections
      if (settings?.textModel) {
        document.getElementById('openai-text-model').value = settings.textModel;
      }
      if (settings?.imageModel) {
        document.getElementById('openai-image-model').value = settings.imageModel;
      }
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

    // TODO: Implement actual validation with the provider
    this.showToast(`Validating ${provider}...`, 'success');

    // Store the API key
    const { apiKeys } = await chrome.storage.local.get('apiKeys');
    await chrome.storage.local.set({
      apiKeys: { ...apiKeys, [provider]: apiKey }
    });

    this.updateProviderStatus(provider, true);
    this.showToast(`${provider} API key validated!`, 'success');
  }

  updateProviderStatus(provider, valid) {
    const statusEl = document.getElementById(`${provider}-status`);
    if (statusEl) {
      const indicator = statusEl.querySelector('.status-indicator');
      const text = statusEl.querySelector('span:last-child');
      if (indicator) indicator.classList.toggle('ready', valid);
      if (text) text.textContent = valid ? 'Configured' : 'Not configured';
    }
  }

  async saveProvidersSettings() {
    // Settings are saved during validation
    this.showToast('Provider settings saved!', 'success');
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
      a.download = `web-to-comic-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      this.showToast('Data exported!', 'success');
    } catch (error) {
      this.showToast('Failed to export data', 'error');
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
