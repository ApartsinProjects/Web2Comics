import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Popup UI', () => {
  let popup;
  let mockElements;

  beforeEach(() => {
    // Mock DOM elements
    mockElements = {
      'onboarding-section': { classList: { add: vi.fn(), remove: vi.fn() } },
      'main-section': { classList: { add: vi.fn(), remove: vi.fn() } },
      'progress-section': { classList: { add: vi.fn(), remove: vi.fn() } },
      'generate-btn': { 
        addEventListener: vi.fn(), 
        disabled: false,
        click: vi.fn()
      },
      'cancel-btn': { 
        addEventListener: vi.fn(),
        click: vi.fn()
      },
      'settings-btn': { addEventListener: vi.fn() },
      'history-btn': { addEventListener: vi.fn() },
      'panel-count': { 
        value: '6',
        addEventListener: vi.fn()
      },
      'detail-level': { 
        value: 'medium',
        addEventListener: vi.fn() 
      },
      'style-preset': { 
        value: 'default',
        addEventListener: vi.fn() 
      },
      'provider-preset': { 
        value: 'gemini-free',
        addEventListener: vi.fn() 
      },
      'preview-text': { 
        textContent: '',
        innerHTML: ''
      },
      'char-count': { textContent: '0' },
      'api-key-warning': { 
        classList: { add: vi.fn(), remove: vi.fn() } 
      },
      'open-viewer-btn': {
        disabled: true,
        addEventListener: vi.fn()
      },
      'progress-bar': { style: { width: '0%' } },
      'progress-status': { textContent: '' },
      'panel-progress': { innerHTML: '' },
      'history-modal': { classList: { add: vi.fn(), remove: vi.fn() } },
      'history-list': { innerHTML: '' },
      'close-history-btn': { addEventListener: vi.fn() },
      'clear-history-btn': { addEventListener: vi.fn() }
    };

    // Mock document.getElementById
    global.document = {
      getElementById: vi.fn((id) => mockElements[id] || null),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => ({ value: 'full', addEventListener: vi.fn() }))
    };

    // Mock chrome API
    global.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ settings: {}, providers: {} }),
          set: vi.fn().mockResolvedValue(undefined)
        }
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com', title: 'Test' }]),
        sendMessage: vi.fn().mockResolvedValue({ success: true, text: 'Test content' })
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ success: true }),
        openOptionsPage: vi.fn()
      },
      sidePanel: {
        open: vi.fn(),
        setOptions: vi.fn()
      },
      action: {
        openPopup: vi.fn()
      }
    };

    // Mock Event
    global.Event = class Event {
      constructor(type) {
        this.type = type;
        this.target = {};
      }
    };

    popup = {
      settings: {
        panelCount: 6,
        detailLevel: 'medium',
        styleId: 'default',
        activeTextProvider: 'gemini-free'
      },
      extractedText: 'Test extracted content for the comic',
      isGenerating: false,
      currentJobId: null,

      loadSettings: async function() {
        const stored = await chrome.storage.local.get('settings');
        if (stored.settings) {
          this.settings = { ...this.settings, ...stored.settings };
        }
      },

      updateUI: function() {
        document.getElementById('panel-count').value = this.settings.panelCount;
        document.getElementById('detail-level').value = this.settings.detailLevel;
      },

      updatePreview: function(text) {
        const previewEl = document.getElementById('preview-text');
        const charCountEl = document.getElementById('char-count');
        
        if (previewEl) {
          previewEl.textContent = text.substring(0, 500);
        }
        if (charCountEl) {
          charCountEl.textContent = text.length.toString();
        }
      },

      showProgress: function() {
        document.getElementById('main-section').classList.add('hidden');
        document.getElementById('progress-section').classList.remove('hidden');
      },

      hideProgress: function() {
        document.getElementById('progress-section').classList.add('hidden');
        document.getElementById('main-section').classList.remove('hidden');
      }
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('loadSettings', () => {
    it('should load settings from storage', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({
        settings: { panelCount: 8 }
      });

      await popup.loadSettings();
      expect(popup.settings.panelCount).toBe(8);
    });

    it('should use defaults when no stored settings', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({});

      await popup.loadSettings();
      expect(popup.settings.panelCount).toBe(6);
    });
  });

  describe('updatePreview', () => {
    it('should update preview text', () => {
      popup.updatePreview('Hello world');
      
      expect(mockElements['preview-text'].textContent).toBe('Hello world');
    });

    it('should update character count', () => {
      popup.updatePreview('Hello');
      
      expect(mockElements['char-count'].textContent).toBe('5');
    });

    it('should truncate long preview', () => {
      const longText = 'A'.repeat(1000);
      popup.updatePreview(longText);
      
      expect(mockElements['preview-text'].textContent.length).toBe(500);
    });
  });

  describe('showProgress', () => {
    it('should hide main section and show progress', () => {
      popup.showProgress();
      
      expect(mockElements['main-section'].classList.add).toHaveBeenCalledWith('hidden');
      expect(mockElements['progress-section'].classList.remove).toHaveBeenCalledWith('hidden');
    });
  });

  describe('hideProgress', () => {
    it('should show main section and hide progress', () => {
      popup.hideProgress();
      
      expect(mockElements['progress-section'].classList.add).toHaveBeenCalledWith('hidden');
      expect(mockElements['main-section'].classList.remove).toHaveBeenCalledWith('hidden');
    });
  });
});

describe('Comic Viewer UI', () => {
  let viewer;

  beforeEach(() => {
    global.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ currentJob: null, history: [] }),
          set: vi.fn().mockResolvedValue(undefined)
        }
      },
      runtime: {
        sendMessage: vi.fn()
      },
      action: {
        openPopup: vi.fn()
      }
    };

    viewer = {
      currentComic: null,
      viewMode: 'strip',

      displayComic: function(storyboard) {
        this.currentComic = storyboard;
      },

      setViewMode: function(mode) {
        this.viewMode = mode;
      },

      renderPanels: function(panels) {
        return panels.map((p, i) => `<div>Panel ${i + 1}: ${p.caption}</div>`).join('');
      }
    };
  });

  describe('displayComic', () => {
    it('should store current comic', () => {
      const storyboard = { 
        title: 'Test Comic', 
        panels: [{ caption: 'Panel 1' }] 
      };
      
      viewer.displayComic(storyboard);
      expect(viewer.currentComic).toEqual(storyboard);
    });
  });

  describe('setViewMode', () => {
    it('should change view mode to strip', () => {
      viewer.setViewMode('strip');
      expect(viewer.viewMode).toBe('strip');
    });

    it('should change view mode to panels', () => {
      viewer.setViewMode('panels');
      expect(viewer.viewMode).toBe('panels');
    });
  });

  describe('renderPanels', () => {
    it('should render all panels', () => {
      const panels = [
        { caption: 'Panel 1' },
        { caption: 'Panel 2' },
        { caption: 'Panel 3' }
      ];
      
      const html = viewer.renderPanels(panels);
      expect(html).toContain('Panel 1');
      expect(html).toContain('Panel 2');
      expect(html).toContain('Panel 3');
    });
  });
});

describe('Options Page', () => {
  let options;

  beforeEach(() => {
    global.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ 
            settings: {},
            apiKeys: {}
          }),
          set: vi.fn().mockResolvedValue(undefined)
        }
      }
    };

    options = {
      settings: {
        panelCount: 6,
        detailLevel: 'medium',
        styleId: 'default',
        captionLength: 'short'
      },

      saveSettings: async function(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        await chrome.storage.local.set({ settings: this.settings });
      }
    };
  });

  describe('saveSettings', () => {
    it('should save settings to storage', async () => {
      await options.saveSettings({ panelCount: 8 });
      
      expect(chrome.storage.local.set).toHaveBeenCalled();
      expect(options.settings.panelCount).toBe(8);
    });

    it('should merge with existing settings', async () => {
      await options.saveSettings({ panelCount: 10 });
      
      expect(options.settings.detailLevel).toBe('medium'); // preserved
      expect(options.settings.panelCount).toBe(10); // updated
    });
  });
});
