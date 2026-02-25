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
    'cloudflare-free': { name: 'Cloudflare', supportsImages: true },
    'chrome-summarizer': { name: 'Chrome', supportsImages: false },
    'openai': { name: 'OpenAI', supportsImages: true },
    'openrouter': { name: 'OpenRouter', supportsImages: true },
    'huggingface': { name: 'HuggingFace', supportsImages: true }
  };

  const IMAGE_PROVIDERS = {
    'gemini-free': { name: 'Gemini' },
    'cloudflare-free': { name: 'Cloudflare' },
    'openai': { name: 'OpenAI' },
    'openrouter': { name: 'OpenRouter' },
    'huggingface': { name: 'HuggingFace' }
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

    it('should return OpenRouter as image-capable provider', () => {
      const provider = IMAGE_PROVIDERS['openrouter'];
      expect(provider).toBeDefined();
      expect(provider.name).toBe('OpenRouter');
    });

    it('should return Hugging Face as image-capable provider', () => {
      const provider = IMAGE_PROVIDERS['huggingface'];
      expect(provider).toBeDefined();
      expect(provider.name).toBe('HuggingFace');
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
      const textProvider = 'openrouter';
      const imageProvider = 'openai';
      
      expect(TEXT_PROVIDERS[textProvider].supportsImages).toBe(true);
      expect(IMAGE_PROVIDERS[imageProvider]).toBeDefined();
    });

    it('should support Cloudflare for both text and image', () => {
      const textProvider = 'cloudflare-free';
      const imageProvider = 'cloudflare-free';

      expect(TEXT_PROVIDERS[textProvider].supportsImages).toBe(true);
      expect(IMAGE_PROVIDERS[imageProvider]).toBeDefined();
    });
  });
});

describe('Storyboard Parse Retry Strategy', () => {
  function isMalformedStoryboardError(error) {
    const msg = String((error && error.message) || error || '').toLowerCase();
    return /failed to parse storyboard|no panels found|no json object found|malformed/i.test(msg);
  }

  async function generateWithMalformedRetry(mockProvider) {
    try {
      return await mockProvider.generateStoryboard({ malformedRetry: false });
    } catch (error) {
      if (!isMalformedStoryboardError(error)) throw error;
      return mockProvider.generateStoryboard({ malformedRetry: true });
    }
  }

  it('retries once when storyboard parse is malformed', async () => {
    const provider = {
      generateStoryboard: vi.fn()
        .mockRejectedValueOnce(new Error('Failed to parse storyboard: No JSON object found'))
        .mockResolvedValueOnce({ panels: [{ caption: 'ok', image_prompt: 'ok' }] })
    };

    const result = await generateWithMalformedRetry(provider);
    expect(result.panels).toHaveLength(1);
    expect(provider.generateStoryboard).toHaveBeenCalledTimes(2);
    expect(provider.generateStoryboard.mock.calls[1][0]).toEqual({ malformedRetry: true });
  });

  it('does not retry non-parse provider errors', async () => {
    const provider = {
      generateStoryboard: vi.fn().mockRejectedValueOnce(new Error('Quota exceeded'))
    };

    await expect(generateWithMalformedRetry(provider)).rejects.toThrow('Quota exceeded');
    expect(provider.generateStoryboard).toHaveBeenCalledTimes(1);
  });

  it('retries with panel count reminder when provider returns too few panels', async () => {
    const provider = {
      generateStoryboard: vi.fn()
        .mockResolvedValueOnce({ panels: [{ caption: 'only one', image_prompt: 'one' }] })
        .mockResolvedValueOnce({ panels: [
          { caption: '1', image_prompt: '1' },
          { caption: '2', image_prompt: '2' },
          { caption: '3', image_prompt: '3' }
        ] })
    };

    async function generateWithQualityRetry(requestedCount) {
      const first = await provider.generateStoryboard({ panelCountRetry: false });
      if ((first?.panels?.length || 0) > 0 && (first.panels.length < requestedCount)) {
        return provider.generateStoryboard({ panelCountRetry: true });
      }
      return first;
    }

    const result = await generateWithQualityRetry(3);
    expect(result.panels).toHaveLength(3);
    expect(provider.generateStoryboard).toHaveBeenCalledTimes(2);
    expect(provider.generateStoryboard.mock.calls[1][0]).toEqual({ panelCountRetry: true });
  });

  it('allows fallback after malformed storyboard remains bad', async () => {
    const errors = [];
    async function attemptProviders() {
      const providers = [
        { id: 'a', generateStoryboard: vi.fn().mockRejectedValue(new Error('Failed to parse storyboard: No JSON object found')) },
        { id: 'b', generateStoryboard: vi.fn().mockResolvedValue({ panels: [{ caption: 'ok', image_prompt: 'ok' }] }) }
      ];
      for (let i = 0; i < providers.length; i++) {
        try {
          const result = await providers[i].generateStoryboard({});
          return { result, tried: i + 1 };
        } catch (e) {
          e.malformedStoryboard = /parse storyboard/i.test(String(e.message || e));
          errors.push(e);
          if (!e.malformedStoryboard) throw e;
        }
      }
      throw errors[errors.length - 1];
    }

    const out = await attemptProviders();
    expect(out.result.panels).toHaveLength(1);
    expect(out.tried).toBe(2);
  });
});

describe('Budget Fallback Policy', () => {
  const isBudgetProviderErrorMessage = (message) => {
    const text = String(message || '').toLowerCase();
    return /insufficient_quota|quota|budget|billing|payment required|402|exceeded your current quota|free[_ -]?tier|limit:\s*0|resource_exhausted|credits?\b/i.test(text);
  };

  const getBudgetFallbackTextProviderOrder = (currentProviderId) => {
    const preferred = ['gemini-free', 'cloudflare-free', 'openrouter', 'huggingface', 'openai'];
    return preferred.filter((id, index, arr) => id !== currentProviderId && arr.indexOf(id) === index);
  };

  const getBudgetFallbackImageProviderOrder = (currentProviderId) => {
    const preferred = ['gemini-free', 'cloudflare-free', 'huggingface', 'openrouter', 'openai'];
    return preferred.filter((id, index, arr) => id !== currentProviderId && arr.indexOf(id) === index);
  };

  it('detects quota/budget/billing errors for cross-provider fallback', () => {
    expect(isBudgetProviderErrorMessage('You exceeded your current quota')).toBe(true);
    expect(isBudgetProviderErrorMessage('Quota exceeded: generate_content_free_tier_requests, limit: 0')).toBe(true);
    expect(isBudgetProviderErrorMessage('Payment required for this model')).toBe(true);
    expect(isBudgetProviderErrorMessage('Request timed out')).toBe(false);
    expect(isBudgetProviderErrorMessage('Failed to parse storyboard')).toBe(false);
  });

  it('uses free-tier-first fallback ordering for text and image providers', () => {
    expect(getBudgetFallbackTextProviderOrder('openai')).toEqual([
      'gemini-free',
      'cloudflare-free',
      'openrouter',
      'huggingface'
    ]);
    expect(getBudgetFallbackImageProviderOrder('openai')).toEqual([
      'gemini-free',
      'cloudflare-free',
      'huggingface',
      'openrouter'
    ]);
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

describe('Service Worker Resilience Logic (helper semantics)', () => {
  function isTransientProviderErrorMessage(message) {
    const text = String(message || '').toLowerCase();
    return /timeout|timed out|failed to fetch|fetch failed|temporar|overload|503|502|504|rate limit|too many requests|429|connection reset|econnreset|socket/i.test(text);
  }

  function compactJobForStorage(job, level = 1) {
    const compact = JSON.parse(JSON.stringify(job));
    const keepExtractLen = level >= 3 ? 300 : (level >= 2 ? 1000 : 2000);
    if (typeof compact.extractedText === 'string' && compact.extractedText.length > keepExtractLen) {
      compact.extractedText = compact.extractedText.slice(0, keepExtractLen) + '...';
    }
    const keepEvents = level >= 3 ? 5 : (level >= 2 ? 10 : 15);
    if (Array.isArray(compact.progressEvents) && compact.progressEvents.length > keepEvents) {
      compact.progressEvents = compact.progressEvents.slice(-keepEvents);
    }
    if (Array.isArray(compact.panelErrors) && level >= 2 && compact.panelErrors.length > 10) {
      compact.panelErrors = compact.panelErrors.slice(-10);
    }
    if (compact.storyboard?.panels) {
      compact.storyboard.panels = compact.storyboard.panels.map((p) => {
        const panel = JSON.parse(JSON.stringify(p));
        if (panel?.artifacts?.image_blob_ref) {
          panel.artifacts.image_omitted_due_to_quota = true;
          delete panel.artifacts.image_blob_ref;
        }
        if (level >= 2 && typeof panel.image_prompt === 'string' && panel.image_prompt.length > 240) {
          panel.image_prompt = panel.image_prompt.slice(0, 240) + '...';
        }
        if (level >= 3 && typeof panel.beat_summary === 'string' && panel.beat_summary.length > 160) {
          panel.beat_summary = panel.beat_summary.slice(0, 160) + '...';
        }
        return panel;
      });
      if (level >= 3 && compact.storyboard.panels.length > 20) {
        compact.storyboard.panels = compact.storyboard.panels.slice(0, 20);
        compact.storyboard.panels_truncated_for_quota = true;
      }
    }
    return compact;
  }

  it('classifies timeout/network/rate-limit errors as transient', () => {
    expect(isTransientProviderErrorMessage('Request timed out after 90000ms')).toBe(true);
    expect(isTransientProviderErrorMessage('Failed to fetch')).toBe(true);
    expect(isTransientProviderErrorMessage('429 Too Many Requests')).toBe(true);
    expect(isTransientProviderErrorMessage('503 Service Unavailable')).toBe(true);
    expect(isTransientProviderErrorMessage('content policy violation')).toBe(false);
    expect(isTransientProviderErrorMessage('invalid api key')).toBe(false);
  });

  it('compacts job progressively for quota pressure edge cases', () => {
    const job = {
      extractedText: 'x'.repeat(5000),
      progressEvents: Array.from({ length: 30 }, (_, i) => ({ i })),
      panelErrors: Array.from({ length: 20 }, (_, i) => ({ i })),
      storyboard: {
        panels: Array.from({ length: 25 }, (_, i) => ({
          panel_id: `panel_${i + 1}`,
          beat_summary: 'b'.repeat(300),
          image_prompt: 'p'.repeat(500),
          artifacts: { image_blob_ref: 'data:image/png;base64,' + 'a'.repeat(2000) }
        }))
      }
    };

    const l1 = compactJobForStorage(job, 1);
    expect(l1.extractedText.length).toBeLessThanOrEqual(2003);
    expect(l1.progressEvents.length).toBe(15);
    expect(l1.storyboard.panels[0].artifacts.image_blob_ref).toBeUndefined();
    expect(l1.storyboard.panels[0].artifacts.image_omitted_due_to_quota).toBe(true);

    const l2 = compactJobForStorage(job, 2);
    expect(l2.progressEvents.length).toBe(10);
    expect(l2.panelErrors.length).toBe(10);
    expect(l2.storyboard.panels[0].image_prompt.length).toBeLessThanOrEqual(243);

    const l3 = compactJobForStorage(job, 3);
    expect(l3.progressEvents.length).toBe(5);
    expect(l3.storyboard.panels.length).toBe(20);
    expect(l3.storyboard.panels_truncated_for_quota).toBe(true);
    expect(l3.storyboard.panels[0].beat_summary.length).toBeLessThanOrEqual(163);
  });

  it('filters invalid dates during cleanup logic', () => {
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    const history = [
      { generated_at: new Date(now - 1000).toISOString() },
      { generated_at: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString() },
      { generated_at: 'not-a-date' }
    ];
    const filtered = history.filter((item) => {
      const ts = new Date(item && item.generated_at).getTime();
      return Number.isFinite(ts) && ts > thirtyDaysAgo;
    });
    expect(filtered.length).toBe(1);
  });

  it('normalizes malformed storyboard payloads to a safe panels array', () => {
    const normalizeStoryboard = (storyboard) => {
      const normalized = (storyboard && typeof storyboard === 'object') ? storyboard : {};
      if (!Array.isArray(normalized.panels)) normalized.panels = [];
      return normalized;
    };

    expect(normalizeStoryboard(null).panels).toEqual([]);
    expect(normalizeStoryboard('bad').panels).toEqual([]);
    expect(normalizeStoryboard({ panels: 'not-array' }).panels).toEqual([]);
    expect(normalizeStoryboard({ panels: [{ caption: 'ok' }] }).panels.length).toBe(1);
  });

  it('treats provider success without image data as an error (not completed panel)', () => {
    const finalizePanelImageResult = (imageResult) => {
      if (!imageResult || !imageResult.imageData) {
        throw new Error('Provider returned no image data');
      }
      return {
        artifacts: {
          image_blob_ref: imageResult.imageData
        }
      };
    };

    expect(() => finalizePanelImageResult({ providerMetadata: { provider_id: 'gemini-free' } }))
      .toThrow('Provider returned no image data');
    expect(finalizePanelImageResult({ imageData: 'data:image/png;base64,abc' }).artifacts.image_blob_ref)
      .toContain('data:image/png;base64,');
  });

  it('detects unexpected output counts for missing/partial images and captions', () => {
    const summarizeOutput = (job) => {
      const panels = Array.isArray(job?.storyboard?.panels) ? job.storyboard.panels : [];
      const expected = Number(job?.settings?.panel_count || panels.length || 0);
      let imageCount = 0;
      let textCount = 0;
      for (const panel of panels) {
        const hasImage = !!(panel?.artifacts?.image_blob_ref);
        if (hasImage) imageCount += 1;
        const candidates = [
          panel?.caption,
          panel?.beat_summary,
          panel?.summary,
          panel?.title,
          panel?.text,
          panel?.narration,
          panel?.description,
          panel?.text_content,
          panel?.caption_text,
          panel?.dialogue
        ];
        if (candidates.some((v) => typeof v === 'string' && v.trim())) textCount += 1;
      }
      return {
        expected,
        imageCount,
        textCount,
        imageState: imageCount === 0 ? 'none' : (imageCount < expected ? 'partial' : 'complete'),
        textState: textCount === 0 ? 'none' : (textCount < expected ? 'partial' : 'complete')
      };
    };

    const partial = summarizeOutput({
      settings: { panel_count: 3 },
      storyboard: {
        panels: [
          { caption: 'A', artifacts: { image_blob_ref: 'data:image/png;base64,1' } },
          { beat_summary: 'B', artifacts: {} },
          { artifacts: {} }
        ]
      }
    });
    expect(partial.imageState).toBe('partial');
    expect(partial.textState).toBe('partial');
    expect(partial.imageCount).toBe(1);
    expect(partial.textCount).toBe(2);

    const none = summarizeOutput({
      settings: { panel_count: 2 },
      storyboard: { panels: [{}, {}] }
    });
    expect(none.imageState).toBe('none');
    expect(none.textState).toBe('none');
  });

  it('validates storyboard contract centrally and synthesizes missing caption/image_prompt fields', () => {
    function normalizeLooseTextValue(value) {
      if (value == null) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (Array.isArray(value)) return value.map(normalizeLooseTextValue).filter(Boolean).join(' ').trim();
      if (typeof value === 'object') {
        return normalizeLooseTextValue(value.text || value.title || value.summary || value.description || value.value || '');
      }
      return '';
    }
    function validateStoryboardContract(storyboard, requestedPanelCount) {
      const normalized = (storyboard && typeof storyboard === 'object') ? storyboard : {};
      if (!Array.isArray(normalized.panels)) normalized.panels = [];
      normalized.panels = normalized.panels.map((panel, index) => {
        const p = panel && typeof panel === 'object' ? { ...panel } : {};
        const beat = normalizeLooseTextValue(p.beat_summary || p.summary || p.description || p.text);
        const caption = normalizeLooseTextValue(p.caption || p.title || p.dialogue) || beat || `Panel ${index + 1}`;
        const imagePrompt = normalizeLooseTextValue(p.image_prompt || p.prompt || p.visual) || `Comic panel illustration of: ${caption}${beat ? `. ${beat}` : ''}`;
        p.caption = caption;
        p.image_prompt = imagePrompt;
        if (!p.panel_id) p.panel_id = `panel_${index + 1}`;
        return p;
      }).slice(0, requestedPanelCount || undefined);
      return normalized;
    }

    const result = validateStoryboardContract({
      panels: [
        { summary: { text: 'A lead panel summary' } },
        { caption: { text: 'Object caption' } },
        { title: 'Titled panel', image_prompt: '' }
      ]
    }, 3);

    expect(Array.isArray(result.panels)).toBe(true);
    expect(result.panels).toHaveLength(3);
    expect(result.panels[0].caption).toBe('A lead panel summary');
    expect(result.panels[0].image_prompt).toContain('Comic panel illustration of');
    expect(result.panels[1].caption).toBe('Object caption');
    expect(result.panels[1].image_prompt).toContain('Object caption');
    expect(result.panels[2].caption).toBe('Titled panel');
    expect(result.panels[2].image_prompt).toContain('Titled panel');
  });

  it('treats empty storyboard panels as terminal validation failure (pre-image phase)', () => {
    function validateStoryboardContract(storyboard) {
      const normalized = (storyboard && typeof storyboard === 'object') ? storyboard : {};
      if (!Array.isArray(normalized.panels)) normalized.panels = [];
      return { storyboard: normalized, meta: { hasPanelsArray: Array.isArray(storyboard?.panels), panelCount: normalized.panels.length } };
    }
    function assertNonEmptyStoryboardOrThrow(storyboard) {
      const contract = validateStoryboardContract(storyboard);
      if (!contract.meta.hasPanelsArray || contract.meta.panelCount === 0) {
        const err = new Error('Storyboard returned no panels');
        err.malformedStoryboard = true;
        throw err;
      }
      return contract.storyboard;
    }

    expect(() => assertNonEmptyStoryboardOrThrow({ panels: [] })).toThrow('Storyboard returned no panels');
    expect(() => assertNonEmptyStoryboardOrThrow({ panels: [{}] })).not.toThrow();
  });
});
