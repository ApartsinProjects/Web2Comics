import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const popupHtmlPath = path.resolve(__dirname, '../../popup/popup.html');

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Popup Page Startup', () => {
  beforeEach(() => {
    vi.resetModules();
    const html = fs.readFileSync(popupHtmlPath, 'utf8');
    document.documentElement.innerHTML = html;

    global.alert = vi.fn();
    global.confirm = vi.fn(() => true);

    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        return {
          settings: { activeTextProvider: 'openai', activeImageProvider: 'openai' },
          providers: {}
        };
      }
      if (keys === 'onboardingComplete') {
        return { onboardingComplete: true };
      }
      if (keys === 'history') {
        return { history: [] };
      }
      if (keys === 'currentJob') {
        return { currentJob: null };
      }
      if (keys === 'apiKeys') {
        return { apiKeys: { openai: global.TEST_OPENAI_API_KEY } };
      }
      return {};
    });
    chrome.storage.local.set.mockResolvedValue(undefined);
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com', title: 'Example' }]);
    chrome.tabs.sendMessage.mockResolvedValue({
      success: true,
      text: 'short text'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
  });

  it('shows two launcher options by default and can open the create comic composer', async () => {
    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const homeSection = document.getElementById('home-section');
    const mainSection = document.getElementById('main-section');
    expect(homeSection.classList.contains('hidden')).toBe(false);
    expect(mainSection.classList.contains('hidden')).toBe(true);

    expect(document.getElementById('create-comic-btn')).toBeTruthy();
    expect(document.getElementById('view-history-btn')).toBeTruthy();

    document.getElementById('create-comic-btn').click();
    await flush();

    expect(homeSection.classList.contains('hidden')).toBe(true);
    expect(mainSection.classList.contains('hidden')).toBe(false);

    const generateBtn = document.getElementById('generate-btn');
    expect(generateBtn).toBeTruthy();

    expect(generateBtn.disabled).toBe(true);
    const readinessText = document.getElementById('wizard-readiness-text');
    expect(String(readinessText.textContent)).toContain('extract more page content');
  });

  it('applies local recommended model defaults for missing model settings', async () => {
    chrome.tabs.sendMessage.mockResolvedValue({
      success: true,
      text: 'x '.repeat(300)
    });
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        return {
          providers: {},
          settings: { activeTextProvider: 'openai', activeImageProvider: 'openai' }
        };
      }
      if (keys === 'history') return { history: [] };
      if (keys === 'currentJob') return { currentJob: null };
      if (keys === 'apiKeys') return { apiKeys: { openai: global.TEST_OPENAI_API_KEY } };
      return {};
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        providers: {
          openai: { text: 'gpt-4.1-mini', image: 'dall-e-3' },
          gemini: { text: 'gemini-flash-latest' }
        }
      })
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('create-comic-btn').click();
    await flush();
    expect(document.getElementById('provider-preset')).toBeTruthy();

    const ctrl = window.__popupController;
    expect(ctrl).toBeTruthy();
    expect(ctrl.settings.textModel).toBe('gpt-4.1-mini');
    expect(ctrl.settings.imageModel).toBe('dall-e-3');
    expect(ctrl.settings.geminiTextModel).toBe('gemini-flash-latest');
  });

  it('renders manual help links for popup panels', async () => {
    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const headerHelp = document.querySelector('.popup-header .help-link-icon');
    expect(headerHelp).toBeTruthy();
    expect(headerHelp.getAttribute('href')).toContain('../docs/user-manual.html#popup-overview');
    const footerHelp = document.getElementById('footer-help-link');
    expect(footerHelp).toBeTruthy();
    expect(footerHelp.getAttribute('href')).toContain('../docs/user-manual.html#popup-overview');
    expect(footerHelp.textContent).toContain('Help');

    document.getElementById('create-comic-btn').click();
    await flush();

    const composerHelp = document.querySelector('.composer-header .help-link-icon');
    expect(composerHelp).toBeTruthy();
    expect(composerHelp.getAttribute('href')).toContain('#popup-create');
  });

  it('hides API key warning when selected provider has a stored key', async () => {
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        return {
          settings: { activeTextProvider: 'openai', activeImageProvider: 'openai' },
          providers: {}
        };
      }
      if (keys === 'onboardingComplete') {
        return { onboardingComplete: true };
      }
      if (keys === 'history') {
        return { history: [] };
      }
      if (keys === 'currentJob') {
        return { currentJob: null };
      }
      if (keys === 'apiKeys') {
        return { apiKeys: { openai: global.TEST_OPENAI_API_KEY } };
      }
      return {};
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const warning = document.getElementById('api-key-warning');
    expect(warning.classList.contains('hidden')).toBe(true);
  });

  it('hides unconfigured providers in generation panel and falls back selection', async () => {
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        return {
          settings: { activeTextProvider: 'openai', activeImageProvider: 'openai' },
          providers: {}
        };
      }
      if (keys === 'onboardingComplete') return { onboardingComplete: true };
      if (keys === 'history') return { history: [] };
      if (keys === 'currentJob') {
        return {
          currentJob: {
            id: 'job-complete',
            status: 'completed',
            storyboard: {
              panels: [
                { caption: 'P1', artifacts: { image_blob_ref: 'data:image/png;base64,aaa' } }
              ]
            }
          }
        };
      }
      if (keys === 'apiKeys') return { apiKeys: {} };
      if (keys === 'debugLogs') return { debugLogs: [] };
      return {};
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('create-comic-btn').click();
    await flush();
    await flush();

    const providerSelect = document.getElementById('provider-preset');
    const openaiOption = providerSelect.querySelector('option[value="openai"]');
    const geminiOption = providerSelect.querySelector('option[value="gemini-free"]');
    const cloudflareOption = providerSelect.querySelector('option[value="cloudflare-free"]');
    const huggingfaceOption = providerSelect.querySelector('option[value="huggingface"]');

    expect(openaiOption.hidden).toBe(true);
    expect(geminiOption.hidden).toBe(true);
    expect(huggingfaceOption.hidden).toBe(true);
    expect(cloudflareOption.hidden).toBe(false);
    expect(providerSelect.value).toBe('cloudflare-free');
  });

  it('hides key-based providers when validation records exist but provider is not validated', async () => {
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        const result = {};
        if (keys.includes('settings') || keys.includes('providers')) {
          result.settings = { activeTextProvider: 'openai', activeImageProvider: 'openai' };
          result.providers = {};
        }
        if (keys.includes('apiKeys')) {
          result.apiKeys = { openai: global.TEST_OPENAI_API_KEY };
        }
        if (keys.includes('providerValidation')) {
          result.providerValidation = { openai: { valid: false } };
        }
        return result;
      }
      if (keys === 'onboardingComplete') return { onboardingComplete: true };
      if (keys === 'history') return { history: [] };
      if (keys === 'currentJob') return { currentJob: null };
      if (keys === 'debugLogs') return { debugLogs: [] };
      if (keys === 'customStyles') return { customStyles: [] };
      if (keys === 'apiKeys') return { apiKeys: { openai: global.TEST_OPENAI_API_KEY } };
      return {};
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('create-comic-btn').click();
    await flush();
    await flush();

    const providerSelect = document.getElementById('provider-preset');
    const openaiOption = providerSelect.querySelector('option[value="openai"]');
    expect(openaiOption.hidden).toBe(true);
    expect(providerSelect.value).toBe('cloudflare-free');
  });

  it('selects Cloudflare as image provider when selecting Cloudflare Workers AI', async () => {
    let savedSettings;
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        return {
          settings: { activeTextProvider: 'openai', activeImageProvider: 'openai' },
          providers: {}
        };
      }
      if (keys === 'onboardingComplete') return { onboardingComplete: true };
      if (keys === 'history') return { history: [] };
      if (keys === 'currentJob') return { currentJob: null };
      if (keys === 'apiKeys') return { apiKeys: { openai: global.TEST_OPENAI_API_KEY } };
      return {};
    });
    chrome.storage.local.set.mockImplementation(async (obj) => {
      if (obj.settings) savedSettings = obj.settings;
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('create-comic-btn').click();
    await flush();

    const providerSelect = document.getElementById('provider-preset');
    providerSelect.value = 'cloudflare-free';
    providerSelect.dispatchEvent(new Event('change'));
    await flush();
    await flush();

    expect(savedSettings.activeTextProvider).toBe('cloudflare-free');
    expect(savedSettings.activeImageProvider).toBe('cloudflare-free');
  });

  it('alerts user when comic completes with panel rendering errors and debug flag is enabled', async () => {
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        return {
          settings: {
            activeTextProvider: 'openai',
            activeImageProvider: 'openai',
            debugFlag: true
          },
          providers: {}
        };
      }
      if (keys === 'onboardingComplete') return { onboardingComplete: true };
      if (keys === 'history') return { history: [] };
      if (keys === 'apiKeys') return { apiKeys: { openai: global.TEST_OPENAI_API_KEY } };
      if (keys === 'currentJob') {
        return {
          currentJob: {
            id: 'job-1',
            status: 'completed',
            panelErrors: [{ panelId: 'panel_2', message: 'FileReader is not defined' }],
            storyboard: {
              settings: { provider_text: 'openai', provider_image: 'openai' },
              panels: [
                { caption: 'Panel 1', artifacts: { image_blob_ref: 'data:image/png;base64,aaa' } },
                { caption: 'Panel 2', artifacts: { error: 'FileReader is not defined' } }
              ]
            }
          }
        };
      }
      return {};
    });

    chrome.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
      if (msg.type === 'EXTRACT_CONTENT') {
        return { success: true, text: 'x'.repeat(200) };
      }
      if (msg.type === 'START_GENERATION') {
        return { success: true, jobId: 'job-1' };
      }
      return { success: false };
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('create-comic-btn').click();
    await flush();
    document.getElementById('generate-btn').click();

    await new Promise((resolve) => setTimeout(resolve, 650));

    expect(global.alert).toHaveBeenCalled();
    const alerts = global.alert.mock.calls.map((c) => c[0]);
    expect(alerts.some((msg) => String(msg).includes('Comic created, but some panels failed to render'))).toBe(true);
    expect(alerts.some((msg) => String(msg).includes('panel_2: FileReader is not defined'))).toBe(true);
    expect(chrome.sidePanel.open).toHaveBeenCalled();
  });

  it('shows elapsed time, current phase, and ETA in progress view after first panel completes', async () => {
    let pollCount = 0;
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        const result = {
          settings: { activeTextProvider: 'openai', activeImageProvider: 'openai' },
          providers: {}
        };
        if (keys.includes('apiKeys')) result.apiKeys = { openai: global.TEST_OPENAI_API_KEY };
        if (keys.includes('providerValidation')) result.providerValidation = { openai: { valid: true } };
        return result;
      }
      if (keys === 'history') return { history: [] };
      if (keys === 'apiKeys') return { apiKeys: { openai: global.TEST_OPENAI_API_KEY } };
      if (keys === 'providerValidation') return { providerValidation: { openai: { valid: true } } };
      if (keys === 'debugLogs') return { debugLogs: [] };
      if (keys === 'currentJob') {
        pollCount += 1;
        if (pollCount <= 1) {
          return {
            currentJob: {
              id: 'job-progress-eta',
              status: 'generating_images',
              completedPanels: 1,
              currentPanelIndex: 1,
              settings: { panel_count: 3 },
              storyboard: {
                panels: [
                  { caption: 'Panel 1', artifacts: { image_blob_ref: 'data:image/png;base64,aaa' } },
                  { caption: 'Panel 2', artifacts: {} },
                  { caption: 'Panel 3', artifacts: {} }
                ]
              }
            }
          };
        }
        return {
          currentJob: {
            id: 'job-progress-eta',
            status: 'completed',
            completedPanels: 3,
            currentPanelIndex: 2,
            settings: { panel_count: 3 },
            storyboard: {
              panels: [
                { caption: 'Panel 1', artifacts: { image_blob_ref: 'data:image/png;base64,aaa' } },
                { caption: 'Panel 2', artifacts: { image_blob_ref: 'data:image/png;base64,bbb' } },
                { caption: 'Panel 3', artifacts: { image_blob_ref: 'data:image/png;base64,ccc' } }
              ]
            }
          }
        };
      }
      return {};
    });

    chrome.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
      if (msg.type === 'EXTRACT_CONTENT') return { success: true, text: 'x'.repeat(400) };
      if (msg.type === 'START_GENERATION') return { success: true, jobId: 'job-progress-eta' };
      return { success: false };
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('create-comic-btn').click();
    await flush();
    await flush();

    document.getElementById('generate-btn').click();
    await new Promise((resolve) => setTimeout(resolve, 550));

    const statusDetail = document.getElementById('progress-status-detail');
    expect(statusDetail).toBeTruthy();
    const text = String(statusDetail.textContent || '');
    expect(text).toContain('Elapsed');
    expect(text).toMatch(/ETA:\s*(~|done)/);
    expect(text).toMatch(/Rendering panels|Completed/);
  });

  it('opens history modal even when history entries are partially malformed', async () => {
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        return {
          settings: {
            activeTextProvider: 'openai',
            activeImageProvider: 'openai',
            debugFlag: true
          },
          providers: {}
        };
      }
      if (keys === 'onboardingComplete') return { onboardingComplete: true };
      if (keys === 'apiKeys') return { apiKeys: { openai: global.TEST_OPENAI_API_KEY } };
      if (keys === 'history') {
        return {
          history: [
            { id: 'bad-1' },
            { id: 'ok-1', source: { title: 'Saved Comic' }, generated_at: '2026-02-24T00:00:00.000Z' }
          ]
        };
      }
      if (keys === 'currentJob') return { currentJob: null };
      if (keys === 'debugLogs') return { debugLogs: [] };
      return {};
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('view-history-btn').click();
    await flush();
    await flush();

    const modal = document.getElementById('history-modal');
    const list = document.getElementById('history-list');
    expect(modal.classList.contains('hidden')).toBe(false);
    expect(list.querySelectorAll('.history-item').length).toBe(2);
    expect(global.alert).not.toHaveBeenCalledWith('Failed to open history.');
  });

  it('escapes popup history item titles when rendering history modal', async () => {
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        return {
          settings: { activeTextProvider: 'openai', activeImageProvider: 'openai', debugFlag: true },
          providers: {}
        };
      }
      if (keys === 'onboardingComplete') return { onboardingComplete: true };
      if (keys === 'apiKeys') return { apiKeys: { openai: global.TEST_OPENAI_API_KEY } };
      if (keys === 'history') {
        return {
          history: [
            {
              id: 'bad1',
              source: { title: '<img src=x onerror=alert(1)> Unsafe' },
              generated_at: '2026-02-24T00:00:00.000Z',
              thumbnail: ''
            }
          ]
        };
      }
      if (keys === 'currentJob') return { currentJob: null };
      if (keys === 'debugLogs') return { debugLogs: [] };
      return {};
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('view-history-btn').click();
    await flush();
    await flush();

    const title = document.querySelector('#history-list .history-title');
    expect(title).toBeTruthy();
    expect(title.innerHTML).not.toContain('<img');
    expect(document.querySelector('#history-list img[src="x"]')).toBeNull();
  });

  it('sends selected style preset and custom style name/description in generation payload', async () => {
    let startPayload;

    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        return {
          settings: {
            activeTextProvider: 'openai',
            activeImageProvider: 'openai',
            styleId: 'default'
          },
          providers: {}
        };
      }
      if (keys === 'onboardingComplete') return { onboardingComplete: true };
      if (keys === 'history') return { history: [] };
      if (keys === 'apiKeys') return { apiKeys: { openai: global.TEST_OPENAI_API_KEY } };
      if (keys === 'currentJob') return { currentJob: null };
      if (keys === 'debugLogs') return { debugLogs: [] };
      return {};
    });

    chrome.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
      if (msg.type === 'EXTRACT_CONTENT') {
        return { success: true, text: 'x'.repeat(400) };
      }
      if (msg.type === 'START_GENERATION') {
        startPayload = msg.payload;
        return { success: true, jobId: 'job-style-1' };
      }
      return { success: false };
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('create-comic-btn').click();
    await flush();

    const styleSelect = document.getElementById('style-preset');
    styleSelect.value = 'custom';
    styleSelect.dispatchEvent(new Event('change'));
    await flush();

    const customName = document.getElementById('custom-style-name-input');
    const customDesc = document.getElementById('custom-style-input');
    customName.value = 'Retro Pulp Adventure';
    customName.dispatchEvent(new Event('input'));
    customDesc.value = 'Vintage halftone print, bold captions, warm paper texture';
    customDesc.dispatchEvent(new Event('input'));

    document.getElementById('generate-btn').click();
    await flush();

    expect(startPayload).toBeTruthy();
    expect(startPayload.settings.style_id).toBe('custom');
    expect(startPayload.settings.custom_style_name).toBe('Retro Pulp Adventure');
    expect(startPayload.settings.custom_style_theme).toContain('Vintage halftone print');
    expect(startPayload.settings.image_model).toBeTruthy();
    expect(startPayload.settings.image_quality).toBeTruthy();
    expect(startPayload.settings.image_size).toBeTruthy();
  });

  it('maps provider-specific selected models into generation payload (Cloudflare example)', async () => {
    let startPayload;
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        const result = {
          settings: {
            activeTextProvider: 'openai',
            activeImageProvider: 'openai',
            textModel: 'gpt-4.1',
            imageModel: 'dall-e-3',
            geminiTextModel: 'gemini-2.5-flash',
            geminiImageModel: 'gemini-2.5-flash-image',
            cloudflareTextModel: '@cf/meta/llama-3.1-8b-instruct-fast',
            cloudflareImageModel: '@cf/bytedance/stable-diffusion-xl-lightning',
            openrouterTextModel: 'openrouter/auto',
            huggingfaceTextModel: 'meta-llama/Llama-3.1-8B-Instruct'
          },
          providers: {}
        };
        if (keys.includes('apiKeys')) {
          result.apiKeys = {
            openai: global.TEST_OPENAI_API_KEY,
            gemini: 'gemini-key',
            openrouter: 'sk-or-v1-key',
            huggingface: 'hf_key'
          };
        }
        if (keys.includes('providerValidation')) {
          result.providerValidation = {
            openai: { valid: true },
            gemini: { valid: true },
            openrouter: { valid: true },
            huggingface: { valid: true }
          };
        }
        return result;
      }
      if (keys === 'history') return { history: [] };
      if (keys === 'currentJob') return { currentJob: null };
      if (keys === 'apiKeys') {
        return {
          apiKeys: {
            openai: global.TEST_OPENAI_API_KEY,
            gemini: 'gemini-key',
            openrouter: 'sk-or-v1-key',
            huggingface: 'hf_key'
          }
        };
      }
      if (keys === 'providerValidation') {
        return { providerValidation: { openai: { valid: true }, gemini: { valid: true }, openrouter: { valid: true }, huggingface: { valid: true } } };
      }
      if (keys === 'debugLogs') return { debugLogs: [] };
      return {};
    });

    chrome.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
      if (msg.type === 'EXTRACT_CONTENT') return { success: true, text: 'x'.repeat(500) };
      if (msg.type === 'START_GENERATION') {
        startPayload = msg.payload;
        return { success: true, jobId: 'job-model-map-1' };
      }
      return { success: false };
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('create-comic-btn').click();
    await flush();
    await flush();

    const providerSelect = document.getElementById('provider-preset');
    providerSelect.value = 'cloudflare-free';
    providerSelect.dispatchEvent(new Event('change'));
    await flush();
    await flush();

    document.getElementById('generate-btn').click();
    await flush();

    expect(startPayload).toBeTruthy();
    expect(startPayload.settings.provider_text).toBe('cloudflare-free');
    expect(startPayload.settings.provider_image).toBe('cloudflare-free');
    expect(startPayload.settings.text_model).toBe('@cf/meta/llama-3.1-8b-instruct-fast');
    expect(startPayload.settings.image_model).toBe('@cf/bytedance/stable-diffusion-xl-lightning');
  });

  it('creates a saved custom style from modal and reuses it in generation payload', async () => {
    const store = {
      settings: { activeTextProvider: 'openai', activeImageProvider: 'openai', styleId: 'default' },
      onboardingComplete: true,
      history: [],
      currentJob: null,
      apiKeys: { openai: global.TEST_OPENAI_API_KEY },
      customStyles: []
    };
    let startPayload;

    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        return { settings: store.settings, providers: {} };
      }
      if (keys === 'onboardingComplete') return { onboardingComplete: store.onboardingComplete };
      if (keys === 'history') return { history: store.history };
      if (keys === 'currentJob') return { currentJob: store.currentJob };
      if (keys === 'apiKeys') return { apiKeys: store.apiKeys };
      if (keys === 'customStyles') return { customStyles: store.customStyles };
      if (keys === 'debugLogs') return { debugLogs: [] };
      return {};
    });
    chrome.storage.local.set.mockImplementation(async (obj) => {
      Object.assign(store, obj);
    });

    chrome.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
      if (msg.type === 'EXTRACT_CONTENT') return { success: true, text: 'x'.repeat(500) };
      if (msg.type === 'START_GENERATION') {
        startPayload = msg.payload;
        return { success: true, jobId: 'job-style-lib-1' };
      }
      return { success: false };
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('create-comic-btn').click();
    await flush();

    const styleSelect = document.getElementById('style-preset');
    styleSelect.value = '__create_new_style__';
    styleSelect.dispatchEvent(new Event('change'));
    await flush();

    expect(document.getElementById('style-modal').classList.contains('hidden')).toBe(false);

    document.getElementById('new-style-name-input').value = 'Ink Wash Chronicle';
    document.getElementById('new-style-description-input').value = 'Monochrome ink wash, brush textures, dramatic fog and soft gradients';
    document.getElementById('save-style-modal-btn').click();
    await flush();
    await flush();

    expect(Array.isArray(store.customStyles)).toBe(true);
    expect(store.customStyles.length).toBe(1);
    expect(styleSelect.value.startsWith('user:')).toBe(true);

    document.getElementById('generate-btn').click();
    await flush();

    expect(startPayload.settings.style_id).toBe('custom');
    expect(startPayload.settings.custom_style_name).toBe('Ink Wash Chronicle');
    expect(startPayload.settings.custom_style_theme).toContain('ink wash');
  });

  it('collapses advanced settings by default and expands on toggle', async () => {
    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('create-comic-btn').click();
    await flush();

    const panel = document.getElementById('advanced-settings-panel');
    const toggle = document.getElementById('advanced-settings-toggle');
    expect(panel.classList.contains('hidden')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    await flush();

    expect(panel.classList.contains('hidden')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps generate disabled and shows hard-guard alert when wizard readiness is not met', async () => {
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        return {
          settings: { activeTextProvider: 'openai', activeImageProvider: 'openai' },
          providers: {}
        };
      }
      if (keys === 'onboardingComplete') return { onboardingComplete: true };
      if (keys === 'history') return { history: [] };
      if (keys === 'currentJob') return { currentJob: null };
      if (keys === 'apiKeys') return { apiKeys: {} };
      if (keys === 'debugLogs') return { debugLogs: [] };
      return {};
    });

    chrome.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
      if (msg.type === 'EXTRACT_CONTENT') return { success: true, text: 'too short' };
      return { success: false };
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('create-comic-btn').click();
    await flush();
    await flush();

    const generateBtn = document.getElementById('generate-btn');
    expect(generateBtn.disabled).toBe(true);
    expect(generateBtn.title).toContain('extract more page content');

    generateBtn.disabled = false;
    generateBtn.click();
    await flush();

    expect(global.alert).toHaveBeenCalled();
    expect(String(global.alert.mock.calls.at(-1)?.[0] || '')).toContain('Before generating');
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'START_GENERATION' }));
  });

  it('enables generate when content is sufficient and selected provider is validated', async () => {
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (Array.isArray(keys)) {
        const result = { settings: { activeTextProvider: 'openai', activeImageProvider: 'openai' }, providers: {} };
        if (keys.includes('apiKeys')) result.apiKeys = { openai: global.TEST_OPENAI_API_KEY };
        if (keys.includes('providerValidation')) result.providerValidation = { openai: { valid: true } };
        return result;
      }
      if (keys === 'onboardingComplete') return { onboardingComplete: true };
      if (keys === 'history') return { history: [] };
      if (keys === 'currentJob') return { currentJob: null };
      if (keys === 'apiKeys') return { apiKeys: { openai: global.TEST_OPENAI_API_KEY } };
      if (keys === 'providerValidation') return { providerValidation: { openai: { valid: true } } };
      return {};
    });

    chrome.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
      if (msg.type === 'EXTRACT_CONTENT') return { success: true, text: 'x'.repeat(300) };
      if (msg.type === 'START_GENERATION') return { success: true, jobId: 'job-ready-1' };
      return { success: false };
    });

    await import('../../popup/popup.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('create-comic-btn').click();
    await flush();
    await flush();

    const generateBtn = document.getElementById('generate-btn');
    const readinessText = document.getElementById('wizard-readiness-text');
    expect(generateBtn.disabled).toBe(false);
    expect(String(readinessText.textContent)).toContain('Ready to generate');
  });
});
