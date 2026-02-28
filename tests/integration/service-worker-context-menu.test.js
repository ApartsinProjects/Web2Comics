import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Service Worker Context Menu Settings', () => {
  beforeEach(() => {
    vi.resetModules();
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'settings') return { settings: {} };
      if (key === 'history') return { history: [] };
      if (key === 'promptTemplates') return { promptTemplates: {} };
      if (key === 'apiKeys') return { apiKeys: {} };
      return {};
    });
    chrome.storage.local.set.mockResolvedValue(undefined);
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });
    chrome.tabs.sendMessage.mockResolvedValue({ success: true });
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com', title: 'Example' }]);
    chrome.sidePanel.open.mockResolvedValue(undefined);
    chrome.action.openPopup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses saved extension settings when generating from selection context menu', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'settings') {
        return {
          settings: {
            panelCount: 8,
            objective: 'timeline',
            outputLanguage: 'he',
            detailLevel: 'high',
            styleId: 'noir',
            captionLength: 'long',
            activeTextProvider: 'openai',
            activeImageProvider: 'openai',
            textModel: 'gpt-4o',
            imageModel: 'dall-e-3',
            openaiImageQuality: 'hd',
            openaiImageSize: '1024x1024'
          }
        };
      }
      if (key === 'history') return { history: [] };
      if (key === 'promptTemplates') return { promptTemplates: {} };
      if (key === 'apiKeys') return { apiKeys: { openai: 'sk-test-openai-key' } };
      return {};
    });

    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    expect(hook).toBeTruthy();
    const sw = hook.getServiceWorker();
    expect(sw).toBeTruthy();
    sw.executeGeneration = vi.fn(() => Promise.resolve());

    const result = await hook.triggerSelectionMenuGenerate(
      { selectionText: 'Selected text for context menu generation behavior validation.' },
      { url: 'https://example.com/article', title: 'Example Article', windowId: 1 }
    );
    await flush();

    expect(result?.started).toBe(true);

    const settingsCall = chrome.storage.local.set.mock.calls.find((call) => call[0]?.currentJob?.settings);
    expect(settingsCall).toBeTruthy();
    const settings = settingsCall[0].currentJob.settings;
    expect(settings.panel_count).toBe(8);
    expect(settings.objective).toBe('timeline');
    expect(settings.output_language).toBe('he');
    expect(settings.detail_level).toBe('high');
    expect(settings.style_id).toBe('noir');
    expect(settings.caption_len).toBe('long');
    expect(settings.provider_text).toBe('openai');
    expect(settings.provider_image).toBe('openai');
    expect(settings.text_model).toBe('gpt-4o');
    expect(settings.image_model).toBe('dall-e-3');
    expect(settings.image_quality).toBe('hd');
    expect(settings.image_size).toBe('1024x1024');
  });

  it('falls back to built-in defaults when settings are missing', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'settings') return {};
      if (key === 'history') return { history: [] };
      if (key === 'promptTemplates') return { promptTemplates: {} };
      if (key === 'apiKeys') return { apiKeys: {} };
      return {};
    });

    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();
    sw.executeGeneration = vi.fn(() => Promise.resolve());

    const result = await hook.triggerSelectionMenuGenerate(
      { selectionText: 'Selection text for fallback defaults test.' },
      { url: 'https://example.com/fallback', title: 'Fallback Article', windowId: 1 }
    );
    await flush();

    expect(result?.started).toBe(true);
    const settingsCall = chrome.storage.local.set.mock.calls.find((call) => call[0]?.currentJob?.settings);
    expect(settingsCall).toBeTruthy();
    const settings = settingsCall[0].currentJob.settings;
    expect(settings.panel_count).toBe(3);
    expect(settings.objective).toBe('summarize');
    expect(settings.output_language).toBe('en');
    expect(settings.provider_text).toBe('gemini-free');
    expect(settings.provider_image).toBe('gemini-free');
  });

  it('handles popup view enumeration safely when getViews returns non-array', async () => {
    chrome.extension.getViews.mockReturnValue(undefined);

    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    expect(() => sw.notifyProgress()).not.toThrow();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'JOB_PROGRESS_BROADCAST' })
    );
  });

  it('does not start generation when selection is empty', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();
    sw.executeGeneration = vi.fn(() => Promise.resolve());

    const result = await hook.triggerSelectionMenuGenerate(
      { selectionText: '   ' },
      { url: 'https://example.com/empty', title: 'Empty', windowId: 1 }
    );
    await flush();

    expect(result).toEqual({ started: false, reason: 'empty-selection' });
    expect(sw.executeGeneration).not.toHaveBeenCalled();
  });

  it('does not open composer when selection is empty', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;

    const result = await hook.triggerSelectionMenuOpenComposer(
      { selectionText: '' },
      { url: 'https://example.com/empty', title: 'Empty', windowId: 1 }
    );
    await flush();

    expect(result).toEqual({ opened: false, reason: 'empty-selection' });
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ pendingComposerPrefill: expect.any(Object) })
    );
  });

  it('continues generation when side panel open fails', async () => {
    chrome.sidePanel.open.mockRejectedValue(new Error('side panel unavailable'));

    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();
    sw.executeGeneration = vi.fn(() => Promise.resolve());

    const result = await hook.triggerSelectionMenuGenerate(
      { selectionText: 'Selection text for side panel failure case.' },
      { url: 'https://example.com/sidepanel', title: 'Side Panel', windowId: 1 }
    );
    await flush();

    expect(result?.started).toBe(true);
    expect(sw.executeGeneration).toHaveBeenCalled();
  });

  it('respects skipOpenPopup when opening composer from context menu', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;

    const result = await hook.triggerSelectionMenuOpenComposer(
      { selectionText: 'Selected text for skip popup flow.' },
      { url: 'https://example.com/compose', title: 'Compose', windowId: 1 },
      { skipOpenPopup: true }
    );
    await flush();

    expect(result).toEqual({ opened: true });
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingComposerPrefill: expect.objectContaining({
          text: 'Selected text for skip popup flow.'
        })
      })
    );
    expect(chrome.action.openPopup).not.toHaveBeenCalled();
  });

  it('falls back to defaults when reading settings throws', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'settings') throw new Error('storage read failed');
      if (key === 'history') return { history: [] };
      if (key === 'promptTemplates') return { promptTemplates: {} };
      if (key === 'apiKeys') return { apiKeys: {} };
      return {};
    });

    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();
    sw.executeGeneration = vi.fn(() => Promise.resolve());

    const result = await hook.triggerSelectionMenuGenerate(
      { selectionText: 'Selection text when settings read fails.' },
      { url: 'https://example.com/settings-error', title: 'Settings Error', windowId: 1 }
    );
    await flush();

    expect(result?.started).toBe(true);
    const settingsCall = chrome.storage.local.set.mock.calls.find((call) => call[0]?.currentJob?.settings);
    expect(settingsCall).toBeTruthy();
    expect(settingsCall[0].currentJob.settings.panel_count).toBe(3);
    expect(settingsCall[0].currentJob.settings.objective).toBe('summarize');
  });

  it('attempts popup open even when side panel open fails', async () => {
    chrome.sidePanel.open.mockRejectedValue(new Error('side panel unavailable'));

    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();
    sw.executeGeneration = vi.fn(() => Promise.resolve());

    const result = await hook.triggerSelectionMenuGenerate(
      { selectionText: 'Selection text for popup fallback behavior.' },
      { url: 'https://example.com/popup-fallback', title: 'Popup Fallback', windowId: 1 }
    );
    await flush();

    expect(result?.started).toBe(true);
    expect(chrome.action.openPopup).toHaveBeenCalled();
  });

  it('keeps generation successful when popup open fails', async () => {
    chrome.action.openPopup.mockRejectedValue(new Error('popup not available'));

    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();
    sw.executeGeneration = vi.fn(() => Promise.resolve());

    const result = await hook.triggerSelectionMenuGenerate(
      { selectionText: 'Selection text for popup error handling.' },
      { url: 'https://example.com/popup-error', title: 'Popup Error', windowId: 1 }
    );
    await flush();

    expect(result?.started).toBe(true);
    expect(sw.executeGeneration).toHaveBeenCalled();
  });
});
