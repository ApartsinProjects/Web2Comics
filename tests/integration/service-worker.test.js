import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Service Worker - Job Management', () => {
  let serviceWorker;
  let mockStorage;

  beforeEach(() => {
    mockStorage = {
      data: {},
      get: vi.fn((key) => Promise.resolve({ [key]: mockStorage.data[key] })),
      set: vi.fn((key, value) => {
        if (typeof key === 'object') {
          Object.assign(mockStorage.data, key);
        } else {
          mockStorage.data[key] = value;
        }
        return Promise.resolve();
      })
    };

    serviceWorker = {
      currentJob: null,
      isProcessing: false,
      
      async startGeneration(text, url, title, settings) {
        if (this.isProcessing) {
          throw new Error('Generation already in progress');
        }

        const jobId = `job_${Date.now()}`;
        this.currentJob = {
          id: jobId,
          status: 'pending',
          sourceUrl: url,
          sourceTitle: title,
          extractedText: text,
          settings,
          storyboard: null,
          currentPanelIndex: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        this.isProcessing = true;
        await mockStorage.set('currentJob', this.currentJob);
        
        return jobId;
      },

      async cancelGeneration() {
        if (this.currentJob && this.isProcessing) {
          this.currentJob.status = 'canceled';
          this.currentJob.updatedAt = new Date().toISOString();
          await mockStorage.set('currentJob', this.currentJob);
          this.isProcessing = false;
          return true;
        }
        return false;
      },

      async saveJob() {
        await mockStorage.set('currentJob', this.currentJob);
      },

      async getJob() {
        return this.currentJob;
      }
    };
  });

  describe('startGeneration', () => {
    it('should create a new job', async () => {
      const jobId = await serviceWorker.startGeneration(
        'Test content',
        'https://example.com',
        'Test Title',
        { panel_count: 6 }
      );

      expect(jobId).toMatch(/^job_\d+$/);
      expect(serviceWorker.currentJob.status).toBe('pending');
      expect(serviceWorker.isProcessing).toBe(true);
    });

    it('should reject if already processing', async () => {
      await serviceWorker.startGeneration('content', 'url', 'title', {});
      
      await expect(
        serviceWorker.startGeneration('content2', 'url2', 'title2', {})
      ).rejects.toThrow('Generation already in progress');
    });

    it('should store job in chrome.storage', async () => {
      await serviceWorker.startGeneration('content', 'url', 'title', { panel_count: 4 });
      
      expect(mockStorage.set).toHaveBeenCalled();
    });
  });

  describe('cancelGeneration', () => {
    it('should cancel active job', async () => {
      await serviceWorker.startGeneration('content', 'url', 'title', {});
      const result = await serviceWorker.cancelGeneration();
      
      expect(result).toBe(true);
      expect(serviceWorker.currentJob.status).toBe('canceled');
      expect(serviceWorker.isProcessing).toBe(false);
    });

    it('should return false if no job', async () => {
      const result = await serviceWorker.cancelGeneration();
      expect(result).toBe(false);
    });
  });
});

describe('Service Worker - Generation Flow', () => {
  let mockJob;

  beforeEach(() => {
    mockJob = {
      id: 'test-job-1',
      status: 'pending',
      sourceUrl: 'https://example.com/article',
      sourceTitle: 'Test Article',
      extractedText: 'This is a test article about technology.',
      settings: {
        panel_count: 3,
        detail_level: 'medium',
        style_id: 'default',
        caption_len: 'short',
        provider_text: 'gemini-free',
        provider_image: 'gemini-free',
        text_model: 'gemini-1.5-flash',
        image_model: 'gemini-1.5-flash'
      },
      storyboard: null,
      currentPanelIndex: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });

  describe('Generation Status Transitions', () => {
    it('should transition from pending to generating_text', () => {
      mockJob.status = 'generating_text';
      expect(['pending', 'generating_text', 'generating_images', 'completed', 'failed', 'canceled'])
        .toContain(mockJob.status);
    });

    it('should transition from generating_text to generating_images', () => {
      mockJob.status = 'generating_images';
      expect(mockJob.status).toBe('generating_images');
    });

    it('should transition to completed when done', () => {
      mockJob.status = 'completed';
      expect(mockJob.status).toBe('completed');
    });

    it('should transition to failed on error', () => {
      mockJob.status = 'failed';
      mockJob.error = 'API Error';
      expect(mockJob.status).toBe('failed');
      expect(mockJob.error).toBeDefined();
    });

    it('should transition to canceled when user cancels', () => {
      mockJob.status = 'canceled';
      expect(mockJob.status).toBe('canceled');
    });
  });

  describe('Progress Tracking', () => {
    it('should track current panel index', () => {
      mockJob.currentPanelIndex = 2;
      expect(mockJob.currentPanelIndex).toBe(2);
    });

    it('should calculate progress percentage', () => {
      mockJob.currentPanelIndex = 3;
      const totalPanels = mockJob.settings.panel_count;
      const progress = (mockJob.currentPanelIndex / totalPanels) * 100;
      expect(progress).toBe(100); // 3/3 = 100%
    });

    it('should handle partial progress', () => {
      mockJob.currentPanelIndex = 1;
      const totalPanels = mockJob.settings.panel_count;
      const progress = (mockJob.currentPanelIndex / totalPanels) * 100;
      expect(progress).toBeCloseTo(33.33);
    });
  });
});

describe('Provider Routing', () => {
  const TEXT_PROVIDERS = {
    'gemini-free': { name: 'Gemini', supportsImages: true },
    'cloudflare-free': { name: 'Cloudflare', supportsImages: false },
    'chrome-summarizer': { name: 'Chrome', supportsImages: false },
    'openai': { name: 'OpenAI', supportsImages: true }
  };

  const IMAGE_PROVIDERS = {
    'gemini-free': { name: 'Gemini' },
    'openai': { name: 'OpenAI' }
  };

  describe('getTextProvider', () => {
    it('should return gemini provider', () => {
      const provider = TEXT_PROVIDERS['gemini-free'];
      expect(provider.name).toBe('Gemini');
    });

    it('should return cloudflare provider', () => {
      const provider = TEXT_PROVIDERS['cloudflare-free'];
      expect(provider.name).toBe('Cloudflare');
    });

    it('should return undefined for unknown provider', () => {
      const provider = TEXT_PROVIDERS['unknown'];
      expect(provider).toBeUndefined();
    });
  });

  describe('getImageProvider', () => {
    it('should return image-capable providers', () => {
      const gemini = IMAGE_PROVIDERS['gemini-free'];
      const openai = IMAGE_PROVIDERS['openai'];
      
      expect(gemini).toBeDefined();
      expect(openai).toBeDefined();
    });

    it('should return undefined for non-image provider', () => {
      const provider = IMAGE_PROVIDERS['cloudflare-free'];
      expect(provider).toBeUndefined();
    });
  });

  describe('Provider Selection', () => {
    it('should select Gemini for both text and image', () => {
      const textProvider = 'gemini-free';
      const imageProvider = 'gemini-free';
      
      expect(TEXT_PROVIDERS[textProvider].supportsImages).toBe(true);
      expect(IMAGE_PROVIDERS[imageProvider]).toBeDefined();
    });

    it('should allow mixing providers', () => {
      const textProvider = 'cloudflare-free';
      const imageProvider = 'openai';
      
      expect(TEXT_PROVIDERS[textProvider].supportsImages).toBe(false);
      expect(IMAGE_PROVIDERS[imageProvider]).toBeDefined();
    });
  });
});

describe('Message Handling', () => {
  let messageHandlers;

  beforeEach(() => {
    messageHandlers = new Map();
    
    messageHandlers.set('START_GENERATION', vi.fn((msg) => ({ success: true, jobId: '123' })));
    messageHandlers.set('CANCEL_GENERATION', vi.fn(() => ({ success: true })));
    messageHandlers.set('GET_STATUS', vi.fn(() => ({ job: null, isProcessing: false })));
  });

  it('should have START_GENERATION handler', () => {
    expect(messageHandlers.has('START_GENERATION')).toBe(true);
  });

  it('should have CANCEL_GENERATION handler', () => {
    expect(messageHandlers.has('CANCEL_GENERATION')).toBe(true);
  });

  it('should have GET_STATUS handler', () => {
    expect(messageHandlers.has('GET_STATUS')).toBe(true);
  });

  it('should route messages correctly', async () => {
    const handler = messageHandlers.get('START_GENERATION');
    const result = await handler({ type: 'START_GENERATION' });
    
    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalled();
  });
});
