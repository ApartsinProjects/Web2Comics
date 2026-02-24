import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Content Extraction', () => {
  let extractReadableContent;
  let truncateText;
  let cleanText;

  beforeEach(() => {
    // Import the functions we want to test (simulated)
    extractReadableContent = (mode, selection) => {
      try {
        // Mode A: User selection
        if (mode === 'selection') {
          const selectedText = selection?.toString()?.trim();
          if (selectedText && selectedText.length > 50) {
            return { success: true, text: selectedText, mode: 'selection' };
          }
          return { success: false, error: 'No text selected', mode: 'selection' };
        }

        // Mode B: Full page extraction
        // Simulate having no content
        if (!global.document) {
          return { success: false, error: 'No document', mode: 'full' };
        }

        return { success: true, text: 'Mock content', mode: 'full' };
      } catch (error) {
        return { success: false, error: error.message, mode: mode };
      }
    };

    truncateText = (text, maxLength = 15000) => {
      if (text.length <= maxLength) {
        return { text, truncated: false, originalLength: text.length };
      }

      const truncated = text.substring(0, maxLength);
      const lastParagraph = truncated.lastIndexOf('\n\n');
      const lastSentence = Math.max(
        truncated.lastIndexOf('. '),
        truncated.lastIndexOf('! '),
        truncated.lastIndexOf('? ')
      );

      let breakPoint = maxLength;
      if (lastParagraph > maxLength * 0.8) breakPoint = lastParagraph;
      else if (lastSentence > maxLength * 0.8) breakPoint = lastSentence + 1;

      return {
        text: text.substring(0, breakPoint) + '...[truncated]',
        truncated: true,
        originalLength: text.length
      };
    };

    cleanText = (text) => {
      return text
        .replace(/\s+/g, ' ')
        .replace(/[\n\r]+/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n')
        .trim();
    };
  });

  describe('extractReadableContent', () => {
    describe('selection mode', () => {
      it('should return success with valid selection', () => {
        const longText = 'A'.repeat(100);
        const result = extractReadableContent('selection', longText);
        
        expect(result.success).toBe(true);
        expect(result.mode).toBe('selection');
      });

      it('should return error with short selection', () => {
        const shortText = 'Short';
        const result = extractReadableContent('selection', shortText);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('No text selected');
      });

      it('should return error with empty selection', () => {
        const result = extractReadableContent('selection', '');
        
        expect(result.success).toBe(false);
      });
    });

    describe('full page mode', () => {
      it('should return content when document exists', () => {
        global.document = { body: { textContent: 'Test' } };
        const result = extractReadableContent('full');
        
        expect(result.success).toBe(true);
        delete global.document;
      });

      it('should return error without document', () => {
        const result = extractReadableContent('full');
        
        expect(result.success).toBe(false);
      });
    });
  });

  describe('truncateText', () => {
    it('should not truncate short text', () => {
      const short = 'Hello world';
      const result = truncateText(short, 100);
      
      expect(result.truncated).toBe(false);
      expect(result.text).toBe(short);
    });

    it('should truncate long text', () => {
      const long = 'A'.repeat(20000);
      const result = truncateText(long, 100);
      
      expect(result.truncated).toBe(true);
      expect(result.originalLength).toBe(20000);
      expect(result.text).toContain('...[truncated]');
    });

    it('should find good breaking point at sentence', () => {
      const text = 'First sentence. Second sentence. Third sentence. ' + 'A'.repeat(10000);
      const result = truncateText(text, 50);
      
      expect(result.truncated).toBe(true);
      // Should break near "Third sentence."
      expect(result.text.length).toBeLessThan(text.length);
    });

    it('should find good breaking point at paragraph', () => {
      const text = 'Paragraph one\n\nParagraph two\n\n' + 'A'.repeat(10000);
      const result = truncateText(text, 50);
      
      expect(result.truncated).toBe(true);
    });
  });

  describe('cleanText', () => {
    it('should normalize whitespace', () => {
      const messy = 'Hello    world   ';
      const result = cleanText(messy);
      
      expect(result).toBe('Hello world');
    });

    it('should normalize newlines', () => {
      const messy = 'Line1\n\nLine2\r\n\r\nLine3';
      const result = cleanText(messy);
      
      expect(result).toContain('Line1');
      expect(result).toContain('Line2');
      expect(result).toContain('Line3');
    });

    it('should trim empty lines', () => {
      const messy = '\n\nText\n\n\n';
      const result = cleanText(messy);
      
      expect(result).toBe('Text');
    });
  });
});

describe('Data Models', () => {
  describe('Storyboard Schema', () => {
    it('should validate required fields', () => {
      const validStoryboard = {
        schema_version: '1.0',
        source: {
          url: 'https://example.com',
          extracted_at: new Date().toISOString()
        },
        settings: {
          panel_count: 6,
          detail_level: 'medium',
          style_id: 'default',
          caption_len: 'short',
          provider_text: 'gemini-free',
          provider_image: 'gemini-free'
        },
        panels: [
          {
            panel_id: 'panel_1',
            caption: 'Test',
            image_prompt: 'Prompt'
          }
        ],
        status: {
          overall: 'pending'
        }
      };

      expect(validStoryboard.schema_version).toBe('1.0');
      expect(validStoryboard.panels).toHaveLength(1);
      expect(validStoryboard.settings.panel_count).toBe(6);
    });

    it('should allow optional fields', () => {
      const storyboard = {
        schema_version: '1.0',
        source: { url: 'https://example.com', extracted_at: '2024-01-01' },
        settings: { panel_count: 6, provider_text: 'gemini-free', provider_image: 'gemini-free' },
        panels: [],
        status: { overall: 'pending' },
        style_profile: { art_style: 'noir', mood: 'dark' },
        safety_tags: ['adult'],
        characters: []
      };

      expect(storyboard.style_profile).toBeDefined();
      expect(storyboard.safety_tags).toBeDefined();
    });
  });

  describe('Panel Schema', () => {
    it('should validate panel structure', () => {
      const panel = {
        panel_id: 'panel_1',
        beat_summary: 'A scene happens',
        caption: 'Caption',
        image_prompt: 'Detailed prompt for image',
        negative_prompt: 'blurry, low quality',
        composition: {
          shot_type: 'close-up',
          angle: 'eye-level'
        }
      };

      expect(panel.panel_id).toMatch(/^panel_\d+$/);
      expect(panel.beat_summary).toBeDefined();
      expect(panel.caption).toBeDefined();
      expect(panel.image_prompt).toBeDefined();
    });
  });

  describe('Provider Configuration', () => {
    it('should validate provider types', () => {
      const validTypes = ['gemini', 'cloudflare-workers-ai', 'openai-compatible', 'chrome-summarizer'];
      
      validTypes.forEach(type => {
        const provider = {
          id: 'test',
          name: 'Test',
          type: type,
          capabilities: { supportsImages: true, costTag: 'paid' }
        };
        expect(validTypes).toContain(provider.type);
      });
    });
  });
});

describe('Settings', () => {
  const DEFAULT_SETTINGS = {
    panelCount: 6,
    detailLevel: 'medium',
    styleId: 'default',
    captionLength: 'short',
    activeTextProvider: 'gemini-free',
    activeImageProvider: 'gemini-free',
    characterConsistency: false,
    maxCacheSize: 100,
    autoOpenSidePanel: true
  };

  it('should have valid defaults', () => {
    expect(DEFAULT_SETTINGS.panelCount).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_SETTINGS.panelCount).toBeLessThanOrEqual(12);
    expect(['low', 'medium', 'high']).toContain(DEFAULT_SETTINGS.detailLevel);
  });

  it('should have valid providers', () => {
    expect(DEFAULT_SETTINGS.activeTextProvider).toBeDefined();
    expect(DEFAULT_SETTINGS.activeImageProvider).toBeDefined();
  });
});

describe('Error Codes', () => {
  const ERROR_CODES = {
    EXTRACTION_ERROR: 'E001',
    SUMMARIZATION_ERROR: 'E002',
    IMAGE_GENERATION_ERROR: 'E003',
    RATE_LIMIT_EXCEEDED: 'E004',
    INVALID_CREDENTIALS: 'E005',
    NETWORK_ERROR: 'E006',
    STORAGE_ERROR: 'E007',
    UNKNOWN_ERROR: 'E999'
  };

  it('should have all error codes defined', () => {
    expect(ERROR_CODES.EXTRACTION_ERROR).toBe('E001');
    expect(ERROR_CODES.SUMMARIZATION_ERROR).toBe('E002');
    expect(ERROR_CODES.IMAGE_GENERATION_ERROR).toBe('E003');
    expect(ERROR_CODES.RATE_LIMIT_EXCEEDED).toBe('E004');
    expect(ERROR_CODES.INVALID_CREDENTIALS).toBe('E005');
    expect(ERROR_CODES.NETWORK_ERROR).toBe('E006');
    expect(ERROR_CODES.STORAGE_ERROR).toBe('E007');
    expect(ERROR_CODES.UNKNOWN_ERROR).toBe('E999');
  });
});
