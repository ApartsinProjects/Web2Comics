// Chrome Built-in Summarization API Provider
// Uses Chrome's experimental summarization API for text-only summarization

export class ChromeSummarizerProvider {
  constructor() {
    this.capabilities = {
      supportsImages: false,
      maxPromptLength: 10000,
      rateLimitBehavior: 'none',
      costTag: 'free'
    };
  }

  get capabilities() {
    return {
      supportsImages: false,
      maxPromptLength: 10000,
      rateLimitBehavior: 'none',
      costTag: 'free'
    };
  }

  async initialize(config) {
    // No configuration needed
  }

  async generateStoryboard(text, options) {
    // Check if Chrome AI is available
    if (!('ai' in chrome)) {
      throw new Error('Chrome AI Summarization API not available');
    }

    try {
      const summarizer = await chrome.ai.createSummarizer({
        type: 'key-points',
        format: 'markdown',
        length: 'medium'
      });
      
      const summary = await summarizer.summarize(text);
      
      return this.buildStoryboardFromSummary(summary, options);
    } catch (error) {
      console.error('Chrome summarizer error:', error);
      throw new Error('Chrome AI summarization failed: ' + error.message);
    }
  }

  buildStoryboardFromSummary(summary, options) {
    const panelCount = options.panelCount || 6;
    const styleId = options.styleId || 'default';
    
    // Split summary into panel-worthy segments
    const sentences = summary.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const panels = [];
    
    const sentencesPerPanel = Math.ceil(sentences.length / panelCount);
    
    for (let i = 0; i < panelCount; i++) {
      const start = i * sentencesPerPanel;
      const end = Math.min(start + sentencesPerPanel, sentences.length);
      const panelSentences = sentences.slice(start, end);
      
      if (panelSentences.length > 0) {
        const beatSummary = panelSentences.join('. ').trim() + '.';
        
        panels.push({
          panel_id: `panel_${i + 1}`,
          beat_summary: beatSummary,
          caption: this.generateCaption(beatSummary, options.captionLength),
          image_prompt: this.generateImagePrompt(beatSummary, styleId)
        });
      } else {
        panels.push({
          panel_id: `panel_${i + 1}`,
          beat_summary: 'Additional content',
          caption: '...',
          image_prompt: 'Comic panel'
        });
      }
    }

    return {
      schema_version: '1.0',
      settings: {
        panel_count: panelCount,
        detail_level: options.detailLevel || 'medium',
        style_id: styleId,
        caption_len: options.captionLength || 'short',
        provider_text: 'chrome-summarizer',
        provider_image: 'chrome-summarizer'
      },
      panels,
      style_profile: {
        art_style: styleId
      }
    };
  }

  generateCaption(beatSummary, length) {
    const words = beatSummary.split(/\s+/).length;
    
    if (length === 'short') {
      return beatSummary.split(/\s+/).slice(0, 5).join(' ');
    } else if (length === 'long') {
      return beatSummary;
    }
    
    return beatSummary.split(/\s+/).slice(0, 8).join(' ');
  }

  generateImagePrompt(beatSummary, styleId) {
    const styles = {
      default: 'Classic comic book style with bold outlines and vibrant colors',
      noir: 'Film noir style, black and white, dramatic shadows',
      minimalist: 'Clean minimalist illustration with simple shapes',
      manga: 'Japanese manga anime style with expressive characters',
      superhero: 'American comic book superhero style',
      watercolor: 'Soft watercolor painting style with blended colors',
      pixel: 'Retro pixel art style'
    };

    return `${beatSummary}, ${styles[styleId] || styles.default}, high quality comic panel`;
  }

  async generateImage(prompt, options) {
    throw new Error('Chrome Summarizer does not support image generation. Please use a different provider for images.');
  }

  async validateCredentials() {
    return 'ai' in chrome && chrome.ai !== undefined;
  }
}
