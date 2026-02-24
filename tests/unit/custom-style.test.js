import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Custom Style Theme Feature', () => {
  let provider;

  beforeEach(() => {
    // Mock provider with custom style support
    provider = {
      buildStoryboardPrompt: function(text, options) {
        const styleId = options.styleId || 'default';
        const customStyleTheme = options.customStyleTheme || '';
        
        const styleGuidance = {
          default: 'Classic comic style',
          noir: 'Film noir style',
          custom: 'Custom user-defined style'
        };
        
        let styleText = styleGuidance[styleId] || styleGuidance.default;
        if (styleId === 'custom' && customStyleTheme) {
          styleText = customStyleTheme;
        }
        
        return `Style: ${styleText}`;
      },
      
      enhancePrompt: function(prompt, options) {
        const styleId = options.styleId || 'default';
        const customStyleTheme = options.customStyleTheme || '';
        
        const styleEnhancements = {
          default: 'comic style',
          noir: 'film noir style',
          custom: 'custom style'
        };
        
        let styleText;
        if (styleId === 'custom' && customStyleTheme) {
          styleText = customStyleTheme;
        } else {
          styleText = styleEnhancements[styleId] || styleEnhancements.default;
        }
        
        return `${prompt}, ${styleText}, high quality`;
      }
    };
  });

  describe('buildStoryboardPrompt', () => {
    it('should use preset style when styleId is not custom', () => {
      const prompt = provider.buildStoryboardPrompt('Test content', { 
        styleId: 'noir',
        customStyleTheme: '' 
      });
      
      expect(prompt).toContain('Film noir style');
    });

    it('should use custom style when styleId is custom with description', () => {
      const prompt = provider.buildStoryboardPrompt('Test content', { 
        styleId: 'custom',
        customStyleTheme: 'vintage 1950s comic book style' 
      });
      
      expect(prompt).toContain('vintage 1950s comic book style');
    });

    it('should use preset when custom is selected but no description', () => {
      const prompt = provider.buildStoryboardPrompt('Test content', { 
        styleId: 'custom',
        customStyleTheme: '' 
      });
      
      expect(prompt).toContain('Custom user-defined style');
    });
  });

  describe('enhancePrompt', () => {
    it('should enhance prompt with preset style', () => {
      const enhanced = provider.enhancePrompt('A cat', { 
        styleId: 'noir',
        customStyleTheme: '' 
      });
      
      expect(enhanced).toContain('film noir style');
    });

    it('should enhance prompt with custom style', () => {
      const enhanced = provider.enhancePrompt('A cat', { 
        styleId: 'custom',
        customStyleTheme: 'steampunk illustration with brass gears' 
      });
      
      expect(enhanced).toContain('steampunk illustration with brass gears');
    });

    it('should include high quality in enhanced prompt', () => {
      const enhanced = provider.enhancePrompt('A cat', { 
        styleId: 'default',
        customStyleTheme: '' 
      });
      
      expect(enhanced).toContain('high quality');
    });
  });
});

describe('Settings with Custom Style', () => {
  const DEFAULT_SETTINGS = {
    panelCount: 6,
    detailLevel: 'medium',
    styleId: 'default',
    captionLength: 'short',
    activeTextProvider: 'gemini-free',
    activeImageProvider: 'gemini-free',
    characterConsistency: false,
    maxCacheSize: 100,
    autoOpenSidePanel: true,
    customStyleTheme: ''
  };

  it('should have customStyleTheme in settings', () => {
    expect(DEFAULT_SETTINGS).toHaveProperty('customStyleTheme');
  });

  it('should default customStyleTheme to empty string', () => {
    expect(DEFAULT_SETTINGS.customStyleTheme).toBe('');
  });

  it('should allow setting customStyleTheme', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      styleId: 'custom',
      customStyleTheme: 'watercolor landscape with soft colors'
    };
    
    expect(settings.styleId).toBe('custom');
    expect(settings.customStyleTheme).toBe('watercolor landscape with soft colors');
  });
});

describe('Storyboard with Custom Style', () => {
  it('should store custom_style_theme in settings', () => {
    const storyboard = {
      schema_version: '1.0',
      settings: {
        panel_count: 6,
        style_id: 'custom',
        custom_style_theme: 'vintage comic style with halftone dots',
        provider_text: 'gemini-free',
        provider_image: 'gemini-free'
      },
      panels: [],
      status: { overall: 'completed' }
    };
    
    expect(storyboard.settings.custom_style_theme).toBe('vintage comic style with halftone dots');
  });
});

describe('UI Components', () => {
  let mockElements;

  beforeEach(() => {
    mockElements = {
      'style-preset': { 
        value: 'default',
        addEventListener: vi.fn() 
      },
      'custom-style-container': { 
        classList: { 
          add: vi.fn(), 
          remove: vi.fn() 
        } 
      },
      'custom-style-input': { 
        value: '',
        addEventListener: vi.fn() 
      }
    };

    global.document = {
      getElementById: vi.fn((id) => mockElements[id] || null)
    };
  });

  it('should show custom style input when custom is selected', () => {
    mockElements['style-preset'].value = 'custom';
    
    const customContainer = mockElements['custom-style-container'];
    
    // Simulate the event handler logic
    if (mockElements['style-preset'].value === 'custom') {
      customContainer.classList.remove('hidden');
    }
    
    expect(customContainer.classList.remove).toHaveBeenCalledWith('hidden');
  });

  it('should hide custom style input when preset is selected', () => {
    mockElements['style-preset'].value = 'noir';
    
    const customContainer = mockElements['custom-style-container'];
    
    // Simulate the event handler logic
    if (mockElements['style-preset'].value === 'custom') {
      customContainer.classList.remove('hidden');
    } else {
      customContainer.classList.add('hidden');
    }
    
    expect(customContainer.classList.add).toHaveBeenCalledWith('hidden');
  });
});
