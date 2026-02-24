// Cloudflare Workers AI Provider Implementation
// Handles text generation via Cloudflare Workers AI

export class CloudflareProvider {
  constructor() {
    this.baseUrl = 'https://workers.ai';
    this.accountId = null;
    this.apiToken = null;
  }

  get capabilities() {
    return {
      supportsImages: false,
      maxPromptLength: 4000,
      rateLimitBehavior: 'graceful',
      costTag: 'free'
    };
  }

  async initialize(config) {
    this.apiToken = config.apiToken || await this.getApiToken();
    const { cloudflareAccountId } = await chrome.storage.local.get('cloudflareAccountId');
    this.accountId = cloudflareAccountId || config.accountId;
  }

  async getApiToken() {
    const { apiKeys } = await chrome.storage.local.get('apiKeys');
    return apiKeys?.cloudflare;
  }

  async generateStoryboard(text, options) {
    const prompt = this.buildStoryboardPrompt(text, options);
    
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a comic strip storyboard generator. Respond ONLY with valid JSON.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 4096
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.errors?.[0]?.message || 'Failed to generate storyboard');
    }

    const data = await response.json();
    const storyboardText = data.result?.response;
    
    if (!storyboardText) {
      throw new Error('Invalid response from Cloudflare');
    }

    return this.parseStoryboardResponse(storyboardText, options);
  }

  buildStoryboardPrompt(text, options) {
    const panelCount = options.panelCount || 6;
    const styleId = options.styleId || 'default';

    const styles = {
      default: 'Classic comic book style',
      noir: 'Film noir style',
      minimalist: 'Minimalist illustration',
      manga: 'Manga anime style',
      superhero: 'Superhero comic style',
      watercolor: 'Watercolor painting style',
      pixel: 'Pixel art style'
    };

    return `Create a ${panelCount}-panel comic strip storyboard in JSON format.

Style: ${styles[styleId]}

Respond ONLY with valid JSON like this:
{
  "title": "Title",
  "panels": [
    {"beat_summary": "...", "caption": "...", "image_prompt": "..."}
  ],
  "style_profile": {"art_style": "${styleId}"}
}

Content: ${text.substring(0, 3000)}`;
  }

  parseStoryboardResponse(responseText, options) {
    let jsonStr = responseText;
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    try {
      const parsed = JSON.parse(jsonStr);
      
      return {
        schema_version: '1.0',
        settings: {
          panel_count: options.panelCount || 6,
          detail_level: options.detailLevel || 'medium',
          style_id: options.styleId || 'default',
          caption_len: options.captionLength || 'short',
          provider_text: 'cloudflare-free',
          provider_image: 'cloudflare-free'
        },
        panels: (parsed.panels || []).map((panel, index) => ({
          panel_id: `panel_${index + 1}`,
          beat_summary: panel.beat_summary || '',
          caption: panel.caption || '',
          image_prompt: panel.image_prompt || ''
        }))
      };
    } catch (error) {
      throw new Error('Failed to parse storyboard');
    }
  }

  async generateImage(prompt, options) {
    // Cloudflare Workers AI doesn't support image generation in v1
    // Return a placeholder or throw
    throw new Error('Cloudflare Workers AI does not support image generation. Please use a different provider.');
  }

  async validateCredentials(apiToken) {
    try {
      const response = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
