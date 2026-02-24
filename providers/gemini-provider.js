// Gemini Provider Implementation
// Handles text summarization and image generation via Google Gemini API

export class GeminiProvider {
  constructor() {
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.capabilities = {
      supportsImages: true,
      maxPromptLength: 8192,
      rateLimitBehavior: 'strict',
      costTag: 'limited'
    };
  }

  async initialize(config) {
    this.apiKey = config.apiKey || await this.getApiKey();
    this.modelName = config.modelName || 'gemini-1.5-flash';
  }

  async getApiKey() {
    const { apiKeys } = await chrome.storage.local.get('apiKeys');
    return apiKeys?.gemini;
  }

  get capabilities() {
    return {
      supportsImages: true,
      maxPromptLength: 8192,
      rateLimitBehavior: 'strict',
      costTag: 'limited'
    };
  }

  async generateStoryboard(text, options) {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const prompt = this.buildStoryboardPrompt(text, options);
    
    const response = await fetch(`${this.baseUrl}/models/${this.modelName}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
          topP: 0.95,
          topK: 40
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to generate storyboard');
    }

    const data = await response.json();
    const storyboardText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!storyboardText) {
      throw new Error('Invalid response from Gemini');
    }

    return this.parseStoryboardResponse(storyboardText, options);
  }

  buildStoryboardPrompt(text, options) {
    const panelCount = options.panelCount || 6;
    const detailLevel = options.detailLevel || 'medium';
    const styleId = options.styleId || 'default';
    const captionLength = options.captionLength || 'short';
    const customStyleTheme = options.customStyleTheme || '';

    const styleGuidance = {
      default: 'Classic comic book style with bold outlines and vibrant colors',
      noir: 'Film noir style with high contrast, shadows, and dramatic lighting',
      minimalist: 'Clean, simple illustration style with minimal details',
      manga: 'Japanese manga/anime style with expressive characters',
      superhero: 'American comic book style with muscular heroes and dynamic action',
      watercolor: 'Soft watercolor painting style with blended colors',
      pixel: 'Retro pixel art style reminiscent of 8-bit games'
    };

    let styleText = styleGuidance[styleId] || styleGuidance.default;
    if (styleId === 'custom' && customStyleTheme) {
      styleText = customStyleTheme;
    }

    const captionGuidance = {
      short: '1-5 words',
      short: '5-10 words',
      long: '10-20 words'
    };

    return `You are a comic strip storyboard generator. Create a ${panelCount}-panel comic strip storyboard based on the following text content.

IMPORTANT: Respond ONLY with valid JSON, no other text or explanation.

Style: ${styleText}${customStyleTheme && styleId === 'custom' ? ' (as specified by user)' : ''}

Generate a JSON object with this exact structure:
{
  "title": "A brief title for this comic",
  "panels": [
    {
      "beat_summary": "1-2 sentences describing what's happening in this panel",
      "caption": "${captionGuidance[captionLength]} - should fit in a comic caption",
      "image_prompt": "Detailed image generation prompt for this panel, describing the visual scene, characters, setting, mood",
      "negative_prompt": "Optional - what to avoid in the image",
      "composition": {"shot_type": "close-up/medium/wide", "angle": "eye-level/low-angle/high-angle"}
    }
  ],
  "style_profile": {
    "art_style": "${styleId}",
    "mood": "appropriate mood for the content"
  }
}

Text content to summarize:
${text.substring(0, 4000)}

Generate the storyboard now.`;
  }

  parseStoryboardResponse(responseText, options) {
    let jsonStr = responseText;
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    try {
      const parsed = JSON.parse(jsonStr);
      
      // Validate and normalize
      const storyboard = {
        schema_version: '1.0',
        settings: {
          panel_count: options.panelCount || 6,
          detail_level: options.detailLevel || 'medium',
          style_id: options.styleId || 'default',
          caption_len: options.captionLength || 'short',
          provider_text: 'gemini-free',
          provider_image: 'gemini-free'
        },
        panels: (parsed.panels || []).map((panel, index) => ({
          panel_id: `panel_${index + 1}`,
          beat_summary: panel.beat_summary || '',
          caption: panel.caption || '',
          image_prompt: panel.image_prompt || '',
          negative_prompt: panel.negative_prompt || '',
          composition: panel.composition || {}
        })),
        style_profile: parsed.style_profile || {}
      };

      // Ensure we have the right number of panels
      while (storyboard.panels.length < options.panelCount) {
        storyboard.panels.push({
          panel_id: `panel_${storyboard.panels.length + 1}`,
          beat_summary: 'Additional panel',
          caption: '...',
          image_prompt: 'Comic panel'
        });
      }

      return storyboard;
    } catch (error) {
      console.error('Parse error:', error, responseText);
      throw new Error('Failed to parse storyboard response');
    }
  }

  async generateImage(prompt, options) {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const enhancedPrompt = this.enhancePrompt(prompt, options);

    const response = await fetch(`${this.baseUrl}/models/${this.modelName}-001:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: enhancedPrompt }] }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 4096,
          responseModalities: ['image', 'text']
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to generate image');
    }

    const data = await response.json();
    
    // Extract image data from response
    const imageData = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data);
    
    if (!imageData) {
      throw new Error('No image in response');
    }

    return {
      imageData: `data:image/png;base64,${imageData.inlineData.data}`,
      providerMetadata: {
        model: this.modelName,
        timestamp: new Date().toISOString()
      }
    };
  }

  enhancePrompt(prompt, options) {
    const styleEnhancements = {
      default: 'comic book style, bold outlines, vibrant colors, panel composition',
      noir: 'film noir style, black and white, high contrast, dramatic shadows, moody',
      minimalist: 'minimalist illustration, clean lines, simple shapes, modern',
      manga: 'manga anime style, Japanese comic, expressive, detailed linework',
      superhero: 'american comic book style, heroic, dynamic pose, powerful',
      watercolor: 'watercolor painting style, soft colors, artistic, painted',
      pixel: 'pixel art, 8-bit, retro game graphics, low resolution aesthetic'
    };

    const style = options.style || 'default';
    const customStyleTheme = options.customStyleTheme || '';
    
    let styleText;
    if (style === 'custom' && customStyleTheme) {
      styleText = customStyleTheme;
    } else {
      styleText = styleEnhancements[style] || styleEnhancements.default;
    }

    let enhanced = `${prompt}, ${styleText}, high quality, detailed illustration`;
    
    if (options.negativePrompt) {
      enhanced += `. Avoid: ${options.negativePrompt}`;
    }

    return enhanced;
  }

  async validateCredentials(apiKey) {
    try {
      const response = await fetch(`${this.baseUrl}/models?key=${apiKey}`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
