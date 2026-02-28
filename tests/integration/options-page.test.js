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

  it('logs error toasts to debugLogs in options UI', async () => {
    let debugLogsStore = [];
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
      if (keys === 'history') return { history: [] };
      if (keys === 'debugLogs') return { debugLogs: debugLogsStore };
      return {};
    });
    chrome.storage.local.set.mockImplementation(async (payload) => {
      if (Array.isArray(payload.debugLogs)) debugLogsStore = payload.debugLogs;
    });

    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    const controller = window.__optionsController;
    expect(controller).toBeTruthy();
    controller.showToast('Something failed', 'error');
    await flush();

    expect(debugLogsStore.length).toBeGreaterThan(0);
    expect(debugLogsStore.at(-1).event).toBe('ui.toast.error');
    expect(debugLogsStore.at(-1).data.message).toContain('Something failed');
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

  it('selecting image-capable provider cards updates active image provider too (OpenRouter/Hugging Face)', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    const controller = window.__optionsController;
    expect(controller).toBeTruthy();

    const openrouterCard = document.querySelector('.provider-card[data-provider="openrouter"]');
    const hfCard = document.querySelector('.provider-card[data-provider="huggingface"]');

    openrouterCard.click();
    await flush();
    expect(controller.settings.activeTextProvider).toBe('openrouter');
    expect(controller.settings.activeImageProvider).toBe('openrouter');

    hfCard.click();
    await flush();
    expect(controller.settings.activeTextProvider).toBe('huggingface');
    expect(controller.settings.activeImageProvider).toBe('huggingface');
  });

  it('saves debug flag and image refusal handling settings in general settings', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    const debugFlag = document.getElementById('debug-flag');
    const rewriteBadge = document.getElementById('show-rewritten-badge');
    const logRewrites = document.getElementById('log-rewritten-prompts');
    const defaultLanguage = document.getElementById('default-language');
    const refusalModeSelect = document.getElementById('image-refusal-handling-select');
    expect(debugFlag).toBeTruthy();
    expect(defaultLanguage).toBeTruthy();
    expect(refusalModeSelect).toBeTruthy();

    debugFlag.checked = true;
    rewriteBadge.checked = false;
    logRewrites.checked = true;
    defaultLanguage.value = 'es';
    refusalModeSelect.value = 'replace_people_and_triggers';
    document.getElementById('save-general-btn').click();
    await flush();

    const setCalls = chrome.storage.local.set.mock.calls;
    const settingsSaveCall = setCalls.find((call) => call[0] && call[0].settings);
    expect(settingsSaveCall).toBeTruthy();
    expect(settingsSaveCall[0].settings.debugFlag).toBe(true);
    expect(settingsSaveCall[0].settings.outputLanguage).toBe('es');
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

  it('normalizes unsupported dall-e-3 image quality and size to safe defaults', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    const quality = document.getElementById('openai-image-quality');
    const size = document.getElementById('openai-image-size');

    document.getElementById('openai-image-model').value = 'dall-e-3';
    quality.value = 'standard';
    quality.value = 'ultra';
    size.value = '1024x1024';
    size.value = '256x256';
    document.getElementById('save-providers-btn').click();
    await flush();

    const settingsSaveCall = chrome.storage.local.set.mock.calls.find((call) => call[0] && call[0].settings && call[0].settings.imageModel);
    expect(settingsSaveCall).toBeTruthy();
    expect(settingsSaveCall[0].settings.imageModel).toBe('dall-e-3');
    expect(settingsSaveCall[0].settings.openaiImageQuality).toBe('standard');
    expect(settingsSaveCall[0].settings.openaiImageSize).toBe('1024x1024');
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
      'openrouter-image-model',
      'openrouter-image-size',
      'huggingface-text-model',
      'huggingface-image-model',
      'huggingface-image-quality',
      'huggingface-image-size',
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
    expect(document.getElementById('openrouter-image-size').value).toBe('1K');

    const hfTextOptions = Array.from(document.querySelectorAll('#huggingface-text-model option')).map((o) => o.textContent);
    expect(hfTextOptions.some((t) => /Fast/i.test(t))).toBe(true);
    expect(hfTextOptions.some((t) => /State-of-the-art/i.test(t))).toBe(true);
    expect(document.getElementById('huggingface-text-model').value).toBe('mistralai/Mistral-7B-Instruct-v0.2');
    expect(document.getElementById('huggingface-image-quality').value).toBe('fastest');
    expect(document.getElementById('huggingface-image-size').value).toBe('512x512');
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
    document.getElementById('openrouter-image-size').value = '2K';
    document.getElementById('huggingface-text-model').value = 'meta-llama/Llama-3.1-8B-Instruct';
    document.getElementById('huggingface-image-quality').value = 'balanced';
    document.getElementById('huggingface-image-size').value = '768x768';
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
    expect(settingsSaveCall[0].settings.openrouterImageSize).toBe('2K');
    expect(settingsSaveCall[0].settings.huggingfaceTextModel).toBe('meta-llama/Llama-3.1-8B-Instruct');
    expect(settingsSaveCall[0].settings.huggingfaceImageQuality).toBe('balanced');
    expect(settingsSaveCall[0].settings.huggingfaceImageSize).toBe('768x768');
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

  it('performs remote OpenAI validation before saving API key', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    chrome.runtime.sendMessage.mockReset();
    chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      result: { summary: 'OpenAI key can make model requests' }
    });

    const input = document.getElementById('openai-api-key');
    input.value = 'sk-test-openai-new';
    document.querySelector('.validate-btn[data-provider="openai"]').click();
    await flush();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'VALIDATE_PROVIDER_REMOTE',
      payload: {
        providerId: 'openai',
        apiKey: 'sk-test-openai-new',
        textModel: document.getElementById('openai-text-model').value
      }
    });

    const validationCall = chrome.storage.local.set.mock.calls.find((call) => call[0]?.providerValidation?.openai);
    expect(validationCall).toBeTruthy();
    expect(validationCall[0].providerValidation.openai.valid).toBe(true);
  });

  it('does not save OpenAI key when remote validation fails', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    chrome.runtime.sendMessage.mockReset();
    chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: false,
      error: 'Incorrect API key provided'
    });

    const input = document.getElementById('openai-api-key');
    input.value = 'sk-bad-key';
    document.querySelector('.validate-btn[data-provider="openai"]').click();
    await flush();

    const savedOpenAiValidation = chrome.storage.local.set.mock.calls.find((call) => call[0]?.providerValidation?.openai);
    expect(savedOpenAiValidation).toBeFalsy();
  });

  it('tests selected provider model with inline loading + success message', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    chrome.runtime.sendMessage.mockReset();
    let resolveSend;
    chrome.runtime.sendMessage.mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));

    document.getElementById('cloudflare-text-model').value = '@cf/meta/llama-3.1-8b-instruct-fast';
    const testBtn = document.querySelector('.test-model-btn[data-provider="cloudflare-free"][data-mode="text"]');
    testBtn.click();
    await flush();

    expect(testBtn.classList.contains('is-loading')).toBe(true);
    const statusEl = testBtn.closest('.model-item').querySelector('.model-test-status');
    expect(statusEl).toBeTruthy();
    expect(statusEl.textContent).toContain('Testing model');

    resolveSend({ success: true, result: { summary: 'OK' } });
    await flush();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'TEST_PROVIDER_MODEL',
      payload: {
        providerId: 'cloudflare-free',
        mode: 'text',
        model: '@cf/meta/llama-3.1-8b-instruct-fast'
      }
    });
    expect(testBtn.classList.contains('is-loading')).toBe(false);
    expect(statusEl.textContent).toContain("It's working!");
    expect(global.alert).not.toHaveBeenCalled();
  });

  it('shows clearer OpenAI model-test error classification for model access issues', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    chrome.runtime.sendMessage.mockReset();
    chrome.runtime.sendMessage.mockRejectedValueOnce(
      new Error('Project does not have access to model dall-e-2')
    );

    const testBtn = document.querySelector('.test-model-btn[data-provider="openai"][data-mode="image"]');
    testBtn.click();
    await flush();

    const statusEl = testBtn.closest('.model-item').querySelector('.model-test-status');
    expect(statusEl.textContent).toContain('selected model');
    expect(statusEl.textContent).toContain('dall-e-3');
  });

  it('shows actual routed model when provider falls back during OpenAI model test', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    chrome.runtime.sendMessage.mockReset();
    chrome.runtime.sendMessage.mockResolvedValueOnce({
      success: true,
      result: {
        summary: 'Image model returned image data',
        providerMetadata: { model: 'dall-e-3' }
      }
    });

    document.getElementById('openai-image-model').value = 'dall-e-2';
    const testBtn = document.querySelector('.test-model-btn[data-provider="openai"][data-mode="image"]');
    testBtn.click();
    await flush();

    const statusEl = testBtn.closest('.model-item').querySelector('.model-test-status');
    expect(statusEl.textContent).toContain("It's working!");
    expect(statusEl.textContent).toContain('Actual model used: dall-e-3');
  });

  it('restores Cloudflare credential fields and validates/saves cloudflareConfig', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    const cloudflareCard = document.querySelector('.provider-card[data-provider="cloudflare-free"]');
    const config = cloudflareCard.querySelector('.provider-config');
    expect(config).toBeTruthy();
    expect(config.querySelector('#cloudflare-account-id')).toBeTruthy();
    expect(config.querySelector('#cloudflare-api-token')).toBeTruthy();
    expect(config.querySelector('.validate-btn[data-provider="cloudflare"]')).toBeTruthy();

    const tokenLink = config.querySelector('.manual-inline-link');
    expect(tokenLink).toBeTruthy();
    expect(tokenLink.getAttribute('href')).toContain('#appendix-cloudflare');

    document.getElementById('cloudflare-account-id').value = 'cf-account-123';
    document.getElementById('cloudflare-api-token').value = 'cf-token-abc';
    config.querySelector('.validate-btn[data-provider="cloudflare"]').click();
    await flush();

    const setCalls = chrome.storage.local.set.mock.calls;
    const cfSaveCall = setCalls.find((call) => call[0] && call[0].cloudflareConfig);
    expect(cfSaveCall).toBeTruthy();
    expect(cfSaveCall[0].cloudflareConfig.accountId).toBe('cf-account-123');
    expect(cfSaveCall[0].cloudflareConfig.apiToken).toBe('cf-token-abc');
    expect(cfSaveCall[0].providerValidation.cloudflare.valid).toBe(true);
    expect(cfSaveCall[0].apiKeys.cloudflare).toBe('cf-token-abc');
  });

  it('shows and saves custom style name + description in General settings when Custom style is selected', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    const styleSelect = document.getElementById('default-style');
    const customContainer = document.getElementById('default-custom-style-container');
    const customName = document.getElementById('default-custom-style-name');
    const customDesc = document.getElementById('default-custom-style');

    expect(customContainer).toBeTruthy();
    expect(customName).toBeTruthy();
    expect(customDesc).toBeTruthy();
    expect(customContainer.style.display).toBe('none');

    styleSelect.value = 'custom';
    styleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(customContainer.style.display).toBe('block');
    customName.value = 'Retro Pulp Adventure';
    customDesc.value = 'Vintage halftone print, warm paper texture';

    document.getElementById('save-general-btn').click();
    await flush();

    const settingsSaveCall = chrome.storage.local.set.mock.calls.find((call) => call[0] && call[0].settings);
    expect(settingsSaveCall).toBeTruthy();
    expect(settingsSaveCall[0].settings.styleId).toBe('custom');
    expect(settingsSaveCall[0].settings.customStyleName).toBe('Retro Pulp Adventure');
    expect(settingsSaveCall[0].settings.customStyleTheme).toContain('Vintage halftone');
  });

  it('creates a reusable custom style from General settings and hides inline custom editors after creation', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    const styleSelect = document.getElementById('default-style');
    const customContainer = document.getElementById('default-custom-style-container');
    const customName = document.getElementById('default-custom-style-name');
    const customDesc = document.getElementById('default-custom-style');
    const createBtn = document.getElementById('create-default-style-btn');

    styleSelect.value = 'custom';
    styleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(customContainer.style.display).toBe('block');
    customName.value = 'Neon Detective';
    customDesc.value = 'Neo-noir city lights, teal and orange, moody shadows';
    createBtn.click();
    await flush();

    const customStylesSaveCall = chrome.storage.local.set.mock.calls.find((call) => call[0] && Array.isArray(call[0].customStyles));
    expect(customStylesSaveCall).toBeTruthy();
    expect(customStylesSaveCall[0].customStyles.some((s) => s.name === 'Neon Detective')).toBe(true);

    expect(Array.from(styleSelect.options).some((opt) => opt.textContent === 'Neon Detective')).toBe(true);
    expect(styleSelect.value.startsWith('user:')).toBe(true);
    expect(customContainer.style.display).toBe('none');
  });

  it('shows inline error message when provider model test fails', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="providers"]').click();
    await flush();

    chrome.runtime.sendMessage.mockReset();
    chrome.runtime.sendMessage.mockRejectedValue(new Error('Quota exceeded'));

    const testBtn = document.querySelector('.test-model-btn[data-provider="openrouter"][data-mode="image"]');
    testBtn.click();
    await flush();

    const statusEl = testBtn.closest('.model-item').querySelector('.model-test-status');
    expect(statusEl.textContent).toContain('Error: Quota exceeded');
    expect(global.alert).not.toHaveBeenCalled();
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

  it('accepts objective placeholders in storyboard templates without warning', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="prompts"]').click();
    await flush();

    const storyboard = document.getElementById('storyboard-template');
    const image = document.getElementById('image-template');
    const validation = document.getElementById('prompt-template-validation');

    storyboard.value = 'Panels {{panel_count}} {{content}} Objective {{objective_label}} Guidance {{objective_guidance}}';
    image.value = 'Caption {{panel_caption}} style {{style_prompt}}';
    storyboard.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();

    expect(String(validation.textContent || '').toLowerCase()).not.toContain('unknown placeholders');
    expect(validation.classList.contains('error')).toBe(false);
  });

  it('shows prompt template scopes for all providers and supports editing a non-OpenAI/Gemini scope', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="prompts"]').click();
    await flush();

    const scope = document.getElementById('prompt-provider-scope');
    const optionValues = Array.from(scope.querySelectorAll('option')).map((o) => o.value);
    expect(optionValues).toEqual(expect.arrayContaining([
      'openai',
      'gemini',
      'cloudflare',
      'openrouter',
      'huggingface'
    ]));

    scope.value = 'openrouter';
    scope.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    const storyboard = document.getElementById('storyboard-template');
    const image = document.getElementById('image-template');
    expect(storyboard.value).toContain('{{panel_count}}');
    expect(image.value).toContain('{{panel_caption}}');

    storyboard.value = 'OR {{panel_count}} {{content}}';
    image.value = 'OR-IMG {{panel_caption}} {{style_prompt}}';
    document.getElementById('save-prompts-btn').click();
    await flush();

    const saveCall = chrome.storage.local.set.mock.calls.find((call) => call[0]?.promptTemplates?.openrouter);
    expect(saveCall).toBeTruthy();
    expect(saveCall[0].promptTemplates.openrouter.storyboard).toContain('OR {{panel_count}}');
    expect(saveCall[0].promptTemplates.openrouter.image).toContain('OR-IMG {{panel_caption}}');
  });

  it('previews selected prompt library preset in editors and requires approval before save', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="prompts"]').click();
    await flush();

    const group = document.getElementById('prompt-library-group');
    const preset = document.getElementById('prompt-library-preset');
    const applyCurrentBtn = document.getElementById('apply-prompt-preset-current-btn');
    const previewStatus = document.getElementById('prompt-library-preview-status');
    const savePromptsBtn = document.getElementById('save-prompts-btn');
    const storyboard = document.getElementById('storyboard-template');
    const image = document.getElementById('image-template');
    const description = document.getElementById('prompt-library-description');

    expect(group).toBeTruthy();
    expect(preset).toBeTruthy();
    expect(applyCurrentBtn).toBeTruthy();
    expect(preset.options.length).toBeGreaterThan(0);

    group.value = 'work';
    group.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    preset.value = 'work_meeting_notes';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(storyboard.value).toContain('{{panel_count}}');
    expect(storyboard.value).toContain('{{content}}');
    expect(storyboard.value).toContain('{{objective_label}}');
    expect(image.value).toContain('{{panel_caption}}');
    expect(image.value).toContain('{{style_prompt}}');
    expect(String(description.textContent || '')).toContain('Objective: Meeting Recap');
    expect(String(previewStatus.textContent || '')).toContain('Preview only');

    savePromptsBtn.click();
    await flush();
    expect(global.alert).not.toHaveBeenCalled();
    expect(chrome.storage.local.set.mock.calls.some((call) => call[0]?.promptTemplates)).toBe(false);

    applyCurrentBtn.click();
    await flush();
    expect(String(previewStatus.textContent || '')).toContain('approved');
  });

  it('applies selected prompt library preset to all provider scopes and persists templates', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="prompts"]').click();
    await flush();

    const group = document.getElementById('prompt-library-group');
    const preset = document.getElementById('prompt-library-preset');
    const applyAllBtn = document.getElementById('apply-prompt-preset-all-btn');

    group.value = 'social';
    group.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    preset.value = 'social_quick_summary';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    applyAllBtn.click();
    await flush();

    const saveCall = chrome.storage.local.set.mock.calls.find((call) => call[0]?.promptTemplates?.openai);
    expect(saveCall).toBeTruthy();
    expect(saveCall[0].promptTemplates.openai.storyboard).toContain('Panel 1 hook/context');
    expect(saveCall[0].promptTemplates.gemini.storyboard).toContain('Panel 1 hook/context');
    expect(saveCall[0].promptTemplates.cloudflare.storyboard).toContain('Panel 1 hook/context');
    expect(saveCall[0].promptTemplates.openrouter.storyboard).toContain('Panel 1 hook/context');
    expect(saveCall[0].promptTemplates.huggingface.storyboard).toContain('Panel 1 hook/context');
  });

  it('imports prompt library presets from JSON and persists for next sessions', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="prompts"]').click();
    await flush();

    const group = document.getElementById('prompt-library-group');
    const preset = document.getElementById('prompt-library-preset');

    const importedPreset = {
      group: 'custom',
      id: 'custom_case_1',
      name: 'Custom Case 1',
      objective: 'Quick Summary',
      useCase: 'Imported custom use case',
      storyboard: 'CUSTOM {{panel_count}} {{content}}',
      image: 'CUSTOM IMG {{panel_caption}} {{style_prompt}}'
    };
    await window.__optionsController.importPromptLibraryEntries([importedPreset]);
    await flush();

    const customSaveCall = chrome.storage.local.set.mock.calls.find(
      (call) => Array.isArray(call[0]?.promptLibraryCustomPresets)
    );
    expect(customSaveCall).toBeTruthy();
    expect(customSaveCall[0].promptLibraryCustomPresets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: 'custom',
          id: 'custom_case_1',
          storyboard: importedPreset.storyboard,
          image: importedPreset.image
        })
      ])
    );

    group.value = 'custom';
    group.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    const optionValues = Array.from(preset.options).map((option) => option.value);
    expect(optionValues).toContain('custom_case_1');
  });

  it('import normalizes duplicates and skips invalid prompt-library entries', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="prompts"]').click();
    await flush();

    const entries = [
      {
        group: 'custom',
        id: 'dup_case',
        name: 'Duplicate A',
        objective: 'Quick Summary',
        useCase: 'Valid A',
        storyboard: 'A {{panel_count}} {{content}}',
        image: 'A {{panel_caption}} {{style_prompt}}'
      },
      {
        group: 'custom',
        id: 'dup_case',
        name: 'Duplicate B',
        objective: 'Quick Summary',
        useCase: 'Valid B',
        storyboard: 'B {{panel_count}} {{content}}',
        image: 'B {{panel_caption}} {{style_prompt}}'
      },
      {
        group: 'custom',
        id: 'invalid_missing_image',
        name: 'Invalid',
        objective: 'Quick Summary',
        useCase: 'Missing image',
        storyboard: 'Invalid {{panel_count}} {{content}}'
      }
    ];

    await window.__optionsController.importPromptLibraryEntries(entries);
    await flush();

    const customSaveCall = chrome.storage.local.set.mock.calls
      .filter((call) => Array.isArray(call[0]?.promptLibraryCustomPresets))
      .pop();
    expect(customSaveCall).toBeTruthy();

    const saved = customSaveCall[0].promptLibraryCustomPresets.filter((p) => p.id === 'dup_case');
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Duplicate B');
    expect(saved[0].storyboard).toContain('B {{panel_count}}');
    expect(saved[0].image).toContain('B {{panel_caption}}');
    expect(customSaveCall[0].promptLibraryCustomPresets.some((p) => p.id === 'invalid_missing_image')).toBe(false);
  });

  it('saves Google Drive backup settings from Storage section', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="connections"]').click();
    await flush();

    const autoSave = document.getElementById('google-drive-auto-save');
    autoSave.checked = true;

    document.getElementById('save-drive-settings-btn').click();
    await flush();

    const settingsSaveCall = chrome.storage.local.set.mock.calls.find((call) => call[0]?.settings);
    expect(settingsSaveCall).toBeTruthy();
    expect(settingsSaveCall[0].settings.googleDriveAutoSave).toBe(true);
    expect(settingsSaveCall[0].settings.otherShareTarget).toBeTruthy();
  });

  it('connects and disconnects Google Drive via runtime message handlers', async () => {
    let connected = false;
    chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg?.type === 'GOOGLE_DRIVE_GET_STATUS') {
        return { success: true, status: { connected } };
      }
      if (msg?.type === 'GOOGLE_DRIVE_CONNECT') {
        connected = true;
        return { success: true, status: { connected: true } };
      }
      if (msg?.type === 'GOOGLE_DRIVE_DISCONNECT') {
        connected = false;
        return { success: true, status: { connected: false } };
      }
      return { success: true, result: { summary: 'OK' } };
    });

    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="connections"]').click();
    await flush();

    const autoSave = document.getElementById('google-drive-auto-save');
    const autoSaveItem = document.getElementById('google-drive-auto-save-item');
    expect(autoSave.disabled).toBe(true);
    expect(autoSaveItem.style.display).toBe('none');

    document.getElementById('connect-google-drive-btn').click();
    await flush();
    await flush();

    const connectCall = chrome.runtime.sendMessage.mock.calls.find((call) => call[0]?.type === 'GOOGLE_DRIVE_CONNECT');
    expect(connectCall).toBeTruthy();
    expect(connectCall[0]).toEqual({ type: 'GOOGLE_DRIVE_CONNECT' });
    expect(chrome.tabs.create).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('accounts.google.com') }));
    expect(autoSave.disabled).toBe(false);
    expect(autoSaveItem.style.display).toBe('');

    document.getElementById('disconnect-google-drive-btn').click();
    await flush();
    await flush();

    const disconnectCall = chrome.runtime.sendMessage.mock.calls.find((call) => call[0]?.type === 'GOOGLE_DRIVE_DISCONNECT');
    expect(disconnectCall).toBeTruthy();
    expect(autoSave.disabled).toBe(true);
    expect(autoSaveItem.style.display).toBe('none');
  });

  it('connects and disconnects X via runtime message handlers', async () => {
    let xConnected = false;
    chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg?.type === 'GOOGLE_DRIVE_GET_STATUS') return { success: true, status: { connected: false } };
      if (msg?.type === 'FACEBOOK_GET_STATUS') return { success: true, status: { connected: false } };
      if (msg?.type === 'X_GET_STATUS') return { success: true, status: { connected: xConnected } };
      if (msg?.type === 'X_CONNECT') {
        xConnected = true;
        return { success: true, status: { connected: true } };
      }
      if (msg?.type === 'X_DISCONNECT') {
        xConnected = false;
        return { success: true, status: { connected: false } };
      }
      return { success: true, result: { summary: 'OK' } };
    });

    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="connections"]').click();
    await flush();

    document.getElementById('connect-x-btn').click();
    await flush();
    await flush();

    const connectCall = chrome.runtime.sendMessage.mock.calls.find((call) => call[0]?.type === 'X_CONNECT');
    expect(connectCall).toBeTruthy();
    expect(connectCall[0]).toEqual({ type: 'X_CONNECT' });
    expect(chrome.tabs.create).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('x.com') }));

    const disconnectBtn = document.getElementById('disconnect-x-btn');
    expect(disconnectBtn.classList.contains('hidden')).toBe(false);
    document.getElementById('disconnect-x-btn').click();
    await flush();
    await flush();

    const disconnectCall = chrome.runtime.sendMessage.mock.calls.find((call) => call[0]?.type === 'X_DISCONNECT');
    expect(disconnectCall).toBeTruthy();
  });

  it('connects and disconnects Facebook via runtime message handlers', async () => {
    let fbConnected = false;
    chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg?.type === 'GOOGLE_DRIVE_GET_STATUS') return { success: true, status: { connected: false } };
      if (msg?.type === 'FACEBOOK_GET_STATUS') return { success: true, status: { connected: fbConnected } };
      if (msg?.type === 'X_GET_STATUS') return { success: true, status: { connected: false } };
      if (msg?.type === 'FACEBOOK_CONNECT') {
        fbConnected = true;
        return { success: true, status: { connected: true } };
      }
      if (msg?.type === 'FACEBOOK_DISCONNECT') {
        fbConnected = false;
        return { success: true, status: { connected: false } };
      }
      return { success: true, result: { summary: 'OK' } };
    });

    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="connections"]').click();
    await flush();

    document.getElementById('connect-facebook-btn').click();
    await flush();
    await flush();

    const connectCall = chrome.runtime.sendMessage.mock.calls.find((call) => call[0]?.type === 'FACEBOOK_CONNECT');
    expect(connectCall).toBeTruthy();
    expect(connectCall[0]).toEqual({ type: 'FACEBOOK_CONNECT' });
    expect(chrome.tabs.create).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('facebook.com') }));

    const disconnectBtn = document.getElementById('disconnect-facebook-btn');
    expect(disconnectBtn.classList.contains('hidden')).toBe(false);
    document.getElementById('disconnect-facebook-btn').click();
    await flush();
    await flush();

    const disconnectCall = chrome.runtime.sendMessage.mock.calls.find((call) => call[0]?.type === 'FACEBOOK_DISCONNECT');
    expect(disconnectCall).toBeTruthy();
  });

  it('shows OAuth app not configured status when provider app/client is unavailable', async () => {
    chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg?.type === 'GOOGLE_DRIVE_GET_STATUS') return { success: true, status: { connected: false, hasClientId: false } };
      if (msg?.type === 'FACEBOOK_GET_STATUS') return { success: true, status: { connected: false, hasAppId: false } };
      if (msg?.type === 'X_GET_STATUS') return { success: true, status: { connected: false, hasClientId: false } };
      return { success: true, result: { summary: 'OK' } };
    });

    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="connections"]').click();
    await flush();

    expect(String(document.getElementById('google-drive-connection-status').textContent || '')).toContain('OAuth app not configured');
    expect(String(document.getElementById('facebook-connection-status').textContent || '')).toContain('OAuth app not configured');
    expect(String(document.getElementById('x-connection-status').textContent || '')).toContain('OAuth app not configured');
    expect(document.getElementById('google-drive-auto-save').disabled).toBe(true);
    expect(document.getElementById('google-drive-auto-save-item').style.display).toBe('none');
    expect(document.getElementById('connect-google-drive-btn').disabled).toBe(true);
    expect(document.getElementById('disconnect-google-drive-btn').classList.contains('hidden')).toBe(true);
  });

  it('shows one relevant connection action at a time (connect vs disconnect)', async () => {
    let connected = false;
    chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg?.type === 'GOOGLE_DRIVE_GET_STATUS') return { success: true, status: { connected, hasClientId: true } };
      if (msg?.type === 'FACEBOOK_GET_STATUS') return { success: true, status: { connected: false, hasAppId: true } };
      if (msg?.type === 'X_GET_STATUS') return { success: true, status: { connected: false, hasClientId: true } };
      if (msg?.type === 'GOOGLE_DRIVE_CONNECT') {
        connected = true;
        return { success: true, status: { connected: true } };
      }
      if (msg?.type === 'GOOGLE_DRIVE_DISCONNECT') {
        connected = false;
        return { success: true, status: { connected: false } };
      }
      return { success: true };
    });

    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    document.querySelector('.nav-btn[data-section="connections"]').click();
    await flush();

    const connectBtn = document.getElementById('connect-google-drive-btn');
    const disconnectBtn = document.getElementById('disconnect-google-drive-btn');
    expect(connectBtn.classList.contains('hidden')).toBe(false);
    expect(disconnectBtn.classList.contains('hidden')).toBe(true);

    connectBtn.click();
    await flush();
    await flush();
    expect(connectBtn.classList.contains('hidden')).toBe(true);
    expect(disconnectBtn.classList.contains('hidden')).toBe(false);
  });

  it('renders connections as compact UI-only OAuth controls with no manual id/token fields', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="connections"]').click();
    await flush();

    expect(document.getElementById('google-drive-client-id')).toBeNull();
    expect(document.getElementById('facebook-app-id')).toBeNull();
    expect(document.getElementById('x-client-id')).toBeNull();

    const compactButtons = [
      document.getElementById('connect-google-drive-btn'),
      document.getElementById('disconnect-google-drive-btn'),
      document.getElementById('connect-facebook-btn'),
      document.getElementById('disconnect-facebook-btn'),
      document.getElementById('connect-x-btn'),
      document.getElementById('disconnect-x-btn')
    ];
    compactButtons.forEach((btn) => {
      expect(btn).toBeTruthy();
      expect(btn.classList.contains('icon-control')).toBe(true);
      const glyph = btn.querySelector('.icon-control-glyph');
      expect(glyph).toBeTruthy();
    });
  });

  it('connects and disconnects Instagram via local authorization state', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="connections"]').click();
    await flush();

    document.getElementById('connect-instagram-btn').click();
    await flush();

    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('instagram.com') }));
    expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      connectionStates: expect.objectContaining({ instagram: true })
    }));
    expect(String(document.getElementById('instagram-connection-status').textContent || '')).toContain('Connected');

    document.getElementById('disconnect-instagram-btn').click();
    await flush();
    expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      connectionStates: expect.objectContaining({ instagram: false })
    }));
  });

  it('connects selected other share target and updates status label', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="connections"]').click();
    await flush();

    const target = document.getElementById('other-share-target-select');
    target.value = 'linkedin';
    target.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    document.getElementById('connect-other-share-btn').click();
    await flush();

    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('linkedin') }));
    expect(String(document.getElementById('other-share-connection-status').textContent || '')).toContain('Connected (linkedin)');
  });

  it('does not include whatsapp or telegram in other share target connection options', async () => {
    await import('../../options/options.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();

    document.querySelector('.nav-btn[data-section="connections"]').click();
    await flush();

    const target = document.getElementById('other-share-target-select');
    const optionValues = Array.from(target.querySelectorAll('option')).map((opt) => opt.value);
    expect(optionValues).toEqual(expect.arrayContaining(['linkedin', 'reddit', 'email']));
    expect(optionValues).not.toContain('whatsapp');
    expect(optionValues).not.toContain('telegram');
  });
});
