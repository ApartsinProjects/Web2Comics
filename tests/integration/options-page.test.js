import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const optionsHtmlPath = path.resolve(__dirname, '../../options/options.html');

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Options Page Navigation', () => {
  beforeEach(() => {
    vi.resetModules();
    const html = fs.readFileSync(optionsHtmlPath, 'utf8');
    document.documentElement.innerHTML = html;

    global.confirm = vi.fn(() => true);
    global.alert = vi.fn();

    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        if (keys.includes('settings') || keys.includes('providers')) {
          return {
            settings: { activeTextProvider: 'openai', activeImageProvider: 'openai' },
            providers: {}
          };
        }
        if (keys.includes('apiKeys')) {
          return { apiKeys: { openai: global.TEST_OPENAI_API_KEY }, settings: {} };
        }
      }
      if (keys === 'history') {
        return { history: [] };
      }
      return {};
    });
    chrome.storage.local.set.mockResolvedValue(undefined);
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, result: { summary: 'OK' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
  });

  it('initializes without import/runtime errors and binds nav buttons', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    const generalBtn = document.querySelector('.nav-btn[data-section="general"]');
    const providersBtn = document.querySelector('.nav-btn[data-section="providers"]');

    expect(generalBtn).toBeTruthy();
    expect(providersBtn).toBeTruthy();
    expect(generalBtn.classList.contains('active')).toBe(true);
    expect(document.getElementById('general-section').classList.contains('active')).toBe(true);
    const helpLink = document.querySelector('.options-header .help-link-icon');
    expect(helpLink).toBeTruthy();
    expect(helpLink.getAttribute('href')).toContain('../docs/user-manual.html#options-overview');
  });

  it('loads local recommended model defaults when present and no saved settings exist', async () => {
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        return { providers: {} };
      }
      if (keys === 'history') return { history: [] };
      if (keys === 'apiKeys') return { apiKeys: { openai: global.TEST_OPENAI_API_KEY } };
      return {};
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        settings: {
          textModel: 'gpt-4.1-mini',
          imageModel: 'dall-e-3',
          geminiTextModel: 'gemini-flash-latest'
        }
      })
    });

    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    expect(global.fetch).toHaveBeenCalled();
    expect(document.getElementById('openai-text-model').value).toBe('gpt-4.1-mini');
    expect(document.getElementById('openai-image-model').value).toBe('dall-e-3');
    expect(document.getElementById('gemini-text-model').value).toBe('gemini-flash-latest');
  });

  it('shows a dedicated User Manual link in About section links list', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="about"]').click();
    await flush();

    const manualLink = document.getElementById('link-user-manual');
    expect(manualLink).toBeTruthy();
    expect(manualLink.getAttribute('href')).toContain('../docs/user-manual.html#options-overview');
    expect(manualLink.getAttribute('target')).toBe('_blank');
  });

  it('switches from General tab to Providers tab on click', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    const providersBtn = document.querySelector('.nav-btn[data-section="providers"]');
    providersBtn.click();
    await flush();

    expect(providersBtn.classList.contains('active')).toBe(true);
    expect(document.querySelector('.nav-btn[data-section="general"]').classList.contains('active')).toBe(false);
    expect(document.getElementById('providers-section').classList.contains('active')).toBe(true);
    expect(document.getElementById('general-section').classList.contains('active')).toBe(false);
  });

  it('switches to Prompts tab on click', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    const promptsBtn = document.querySelector('.nav-btn[data-section="prompts"]');
    promptsBtn.click();
    await flush();

    expect(promptsBtn.classList.contains('active')).toBe(true);
    expect(document.getElementById('prompts-section').classList.contains('active')).toBe(true);
    expect(document.getElementById('general-section').classList.contains('active')).toBe(false);
  });

  it('switches active provider card from Gemini to OpenAI on click', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    const geminiCard = document.querySelector('.provider-card[data-provider="gemini-free"]');
    const openaiCard = document.querySelector('.provider-card[data-provider="openai"]');

    expect(geminiCard.classList.contains('active')).toBe(false);
    expect(openaiCard.classList.contains('active')).toBe(true);

    geminiCard.click();
    await flush();

    expect(geminiCard.classList.contains('active')).toBe(true);
    expect(openaiCard.classList.contains('active')).toBe(false);
  });

  it('saves debug flag and image refusal handling settings in general settings', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    const debugFlag = document.getElementById('debug-flag');
    const rewriteBadge = document.getElementById('show-rewritten-badge');
    const logRewrites = document.getElementById('log-rewritten-prompts');
    const refusalModeSanitize = document.querySelector('input[name="image-refusal-handling"][value="replace_people_and_triggers"]');
    expect(debugFlag).toBeTruthy();
    expect(refusalModeSanitize).toBeTruthy();

    debugFlag.checked = true;
    rewriteBadge.checked = false;
    logRewrites.checked = true;
    refusalModeSanitize.checked = true;
    document.getElementById('save-general-btn').click();
    await flush();

    const setCalls = chrome.storage.local.set.mock.calls;
    const settingsSaveCall = setCalls.find((call) => call[0] && call[0].settings);
    expect(settingsSaveCall).toBeTruthy();
    expect(settingsSaveCall[0].settings.debugFlag).toBe(true);
    expect(settingsSaveCall[0].settings.imageRefusalHandling).toBe('replace_people_and_triggers');
    expect(settingsSaveCall[0].settings.showRewrittenBadge).toBe(false);
    expect(settingsSaveCall[0].settings.logRewrittenPrompts).toBe(true);
  });

  it('saves OpenAI image speed settings with normalized low defaults', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    document.getElementById('openai-image-model').value = 'dall-e-2';
    document.getElementById('openai-image-quality').value = 'hd';
    document.getElementById('openai-image-size').value = '1792x1024';
    document.getElementById('save-providers-btn').click();
    await flush();

    const setCalls = chrome.storage.local.set.mock.calls;
    const settingsSaveCall = setCalls.find((call) => call[0] && call[0].settings && call[0].settings.imageModel);
    expect(settingsSaveCall).toBeTruthy();
    expect(settingsSaveCall[0].settings.imageModel).toBe('dall-e-2');
    expect(settingsSaveCall[0].settings.openaiImageQuality).toBe('standard');
    expect(settingsSaveCall[0].settings.openaiImageSize).toBe('256x256');
  });

  it('renders model option lists for all providers with free/fast/state-of-the-art choices and keeps preferred defaults', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    const selectors = [
      'gemini-text-model',
      'gemini-image-model',
      'cloudflare-text-model',
      'cloudflare-image-model',
      'openrouter-text-model',
      'huggingface-text-model',
      'openai-text-model',
      'openai-image-model'
    ];
    selectors.forEach((id) => expect(document.getElementById(id)).toBeTruthy());

    const openAiTextOptions = Array.from(document.querySelectorAll('#openai-text-model option')).map((o) => o.textContent);
    expect(openAiTextOptions.some((t) => /Fast/i.test(t))).toBe(true);
    expect(openAiTextOptions.some((t) => /State-of-the-art/i.test(t))).toBe(true);
    expect(document.getElementById('openai-text-model').value).toBe('gpt-4o-mini');
    expect(document.getElementById('openai-image-model').value).toBe('dall-e-2');

    const geminiTextOptions = Array.from(document.querySelectorAll('#gemini-text-model option')).map((o) => o.textContent);
    expect(geminiTextOptions.some((t) => /Free/i.test(t))).toBe(true);
    expect(geminiTextOptions.some((t) => /Fast/i.test(t))).toBe(true);
    expect(geminiTextOptions.some((t) => /State-of-the-art/i.test(t))).toBe(true);
    expect(document.getElementById('gemini-text-model').value).toBe('gemini-2.5-flash');
    expect(document.getElementById('gemini-image-model').value).toBe('gemini-2.0-flash-exp-image-generation');

    const cloudflareTextOptions = Array.from(document.querySelectorAll('#cloudflare-text-model option')).map((o) => o.textContent);
    expect(cloudflareTextOptions.some((t) => /Fast/i.test(t))).toBe(true);
    expect(cloudflareTextOptions.some((t) => /State-of-the-art/i.test(t))).toBe(true);
    expect(document.getElementById('cloudflare-text-model').value).toBe('@cf/meta/llama-3.1-8b-instruct');
    expect(document.getElementById('cloudflare-image-model').value).toBe('@cf/black-forest-labs/flux-1-schnell');

    const openrouterTextOptions = Array.from(document.querySelectorAll('#openrouter-text-model option')).map((o) => o.textContent);
    expect(openrouterTextOptions.some((t) => /Free/i.test(t))).toBe(true);
    expect(openrouterTextOptions.some((t) => /Fast/i.test(t))).toBe(true);
    expect(openrouterTextOptions.some((t) => /State-of-the-art/i.test(t))).toBe(true);
    expect(document.getElementById('openrouter-text-model').value).toBe('openai/gpt-oss-20b:free');

    const hfTextOptions = Array.from(document.querySelectorAll('#huggingface-text-model option')).map((o) => o.textContent);
    expect(hfTextOptions.some((t) => /Fast/i.test(t))).toBe(true);
    expect(hfTextOptions.some((t) => /State-of-the-art/i.test(t))).toBe(true);
    expect(document.getElementById('huggingface-text-model').value).toBe('mistralai/Mistral-7B-Instruct-v0.2');
  });

  it('saves provider-specific model selections for all providers', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    document.getElementById('gemini-text-model').value = 'gemini-2.5-flash';
    document.getElementById('gemini-image-model').value = 'gemini-2.5-flash-image';
    document.getElementById('cloudflare-text-model').value = '@cf/meta/llama-3.1-8b-instruct-fast';
    document.getElementById('cloudflare-image-model').value = '@cf/bytedance/stable-diffusion-xl-lightning';
    document.getElementById('openrouter-text-model').value = 'openrouter/auto';
    document.getElementById('huggingface-text-model').value = 'meta-llama/Llama-3.1-8B-Instruct';
    document.getElementById('openai-text-model').value = 'gpt-4o';
    document.getElementById('openai-image-model').value = 'dall-e-3';
    document.getElementById('openai-image-quality').value = 'hd';
    document.getElementById('openai-image-size').value = '1792x1024';

    document.getElementById('save-providers-btn').click();
    await flush();

    const settingsSaveCall = chrome.storage.local.set.mock.calls.find((call) => call[0]?.settings?.openrouterTextModel);
    expect(settingsSaveCall).toBeTruthy();
    expect(settingsSaveCall[0].settings.geminiTextModel).toBe('gemini-2.5-flash');
    expect(settingsSaveCall[0].settings.geminiImageModel).toBe('gemini-2.5-flash-image');
    expect(settingsSaveCall[0].settings.cloudflareTextModel).toBe('@cf/meta/llama-3.1-8b-instruct-fast');
    expect(settingsSaveCall[0].settings.cloudflareImageModel).toBe('@cf/bytedance/stable-diffusion-xl-lightning');
    expect(settingsSaveCall[0].settings.openrouterTextModel).toBe('openrouter/auto');
    expect(settingsSaveCall[0].settings.huggingfaceTextModel).toBe('meta-llama/Llama-3.1-8B-Instruct');
    expect(settingsSaveCall[0].settings.textModel).toBe('gpt-4o');
    expect(settingsSaveCall[0].settings.imageModel).toBe('dall-e-3');
    expect(settingsSaveCall[0].settings.openaiImageQuality).toBe('hd');
    expect(settingsSaveCall[0].settings.openaiImageSize).toBe('1792x1024');
  });

  it('persists provider validation state when validating a provider key', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    const input = document.getElementById('openrouter-api-key');
    input.value = 'sk-or-v1-test';
    document.querySelector('.validate-btn[data-provider="openrouter"]').click();
    await flush();

    const setCalls = chrome.storage.local.set.mock.calls;
    const validationCall = setCalls.find((call) => call[0] && call[0].providerValidation);
    expect(validationCall).toBeTruthy();
    expect(validationCall[0].providerValidation.openrouter.valid).toBe(true);
    expect(typeof validationCall[0].providerValidation.openrouter.validatedAt).toBe('string');
  });

  it('sends fixed model test request and shows popup result for selected provider model', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    document.getElementById('cloudflare-text-model').value = '@cf/meta/llama-3.1-8b-instruct-fast';
    document.querySelector('.test-model-btn[data-provider="cloudflare-free"][data-mode="text"]').click();
    await flush();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'TEST_PROVIDER_MODEL',
      payload: {
        providerId: 'cloudflare-free',
        mode: 'text',
        model: '@cf/meta/llama-3.1-8b-instruct-fast'
      }
    });
    expect(global.alert).toHaveBeenCalled();
    expect(String(global.alert.mock.calls.at(-1)?.[0] || '')).toContain('Provider: cloudflare-free');
    expect(String(global.alert.mock.calls.at(-1)?.[0] || '')).toContain('Mode: text');
  });

  it('saves prompt templates for selected provider scope and blocks invalid templates', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="prompts"]').click();
    await flush();

    const scope = document.getElementById('prompt-provider-scope');
    const storyboard = document.getElementById('storyboard-template');
    const image = document.getElementById('image-template');
    const validation = document.getElementById('prompt-template-validation');

    scope.value = 'gemini';
    scope.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    storyboard.value = 'Bad template without required placeholders';
    image.value = 'Image prompt {{style_prompt}} only';
    document.getElementById('save-prompts-btn').click();
    await flush();

    const failedSave = chrome.storage.local.set.mock.calls.find((call) => call[0] && call[0].promptTemplates);
    expect(failedSave).toBeFalsy();
    expect(validation.textContent).toContain('missing required {{panel_count}}');

    storyboard.value = 'Panels {{panel_count}} content {{content}}';
    image.value = 'Caption {{panel_caption}} style {{style_prompt}}';
    document.getElementById('save-prompts-btn').click();
    await flush();

    const saveCall = chrome.storage.local.set.mock.calls.find((call) => call[0] && call[0].promptTemplates);
    expect(saveCall).toBeTruthy();
    expect(saveCall[0].promptTemplates.gemini.storyboard).toContain('{{panel_count}}');
    expect(saveCall[0].promptTemplates.gemini.image).toContain('{{panel_caption}}');

    storyboard.value = 'modified';
    document.getElementById('reset-storyboard-template-btn').click();
    await flush();
    expect(document.getElementById('storyboard-template').value).toContain('{{panel_count}}');
  });

  it('loads stored prompt templates per provider scope and flags unknown placeholders as warnings', async () => {
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        return {
          settings: { activeTextProvider: 'openai', activeImageProvider: 'openai' },
          providers: {},
          promptTemplates: {
            openai: {
              storyboard: 'OPENAI {{panel_count}} {{content}}',
              image: 'OPENAI_IMG {{panel_caption}} {{style_prompt}}'
            },
            gemini: {
              storyboard: 'GEMINI {{panel_count}} {{content}} {{mystery_token}}',
              image: 'GEMINI_IMG {{panel_caption}} {{style_prompt}}'
            }
          }
        };
      }
      if (keys === 'history') return { history: [] };
      if (keys === 'apiKeys') return { apiKeys: { openai: global.TEST_OPENAI_API_KEY }, settings: {} };
      return {};
    });

    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="prompts"]').click();
    await flush();

    const scope = document.getElementById('prompt-provider-scope');
    const storyboard = document.getElementById('storyboard-template');
    const validation = document.getElementById('prompt-template-validation');

    expect(storyboard.value).toContain('OPENAI');

    scope.value = 'gemini';
    scope.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(storyboard.value).toContain('GEMINI');
    expect(validation.textContent).toContain('unknown placeholders');
    expect(validation.classList.contains('warn')).toBe(true);
  });
});
