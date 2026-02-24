// OpenAI Provider Implementation
// Handles text generation and image generation via OpenAI API

export class OpenAIProvider {
  constructor() {
    this.baseUrl = 'https://api.openai.com/v1';
    this.capabilities = {
      supportsImages: true,
      maxPromptLength: 128000,
      rateLimitBehavior: 'strict',
      costTag: 'paid'
    };
  }

  get capabilities() {
    return {
      supportsImages: true,
      maxPromptLength: 128000,
      rateLimitBehavior: 'strict',
      costTag: 'paid'
    };
  }

  async initialize(config) {
    this.apiKey = config.apiKey || await this.getApiKey();
    this.textModel = config.textModel || 'gpt-4o-mini';
    this.imageModel = config.imageModel || 'dall-e-3';
  }

  async getApiKey() {
    const { apiKeys } = await chrome.storage.local.get('apiKeys');
    return apiKeys?.openai;
  }

  async generateStoryboard(text, options) {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const model = options.textModel || this.textModel;
    const prompt = this.buildStoryboardPrompt(text, options);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { 
            role: 'system', 
            content: 'You are a comic strip storyboard generator. Respond ONLY with valid JSON, no markdown formatting, no explanations.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 8192,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to generate storyboard');
    }

    const data = await response.json();
    const storyboardText = data.choices?.[0]?.message?.content;

    if (!storyboardText) {
      throw new Error('Invalid response from OpenAI');
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
      medium: '5-10 words',
      long: '10-20 words'
    };

    return `Create a ${panelCount}-panel comic strip storyboard based on the following text content.

Style: ${styleText}${customStyleTheme && styleId === 'custom' ? ' (as specified by user)' : ''}

Generate a JSON object with this exact structure (no other text):
{
  "title": "A brief title for this comic",
  "panels": [
    {
      "beat_summary": "1-2 sentences describing what's happening in this panel",
      "caption": "${captionGuidance[captionLength]} - should fit in a comic caption",
      "image_prompt": "Detailed image generation prompt describing the visual scene, characters, setting, mood",
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
${text.substring(0, 8000)}

Generate the JSON now.`;
  }

  parseStoryboardResponse(responseText, options) {
    let jsonStr = responseText;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    try {
      const parsed = JSON.parse(jsonStr);

      const storyboard = {
        schema_version: '1.0',
        settings: {
          panel_count: options.panelCount || 6,
          detail_level: options.detailLevel || 'medium',
          style_id: options.styleId || 'default',
          caption_len: options.captionLength || 'short',
          provider_text: 'openai',
          provider_image: 'openai'
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
      throw new Error('OpenAI API key not configured');
    }

    const model = options.imageModel || this.imageModel;
    const enhancedPrompt = this.enhancePrompt(prompt, options);

    const response = await fetch(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        prompt: enhancedPrompt,
        n: 1,
        size: '1024x1024',
        quality: model === 'dall-e-3' ? 'standard' : 'standard',
        style: options.style || 'natural'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to generate image');
    }

    const data = await response.json();
    const imageUrl = data.data?.[0]?.url;

    if (!imageUrl) {
      throw new Error('No image in response');
    }

    // Download and convert to base64
    const imageData = await this.urlToBase64(imageUrl);

    return {
      imageData: imageData,
      providerMetadata: {
        model: model,
        timestamp: new Date().toISOString(),
        url: imageUrl
      }
    };
  }

  async urlToBase64(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
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
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
