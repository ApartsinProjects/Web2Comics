// Test setup and global mocks
global.TEST_OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-openai-key';
global.TEST_DEFAULT_PROVIDER = 'openai';
global.__WEB2COMICS_TEST_LOGS__ = true;

// Mock chrome API for browser extension
global.chrome = {
  runtime: {
    id: 'test-extension-id',
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn()
    },
    openOptionsPage: vi.fn(),
    getURL: vi.fn((path) => `chrome-extension://test/${path}`)
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn()
    },
    sync: {
      get: vi.fn(),
      set: vi.fn()
    }
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
    create: vi.fn()
  },
  sidePanel: {
    open: vi.fn(),
    setOptions: vi.fn()
  },
  action: {
    openPopup: vi.fn()
  },
  extension: {
    getViews: vi.fn().mockReturnValue([])
  },
  alarms: {
    create: vi.fn(),
    onAlarm: {
      addListener: vi.fn()
    }
  },
  contextMenus: {
    create: vi.fn(),
    removeAll: vi.fn((cb) => {
      if (typeof cb === 'function') cb();
    }),
    onClicked: {
      addListener: vi.fn()
    }
  },
  ai: undefined // Will be mocked in specific tests
};

// Mock fetch for API calls
global.fetch = vi.fn();

// Mock URL and URLSearchParams
global.URL = class URL {
  constructor(url) {
    this.href = url;
    this.pathname = url.split('/').slice(3).join('/') || '/';
  }
  createObjectURL = vi.fn(() => 'blob:test-url');
  revokeObjectURL = vi.fn();
};

global.FileReader = class FileReader {
  readAsDataURL() {
    if (this.onloadend) {
      this.onloadend();
    }
  }
};

// Test utilities
global.createMockProvider = (overrides = {}) => ({
  capabilities: {
    supportsImages: true,
    maxPromptLength: 8000,
    rateLimitBehavior: 'strict',
    costTag: 'paid'
  },
  initialize: vi.fn().mockResolvedValue(undefined),
  generateStoryboard: vi.fn(),
  generateImage: vi.fn(),
  validateCredentials: vi.fn().mockResolvedValue(true),
  ...overrides
});

global.createMockJob = (overrides = {}) => ({
  id: 'test-job-1',
  status: 'pending',
  sourceUrl: 'https://example.com/article',
  sourceTitle: 'Test Article',
  extractedText: 'This is test content for the comic strip generation.',
  settings: {
    panel_count: 6,
    detail_level: 'medium',
    style_id: 'default',
    caption_len: 'short',
    provider_text: 'openai',
    provider_image: 'openai'
  },
  storyboard: null,
  currentPanelIndex: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides
});

global.createMockStoryboard = (overrides = {}) => ({
  schema_version: '1.0',
  source: {
    url: 'https://example.com',
    title: 'Test',
    extracted_at: new Date().toISOString()
  },
  settings: {
    panel_count: 6,
    detail_level: 'medium',
    style_id: 'default',
    caption_len: 'short',
    provider_text: 'openai',
    provider_image: 'openai'
  },
  panels: [
    {
      panel_id: 'panel_1',
      beat_summary: 'Introduction to the topic',
      caption: 'The Beginning',
      image_prompt: 'A comic panel showing introduction'
    },
    {
      panel_id: 'panel_2',
      beat_summary: 'Main argument presented',
      caption: 'The Main Point',
      image_prompt: 'A comic panel showing main argument'
    }
  ],
  style_profile: {
    art_style: 'default'
  },
  ...overrides
});

// Console spy
export const spyOnConsole = () => {
  return {
    log: vi.spyOn(console, 'log'),
    error: vi.spyOn(console, 'error'),
    warn: vi.spyOn(console, 'warn')
  };
};
