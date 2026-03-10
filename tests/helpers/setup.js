// Test setup and global mocks
global.TEST_OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-openai-key';
global.TEST_DEFAULT_PROVIDER = 'openai';
global.__WEB2COMICS_TEST_LOGS__ = true;

// Mock chrome API for browser extension
global.chrome = {
  runtime: {
    id: 'test-extension-id',
    sendMessage: vi.fn(async (message) => {
      if (message && message.type === 'START_GENERATION' && global.chrome?.tabs?.sendMessage) {
        return global.chrome.tabs.sendMessage(1, message);
      }
      return { success: true };
    }),
    onMessage: {
      addListener: vi.fn()
    },
    openOptionsPage: vi.fn(),
    getURL: vi.fn((path) => `chrome-extension://test/${path}`),
    getManifest: vi.fn(() => ({ version: '1.0.4' }))
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

function createMockCanvasContext() {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn((text = '') => ({ width: String(text).length * 8 })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createPattern: vi.fn(() => null),
    setLineDash: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn()
  };
}

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: vi.fn(function getContext() {
      if (!this.__mockContext) this.__mockContext = createMockCanvasContext();
      return this.__mockContext;
    })
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'data:image/png;base64,TEST_CANVAS_EXPORT')
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    writable: true,
    value: vi.fn((callback) => {
      if (typeof callback === 'function') callback(new Blob(['test'], { type: 'image/png' }));
    })
  });
}
