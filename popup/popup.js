import { DEFAULT_SETTINGS } from '../shared/types.js';

class PopupController {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.extractedText = '';
    this.isGenerating = false;
    this.currentJobId = null;
    
    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.checkOnboarding();
    await this.extractContent();
    this.bindEvents();
    this.updateUI();
  }

  async loadSettings() {
    try {
      const stored = await chrome.storage.local.get(['settings', 'providers']);
      if (stored.settings) {
        this.settings = { ...DEFAULT_SETTINGS, ...stored.settings };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  async checkOnboarding() {
    const { onboardingComplete } = await chrome.storage.local.get('onboardingComplete');
    
    const onboardingSection = document.getElementById('onboarding-section');
    const mainSection = document.getElementById('main-section');
    
    if (!onboardingComplete) {
      onboardingSection.classList.remove('hidden');
      mainSection.classList.add('hidden');
    } else {
      onboardingSection.classList.add('hidden');
      mainSection.classList.remove('hidden');
    }
  }

  async extractContent() {
    const contentSource = document.querySelector('input[name="contentSource"]:checked').value;
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXTRACT_CONTENT',
        payload: { mode: contentSource }
      });
      
      if (response && response.success) {
        this.extractedText = response.text;
        this.updatePreview(response.text);
      } else {
        this.updatePreview(response?.error || 'Failed to extract content');
      }
    } catch (error) {
      console.error('Extraction error:', error);
      this.updatePreview('Unable to extract content. Try selecting text on the page.');
    }
  }

  updatePreview(text) {
    const previewEl = document.getElementById('preview-text');
    const charCountEl = document.getElementById('char-count');
    
    if (!text || text.length === 0) {
      previewEl.innerHTML = '<span class="loading">No content found</span>';
      charCountEl.textContent = '0';
      return;
    }
    
    const truncated = text.length > 500 ? text.substring(0, 500) + '...' : text;
    previewEl.textContent = truncated;
    charCountEl.textContent = text.length.toLocaleString();
  }

  bindEvents() {
    // Onboarding
    document.getElementById('onboarding-start-btn')?.addEventListener('click', () => this.completeOnboarding());
    
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
    });
    
    document.getElementById('detail-level').addEventListener('change', (e) => {
      this.settings.detailLevel = e.target.value;
      this.saveSettings();
    });
    
    document.getElementById('style-preset').addEventListener('change', (e) => {
      this.settings.styleId = e.target.value;
      
      const customStyleContainer = document.getElementById('custom-style-container');
      if (e.target.value === 'custom') {
        customStyleContainer.classList.remove('hidden');
      } else {
        customStyleContainer.classList.add('hidden');
      }
      
      this.saveSettings();
    });
    
    document.getElementById('custom-style-input').addEventListener('input', (e) => {
      this.settings.customStyleTheme = e.target.value;
    });
    
    document.getElementById('provider-preset').addEventListener('change', (e) => {
      this.settings.activeTextProvider = e.target.value;
      this.settings.activeImageProvider = e.target.value;
      this.updateProviderWarning();
      this.saveSettings();
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
    document.getElementById('style-preset').value = this.settings.styleId || 'default';
    document.getElementById('provider-preset').value = this.settings.activeTextProvider;
    
    // Handle custom style input visibility and value
    const customStyleContainer = document.getElementById('custom-style-container');
    const customStyleInput = document.getElementById('custom-style-input');
    if (this.settings.styleId === 'custom') {
      customStyleContainer.classList.remove('hidden');
      customStyleInput.value = this.settings.customStyleTheme || '';
    } else {
      customStyleContainer.classList.add('hidden');
    }
    
    this.updateProviderWarning();
  }

  updateProviderWarning() {
    const warning = document.getElementById('api-key-warning');
    const provider = this.settings.activeTextProvider;
    
    if (provider === 'gemini-free' || provider === 'openai') {
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }
  }

  async saveSettings() {
    try {
      await chrome.storage.local.set({ settings: this.settings });
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  async completeOnboarding() {
    await chrome.storage.local.set({ onboardingComplete: true });
    await this.loadSettings();
    
    document.getElementById('onboarding-section').classList.add('hidden');
    document.getElementById('main-section').classList.remove('hidden');
  }

  async startGeneration() {
    if (this.isGenerating) return;
    
    if (!this.extractedText || this.extractedText.length < 50) {
      alert('Please ensure there is enough content to generate a comic.');
      return;
    }
    
    this.isGenerating = true;
    this.showProgress();
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
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
            style_id: this.settings.styleId,
            caption_len: 'short',
            provider_text: this.settings.activeTextProvider,
            provider_image: this.settings.activeImageProvider,
            custom_style_theme: this.settings.customStyleTheme || ''
          }
        }
      });
      
      if (response && response.success) {
        this.currentJobId = response.jobId;
        this.startProgressPolling();
      } else {
        throw new Error(response?.error || 'Generation failed to start');
      }
    } catch (error) {
      console.error('Generation error:', error);
      this.hideProgress();
      this.isGenerating = false;
      alert('Failed to start generation: ' + error.message);
    }
  }

  showProgress() {
    document.getElementById('main-section').classList.add('hidden');
    document.getElementById('progress-section').classList.remove('hidden');
    document.getElementById('generate-btn').disabled = true;
  }

  hideProgress() {
    document.getElementById('main-section').classList.remove('hidden');
    document.getElementById('progress-section').classList.add('hidden');
    document.getElementById('generate-btn').disabled = false;
    this.isGenerating = false;
  }

  startProgressPolling() {
    const pollInterval = setInterval(async () => {
      if (!this.isGenerating) {
        clearInterval(pollInterval);
        return;
      }
      
      try {
        const { currentJob } = await chrome.storage.local.get('currentJob');
        
        if (!currentJob) {
          clearInterval(pollInterval);
          return;
        }
        
        this.updateProgressUI(currentJob);
        
        if (currentJob.status === 'completed') {
          clearInterval(pollInterval);
          this.hideProgress();
          this.isGenerating = false;
          document.getElementById('open-viewer-btn').disabled = false;
          await this.addToHistory(currentJob);
        } else if (currentJob.status === 'failed' || currentJob.status === 'canceled') {
          clearInterval(pollInterval);
          this.hideProgress();
          this.isGenerating = false;
          if (currentJob.error) {
            alert('Generation failed: ' + currentJob.error);
          }
        }
      } catch (error) {
        console.error('Poll error:', error);
      }
    }, 1000);
  }

  updateProgressUI(job) {
    const statusEl = document.getElementById('progress-status');
    const progressBar = document.getElementById('progress-bar');
    const panelProgress = document.getElementById('panel-progress');
    
    const statusMap = {
      pending: 'Preparing...',
      generating_text: 'Generating storyboard...',
      generating_images: 'Creating panels...',
      completed: 'Complete!',
      failed: 'Failed',
      canceled: 'Canceled'
    };
    
    statusEl.textContent = statusMap[job.status] || 'Processing...';
    
    if (job.status === 'generating_images' && job.storyboard?.panels) {
      const totalPanels = job.storyboard.panels.length;
      const completed = job.currentPanelIndex;
      const percent = Math.round((completed / totalPanels) * 100);
      progressBar.style.width = percent + '%';
      
      panelProgress.innerHTML = job.storyboard.panels.map((panel, index) => {
        const isComplete = index < completed;
        const isGenerating = index === completed && job.status === 'generating_images';
        
        return `
          <div class="panel-item">
            <div class="panel-thumb">
              ${panel.artifacts?.image_blob_ref 
                ? `<img src="${panel.artifacts.image_blob_ref}" alt="Panel ${index + 1}">`
                : `<svg width="24" height="24" fill="var(--text-muted)"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`
              }
            </div>
            <div class="panel-info">
              <div class="panel-caption">${panel.caption || `Panel ${index + 1}`}</div>
              <div class="panel-status ${isComplete ? 'done' : isGenerating ? 'generating' : 'pending'}">
                ${isComplete ? '✓ Done' : isGenerating ? 'Generating...' : 'Pending'}
              </div>
            </div>
          </div>
        `;
      }).join('');
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
    
    const { history } = await chrome.storage.local.get('history');
    const items = history || [];
    
    if (items.length === 0) {
      list.innerHTML = '<p class="empty-state">No comics generated yet</p>';
    } else {
      list.innerHTML = items.slice(0, 10).map(item => `
        <div class="history-item" data-id="${item.id}">
          <div class="history-thumb">
            ${item.thumbnail ? `<img src="${item.thumbnail}" alt="">` : ''}
          </div>
          <div class="history-info">
            <div class="history-title">${item.source.title || 'Untitled'}</div>
            <div class="history-meta">${new Date(item.generated_at).toLocaleDateString()}</div>
          </div>
        </div>
      `).join('');
      
      list.querySelectorAll('.history-item').forEach(el => {
        el.addEventListener('click', () => {
          this.openSidePanel();
          this.hideHistory();
        });
      });
    }
    
    modal.classList.remove('hidden');
  }

  hideHistory() {
    document.getElementById('history-modal').classList.add('hidden');
  }

  async clearHistory() {
    if (confirm('Are you sure you want to clear all history?')) {
      await chrome.storage.local.set({ history: [] });
      this.showHistory();
    }
  }

  async addToHistory(job) {
    if (!job.storyboard) return;
    
    const { history } = await chrome.storage.local.get('history');
    const entries = history || [];
    
    const thumbnail = job.storyboard.panels?.[0]?.artifacts?.image_blob_ref;
    
    const entry = {
      id: job.id,
      source: {
        url: job.sourceUrl,
        title: job.sourceTitle
      },
      generated_at: new Date().toISOString(),
      settings_snapshot: job.storyboard.settings,
      storyboard: job.storyboard,
      thumbnail
    };
    
    entries.unshift(entry);
    
    // Keep only last 50 entries
    if (entries.length > 50) {
      entries.pop();
    }
    
    await chrome.storage.local.set({ history: entries });
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
