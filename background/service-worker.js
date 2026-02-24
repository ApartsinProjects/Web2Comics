// Web to Comic - Service Worker
// Handles background processing, message routing, and job management

// ============ INLINE PROVIDER CLASSES ============

class GeminiProvider {
  constructor() {
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.modelName = 'gemini-1.5-flash';
  }
  get capabilities() {
    return { supportsImages: true, maxPromptLength: 8192, rateLimitBehavior: 'strict', costTag: 'limited' };
  }
  async getApiKey() {
    const { apiKeys } = await chrome.storage.local.get('apiKeys');
    return apiKeys?.gemini;
  }
  async generateStoryboard(text, options) {
    const apiKey = await this.getApiKey();
    if (!apiKey) throw new Error('Gemini API key not configured');
    
    const prompt = this.buildStoryboardPrompt(text, options);
    const response = await fetch(this.baseUrl + '/models/' + this.modelName + ':generateContent?key=' + apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to generate storyboard');
    }
    
    const data = await response.json();
    const storyboardText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!storyboardText) throw new Error('Invalid response from Gemini');
    
    return this.parseStoryboardResponse(storyboardText, options);
  }
  
  buildStoryboardPrompt(text, options) {
    const panelCount = options.panelCount || 6;
    const styleId = options.styleId || 'default';
    const customStyleTheme = options.customStyleTheme || '';
    
    var styles = {
      'default': 'Classic comic book style with bold outlines and vibrant colors',
      'noir': 'Film noir style with high contrast, shadows, and dramatic lighting',
      'minimalist': 'Clean, simple illustration style with minimal details',
      'manga': 'Japanese manga/anime style with expressive characters',
      'superhero': 'American comic book style with muscular heroes and dynamic action',
      'watercolor': 'Soft watercolor painting style with blended colors',
      'pixel': 'Retro pixel art style reminiscent of 8-bit games'
    };
    
    var styleText = (styleId === 'custom' && customStyleTheme) ? customStyleTheme : (styles[styleId] || styles['default']);
    
    return 'Create a ' + panelCount + '-panel comic strip storyboard based on the following text content.\n\nStyle: ' + styleText + '\n\nGenerate JSON with: title, panels (beat_summary, caption, image_prompt).\n\nText: ' + text.substring(0, 4000);
  }
  
  parseStoryboardResponse(responseText, options) {
    var jsonStr = responseText;
    var match = responseText.match(/\{[\s\S]*\}/);
    if (match) jsonStr = match[0];
    
    try {
      var parsed = JSON.parse(jsonStr);
      return {
        schema_version: '1.0',
        settings: { 
          panel_count: options.panelCount || 6, 
          detail_level: options.detailLevel || 'medium', 
          style_id: options.styleId || 'default', 
          caption_len: options.captionLength || 'short', 
          provider_text: 'gemini-free', 
          provider_image: 'gemini-free',
          custom_style_theme: options.customStyleTheme || ''
        },
        panels: (parsed.panels || []).map(function(p, i) { 
          return { 
            panel_id: 'panel_' + (i+1), 
            beat_summary: p.beat_summary || '', 
            caption: p.caption || '', 
            image_prompt: p.image_prompt || '' 
          }; 
        })
      };
    } catch (e) { 
      throw new Error('Failed to parse storyboard'); 
    }
  }
  
  async generateImage(prompt, options) {
    var self = this;
    return new Promise(async function(resolve, reject) {
      var apiKey = await self.getApiKey();
      if (!apiKey) { reject(new Error('Gemini API key not configured')); return; }
      
      var customStyleTheme = options.customStyleTheme || '';
      var styleEnhancements = {
        'default': 'comic book style, bold outlines, vibrant colors',
        'noir': 'film noir style, black and white, high contrast',
        'minimalist': 'minimalist illustration, clean lines',
        'manga': 'manga anime style, Japanese comic',
        'superhero': 'american comic book style, heroic',
        'watercolor': 'watercolor painting style, soft colors',
        'pixel': 'pixel art, 8-bit, retro'
      };
      
      var style = options.style || 'default';
      var enhancedPrompt = customStyleTheme ? prompt + ', ' + customStyleTheme : prompt + ', ' + (styleEnhancements[style] || styleEnhancements['default']);
      
      try {
        var response = await fetch(self.baseUrl + '/models/' + self.modelName + '-001:generateContent?key=' + apiKey, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: enhancedPrompt }] }],
            generationConfig: { temperature: 0.8, maxOutputTokens: 4096, responseModalities: ['image', 'text'] }
          })
        });
        
        if (!response.ok) { reject(new Error('Failed to generate image')); return; }
        
        var data = await response.json();
        var imageData = data.candidates?.[0]?.content?.parts?.find(function(p) { return p.inlineData?.data; });
        if (!imageData) { reject(new Error('No image in response')); return; }
        
        resolve({ 
          imageData: 'data:image/png;base64,' + imageData.inlineData.data, 
          providerMetadata: { model: self.modelName } 
        });
      } catch (e) {
        reject(e);
      }
    });
  }
}

class OpenAIProvider {
  constructor() {
    this.baseUrl = 'https://api.openai.com/v1';
    this.textModel = 'gpt-4o-mini';
    this.imageModel = 'dall-e-3';
  }
  get capabilities() {
    return { supportsImages: true, maxPromptLength: 128000, rateLimitBehavior: 'strict', costTag: 'paid' };
  }
  async getApiKey() {
    var result = await chrome.storage.local.get('apiKeys');
    return result.apiKeys?.openai;
  }
  async generateStoryboard(text, options) {
    var self = this;
    return new Promise(async function(resolve, reject) {
      var apiKey = await self.getApiKey();
      if (!apiKey) { reject(new Error('OpenAI API key not configured')); return; }
      
      var response = await fetch(self.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: self.textModel,
          messages: [
            { role: 'system', content: 'You are a comic strip storyboard generator. Respond ONLY with JSON.' },
            { role: 'user', content: 'Create ' + (options.panelCount || 6) + '-panel comic in JSON. Content: ' + text.substring(0, 8000) }
          ],
          response_format: { type: 'json_object' }
        })
      });
      
      if (!response.ok) {
        var err = await response.json();
        reject(new Error(err.error?.message || 'Failed to generate storyboard'));
        return;
      }
      
      var data = await response.json();
      var storyboardText = data.choices?.[0]?.message?.content;
      if (!storyboardText) { reject(new Error('Invalid response from OpenAI')); return; }
      
      resolve(self.parseStoryboardResponse(storyboardText, options));
    });
  }
  
  parseStoryboardResponse(responseText, options) {
    var jsonStr = responseText;
    var match = responseText.match(/\{[\s\S]*\}/);
    if (match) jsonStr = match[0];
    
    try {
      var parsed = JSON.parse(jsonStr);
      return {
        schema_version: '1.0',
        settings: { 
          panel_count: options.panelCount || 6, 
          provider_text: 'openai', 
          provider_image: 'openai' 
        },
        panels: (parsed.panels || []).map(function(p, i) { 
          return { 
            panel_id: 'panel_' + (i+1), 
            caption: p.caption || '', 
            image_prompt: p.image_prompt || '' 
          }; 
        })
      };
    } catch (e) { 
      throw new Error('Failed to parse storyboard'); 
    }
  }
  
  async generateImage(prompt, options) {
    var self = this;
    return new Promise(async function(resolve, reject) {
      var apiKey = await self.getApiKey();
      if (!apiKey) { reject(new Error('OpenAI API key not configured')); return; }
      
      try {
        var response = await fetch(self.baseUrl + '/images/generations', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: self.imageModel,
            prompt: prompt,
            n: 1,
            size: '1024x1024'
          })
        });
        
        if (!response.ok) {
          var err = await response.json();
          reject(new Error(err.error?.message || 'Failed to generate image'));
          return;
        }
        
        var data = await response.json();
        var imageUrl = data.data?.[0]?.url;
        if (!imageUrl) { reject(new Error('No image in response')); return; }
        
        var imgResponse = await fetch(imageUrl);
        var blob = await imgResponse.blob();
        var reader = new FileReader();
        
        reader.onload = function() {
          resolve({ imageData: reader.result, providerMetadata: { model: self.imageModel } });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      } catch (e) {
        reject(e);
      }
    });
  }
}

class CloudflareProvider {
  constructor() { 
    this.capabilities = { supportsImages: false, maxPromptLength: 4000, rateLimitBehavior: 'graceful', costTag: 'free' }; 
  }
  async generateStoryboard(text, options) {
    var panels = [];
    for (var i = 0; i < (options.panelCount || 6); i++) {
      panels.push({
        panel_id: 'panel_' + (i+1),
        beat_summary: 'Content panel ' + (i+1),
        caption: 'Scene ' + (i+1),
        image_prompt: 'Comic panel'
      });
    }
    return { schema_version: '1.0', settings: { panel_count: options.panelCount || 6 }, panels: panels };
  }
  async generateImage() { throw new Error('Cloudflare does not support image generation'); }
}

class ChromeSummarizerProvider {
  constructor() { 
    this.capabilities = { supportsImages: false, maxPromptLength: 10000, rateLimitBehavior: 'none', costTag: 'free' }; 
  }
  async generateStoryboard(text, options) {
    var panelCount = options.panelCount || 6;
    var panels = [];
    for (var i = 0; i < panelCount; i++) {
      panels.push({
        panel_id: 'panel_' + (i+1),
        beat_summary: 'Panel ' + (i+1) + ' summary',
        caption: 'Scene ' + (i+1),
        image_prompt: 'Comic panel showing key content'
      });
    }
    return { schema_version: '1.0', settings: { panel_count: panelCount, provider_text: 'chrome-summarizer' }, panels: panels };
  }
  async generateImage() { throw new Error('Chrome Summarizer does not support images'); }
}

// ============ PROVIDER REGISTRY ============

var TEXT_PROVIDERS = {
  'gemini-free': GeminiProvider,
  'cloudflare-free': CloudflareProvider,
  'chrome-summarizer': ChromeSummarizerProvider,
  'openai': OpenAIProvider
};

var IMAGE_PROVIDERS = {
  'gemini-free': GeminiProvider,
  'openai': OpenAIProvider
};

// ============ SERVICE WORKER ============

var ServiceWorker = function() {
  var self = this;
  
  this.currentJob = null;
  this.isProcessing = false;
  this.messageHandlers = {};
  
  this.init = function() {
    self.setupMessageHandlers();
    self.setupLifecycleHandlers();
  };
  
  this.setupMessageHandlers = function() {
    self.messageHandlers['START_GENERATION'] = function(msg) { return self.handleStartGeneration(msg); };
    self.messageHandlers['CANCEL_GENERATION'] = function(msg) { return self.handleCancelGeneration(msg); };
    self.messageHandlers['GET_STATUS'] = function(msg) { return self.handleGetStatus(msg); };
  };
  
  this.setupLifecycleHandlers = function() {
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
      var handler = self.messageHandlers[message.type];
      if (handler) {
        Promise.resolve(handler(message))
          .then(function(result) { sendResponse({ success: true, ...result }); })
          .catch(function(error) { sendResponse({ success: false, error: error.message }); });
      }
      return true;
    });

    chrome.alarms.create('cleanup', { periodInMinutes: 5 });
    chrome.alarms.onAlarm.addListener(function(alarm) {
      if (alarm.name === 'cleanup') self.cleanupOldJobs();
    });
  };
  
  this.getTextProvider = function(providerId) {
    var ProviderClass = TEXT_PROVIDERS[providerId];
    if (!ProviderClass) throw new Error('Unknown text provider: ' + providerId);
    return new ProviderClass();
  };
  
  this.getImageProvider = function(providerId) {
    var ProviderClass = IMAGE_PROVIDERS[providerId];
    if (!ProviderClass) throw new Error('Unknown image provider: ' + providerId + '. Image generation not supported.');
    return new ProviderClass();
  };
  
  this.handleStartGeneration = function(message) {
    var payload = message.payload;
    var text = payload.text;
    var url = payload.url;
    var title = payload.title;
    var settings = payload.settings;
    
    if (self.isProcessing) {
      return { success: false, error: 'Generation already in progress' };
    }

    var jobId = 'job_' + Date.now();
    self.currentJob = {
      id: jobId,
      status: 'pending',
      sourceUrl: url,
      sourceTitle: title,
      extractedText: text,
      settings: settings,
      storyboard: null,
      currentPanelIndex: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    self.isProcessing = true;
    self.saveJob();

    return self.executeGeneration()
      .then(function() { return { success: true, jobId: jobId }; })
      .catch(function(error) {
        self.currentJob.status = 'failed';
        self.currentJob.error = error.message;
        self.saveJob();
        return { success: false, error: error.message };
      })
      .finally(function() { self.isProcessing = false; });
  };
  
  this.executeGeneration = function() {
    var job = self.currentJob;
    var settings = job.settings;

    job.status = 'generating_text';
    job.updatedAt = new Date().toISOString();
    self.saveJob();
    self.notifyProgress();

    var textProvider = self.getTextProvider(settings.provider_text);
    var imageProvider = self.getImageProvider(settings.provider_image);

    return textProvider.generateStoryboard(job.extractedText, {
      panelCount: settings.panel_count,
      detailLevel: settings.detail_level,
      styleId: settings.style_id,
      captionLength: settings.caption_len,
      characterConsistency: settings.character_consistency,
      customStyleTheme: settings.custom_style_theme
    })
    .then(function(storyboard) {
      storyboard.source = { url: job.sourceUrl, title: job.sourceTitle, extracted_at: new Date().toISOString() };
      job.storyboard = storyboard;
      job.status = 'generating_images';
      job.updatedAt = new Date().toISOString();
      self.saveJob();
      self.notifyProgress();

      // Generate images sequentially
      var promises = [];
      for (var i = 0; i < storyboard.panels.length; i++) {
        if (job.status === 'canceled') break;
        
        var panelIndex = i;
        job.currentPanelIndex = panelIndex;
        job.updatedAt = new Date().toISOString();
        self.saveJob();
        self.notifyProgress();

        var panel = storyboard.panels[panelIndex];
        
        (function(p) {
          promises.push(
            imageProvider.generateImage(p.image_prompt, {
              negativePrompt: p.negative_prompt,
              style: settings.style_id,
              customStyleTheme: settings.custom_style_theme
            })
            .then(function(imageResult) {
              p.artifacts = { image_blob_ref: imageResult.imageData, provider_metadata: imageResult.providerMetadata };
              self.saveJob();
              self.notifyProgress();
            })
            .catch(function(error) {
              console.error('Failed panel ' + (p.panel_id || panelIndex + 1) + ':', error);
              p.artifacts = { error: error.message };
            })
          );
        })(panel);
      }

      return Promise.all(promises);
    })
    .then(function() {
      if (job.status !== 'canceled') {
        job.status = 'completed';
        job.updatedAt = new Date().toISOString();
        self.saveJob();
        self.notifyProgress();
      }
    });
  };
  
  this.handleCancelGeneration = function() {
    if (self.currentJob && self.isProcessing) {
      self.currentJob.status = 'canceled';
      self.currentJob.updatedAt = new Date().toISOString();
      self.saveJob();
      self.isProcessing = false;
      return { success: true };
    }
    return { success: false, error: 'No job to cancel' };
  };
  
  this.handleGetStatus = function() {
    return { job: self.currentJob, isProcessing: self.isProcessing };
  };
  
  this.saveJob = function() {
    chrome.storage.local.set({ currentJob: self.currentJob });
  };
  
  this.notifyProgress = function() {
    try {
      var views = chrome.extension.getViews({ type: 'popup' });
      views.forEach(function(view) {
        view.postMessage && view.postMessage({ type: 'JOB_PROGRESS', job: self.currentJob });
      });
    } catch (e) {}
  };
  
  this.cleanupOldJobs = function() {
    chrome.storage.local.get('history', function(result) {
      var history = result.history;
      if (!history || history.length === 0) return;

      var thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      var filtered = history.filter(function(item) {
        return new Date(item.generated_at).getTime() > thirtyDaysAgo;
      });

      if (filtered.length !== history.length) {
        chrome.storage.local.set({ history: filtered });
      }
    });
  };
  
  this.init();
};

// Initialize service worker
new ServiceWorker();
