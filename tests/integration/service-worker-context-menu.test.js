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
    expect(settings.objective).toBe('explain-like-im-five');
    expect(settings.output_language).toBe('en');
    expect(settings.provider_text).toBe('gemini-free');
    expect(settings.provider_image).toBe('gemini-free');
  });

  it('builds storyboard prompts with the selected output language (ru/he) instead of falling back to English', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();
    const gemini = sw.getTextProvider('gemini-free');

    const ruPrompt = gemini.buildStoryboardPrompt('Sample content text.', {
      panelCount: 3,
      outputLanguage: 'ru',
      sourceTitle: 'Sample',
      sourceUrl: 'https://example.com'
    });
    expect(ruPrompt).toContain('Output language: Russian');
    expect(ruPrompt).toContain('image_prompt text');
    expect(ruPrompt).toContain('in Russian');

    const hePrompt = gemini.buildStoryboardPrompt('Sample content text.', {
      panelCount: 3,
      outputLanguage: 'he',
      sourceTitle: 'Sample',
      sourceUrl: 'https://example.com'
    });
    expect(hePrompt).toContain('Output language: Hebrew');
    expect(hePrompt).toContain('in Hebrew');
  });

  it('uses localized storyboard meta fallback for selected output language', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const meta = await sw.generateStableStoryboardMeta(
      { sourceTitle: '', extractedText: '' },
      { panels: [] },
      { provider_text: 'openai', output_language: 'ru' }
    );

    expect(meta.title).toBe('Краткий пересказ истории');
    expect(meta.shortTitle).toBe('Краткий пересказ истории');
  });

  it('processes full source content into top stories via LLM selection handler', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'settings') return { settings: {} };
      if (key === 'history') return { history: [] };
      if (key === 'promptTemplates') return { promptTemplates: {} };
      if (key === 'apiKeys') return { apiKeys: { gemini: 'gemini-test-key' } };
      return {};
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    stories: [
                      {
                        title: 'Regional Tension Escalates',
                        summary: 'Diplomatic and security developments intensified across multiple fronts with competing statements and responses.',
                        candidate_id: 'candidate_1',
                        score: 93
                      }
                    ]
                  })
                }
              ]
            }
          }
        ]
      })
    });

    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const result = await sw.handleProcessContentStories({
      payload: {
        sourceText: 'A long article source text used for story extraction and ranking.',
        sourceTitle: 'World News',
        sourceUrl: 'https://example.com/world',
        preferredProvider: 'gemini-free',
        settings: { text_model: 'gemini-2.5-flash' },
        candidatePayloads: [
          { id: 'candidate_0', summary: 'Economy update summary', score: 80, chars: 900, text: 'Economy block text.' },
          { id: 'candidate_1', summary: 'Security update summary', score: 88, chars: 1200, text: 'Security block text.' }
        ]
      }
    });

    expect(result.providerUsed).toBe('gemini-free');
    expect(Array.isArray(result.stories)).toBe(true);
    expect(result.stories.length).toBeGreaterThan(0);
    expect(result.stories[0].title).toBe('Regional Tension Escalates');
    expect(result.stories[0].sourceCandidateId).toBe('candidate_1');
    expect(result.selectedStoryId).toBe('candidate_candidate_1');
  });

  it('includes full HTML in Gemini story-selection prompt when provided', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'settings') return { settings: {} };
      if (key === 'history') return { history: [] };
      if (key === 'promptTemplates') return { promptTemplates: {} };
      if (key === 'apiKeys') return { apiKeys: { gemini: 'gemini-test-key' } };
      return {};
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    stories: [
                      {
                        title: 'Top Story From HTML',
                        summary: 'The lead story was identified from HTML structure and visible article blocks.',
                        candidate_id: 'candidate_0',
                        score: 90
                      }
                    ]
                  })
                }
              ]
            }
          }
        ]
      })
    });

    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const html = '<!doctype html><html><body><main><article><h1>Headline</h1><p>Lead story text</p></article></main></body></html>';
    const result = await sw.handleProcessContentStories({
      payload: {
        sourceText: '',
        sourceHtml: html,
        sourceTitle: 'HTML Source Page',
        sourceUrl: 'https://example.com/html',
        preferredProvider: 'gemini-free',
        settings: { text_model: 'gemini-2.5-flash' },
        candidatePayloads: [
          { id: 'candidate_0', summary: 'Lead summary', score: 70, chars: 400, text: 'Lead story text.' }
        ]
      }
    });

    const fetchBody = JSON.parse(String(global.fetch.mock.calls[0][1].body || '{}'));
    const promptText = String(fetchBody?.contents?.[0]?.parts?.[0]?.text || '');

    expect(promptText).toContain('Full HTML document');
    expect(promptText).toContain('<article>');
    expect(result.providerUsed).toBe('gemini-free');
    expect(result.stories[0].title).toBe('Top Story From HTML');
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

  it('opens popup and stores source metadata when opening composer from context menu by default', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;

    const result = await hook.triggerSelectionMenuOpenComposer(
      { selectionText: 'Selected text for default open composer flow.' },
      { url: 'https://example.com/source', title: 'Source Article', windowId: 1 }
    );
    await flush();

    expect(result).toEqual({ opened: true });
    const prefillCall = chrome.storage.local.set.mock.calls.find((call) => call[0]?.pendingComposerPrefill);
    expect(prefillCall).toBeTruthy();
    expect(prefillCall[0].pendingComposerPrefill).toMatchObject({
      text: 'Selected text for default open composer flow.',
      sourceUrl: 'https://example.com/source',
      sourceTitle: 'Source Article',
      source: 'context-menu-selection'
    });
    expect(chrome.action.openPopup).toHaveBeenCalled();
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
    expect(settingsCall[0].currentJob.settings.objective).toBe('explain-like-im-five');
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

  it('registers toolbar action context menu items for Comicify and My Collection', async () => {
    await import('../../background/service-worker.js');

    const calls = chrome.contextMenus.create.mock.calls.map((c) => c[0] || {});
    const comicify = calls.find((c) => c.id === 'web2comics-toolbar-comicify');
    const collection = calls.find((c) => c.id === 'web2comics-toolbar-collection');

    expect(comicify).toBeTruthy();
    expect(comicify.title).toBe('Comicify');
    expect(comicify.contexts).toEqual(['action']);

    expect(collection).toBeTruthy();
    expect(collection.title).toBe('My Collection');
    expect(collection.contexts).toEqual(['action']);
  });

  it('opens popup from toolbar Comicify menu and falls back to popup tab when needed', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;

    let result = await hook.triggerToolbarMenuComicify({ windowId: 1 });
    await flush();
    expect(result).toEqual({ opened: true });
    expect(chrome.action.openPopup).toHaveBeenCalled();

    chrome.action.openPopup.mockRejectedValue(new Error('popup blocked'));
    result = await hook.triggerToolbarMenuComicify({ windowId: 1 });
    await flush();
    expect(result).toEqual({ opened: true, fallback: 'tab' });
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('/popup/popup.html') })
    );
  });

  it('opens My Collection from toolbar menu via sidepanel and falls back to tab', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;

    let result = await hook.triggerToolbarMenuCollection({ windowId: 7 });
    await flush();
    expect(result).toEqual({ opened: true, target: 'sidepanel' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ sidepanelInitialView: 'history' })
    );
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 7 });

    chrome.sidePanel.open.mockRejectedValue(new Error('sidepanel unavailable'));
    result = await hook.triggerToolbarMenuCollection({ windowId: 9 });
    await flush();
    expect(result).toEqual({ opened: true, target: 'tab' });
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('/sidepanel/sidepanel.html?view=history') })
    );
  });

  it('extracts panel facts from the most relevant sentence and filters unrelated entities', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const facts = sw.extractPanelFacts(
      { caption: 'Israel inflation in 2024 and Bank of Israel outlook' },
      [
        'Meanwhile Committee members in Washington discussed unrelated policy details.',
        'Israel inflation reached 3.2% in 2024, according to the Bank of Israel in Jerusalem.'
      ].join(' ')
    );

    expect(String(facts.source_snippet || '')).toContain('Israel inflation reached 3.2% in 2024');
    const entitiesText = (facts.entities || []).join(' ');
    expect(entitiesText).toContain('Israel');
    expect(entitiesText).toContain('Bank');
    expect(entitiesText).not.toContain('Committee');
  });

  it('keeps entities conservative when caption has weak overlap with source', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const facts = sw.extractPanelFacts(
      { caption: 'Update' },
      'The Council met in Geneva. Delegates reviewed procedural matters and issued a brief note.'
    );

    const entities = Array.isArray(facts.entities) ? facts.entities : [];
    expect(entities).not.toContain('The');
    expect(entities.length).toBeLessThanOrEqual(2);
  });

  it('regenerate-caption keeps beat meaning and only changes phrasing form', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const caption = sw.transformPanelCaption(
      {
        beat_summary: 'Israel inflation cooled in 2024 while the central bank held rates steady.',
        caption: 'Previous caption text'
      },
      'regenerate-caption'
    );

    expect(caption).toContain('Israel inflation cooled in 2024 while the central bank held rates steady');
    expect(caption).not.toContain('Previous caption text');
    expect(caption).not.toContain('In this moment:');
  });

  it('regenerate-image builds a beat-preserving prompt anchored to story facts', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const imagePrompt = sw.buildBeatPreservingImagePrompt(
      {
        beat_summary: 'The parliament approved the budget after a late-night vote.',
        facts_used: {
          entities: ['Parliament'],
          dates: ['2026'],
          numbers: ['61']
        }
      },
      0
    );

    expect(imagePrompt).toContain('Comic panel illustration of: The parliament approved the budget after a late-night vote.');
    expect(imagePrompt).toContain('Keep these facts visible: Parliament, 2026, 61');
    expect(imagePrompt).toContain('Preserve the same scene meaning and event context');
  });

  it('regenerate-image reuses original panel prompt and original provider/model', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const panel = {
      caption: 'Updated caption should not change the original image prompt',
      image_prompt: 'CHANGED PROMPT',
      original_image_prompt: 'ORIGINAL IMAGE PROMPT',
      artifacts: {
        provider_metadata: {
          provider_id: 'openai',
          model: 'dall-e-3'
        }
      }
    };
    const job = {
      id: 'job-regen-image-original',
      settings: {
        provider_image: 'gemini-free',
        image_model: 'gemini-2.0-flash-preview-image-generation'
      },
      storyboard: {
        panels: [panel]
      },
      sourceUrl: 'https://example.com/story'
    };

    sw.resolvePanelEditTarget = vi.fn(async () => ({
      kind: 'currentJob',
      job
    }));
    sw.saveJob = vi.fn();
    sw.notifyProgress = vi.fn();
    sw.addCompletedJobToHistory = vi.fn(() => Promise.resolve());
    sw.generateImageWithRefusalHandling = vi.fn(async (_provider, panelArg, _index, _count, jobArg) => {
      expect(panelArg.image_prompt).toBe('ORIGINAL IMAGE PROMPT');
      expect(jobArg.settings.provider_image).toBe('openai');
      expect(jobArg.settings.image_model).toBe('dall-e-3');
      return {
        imageData: 'data:image/png;base64,NEW',
        providerMetadata: {
          provider_id: 'openai',
          model: 'dall-e-3'
        }
      };
    });

    const result = await sw.handleEditPanel({
      payload: {
        panelIndex: 0,
        action: 'regenerate-image',
        comicId: 'job-regen-image-original'
      }
    });

    expect(result?.job?.storyboard?.panels?.[0]?.image_prompt).toBe('ORIGINAL IMAGE PROMPT');
    expect(result?.job?.storyboard?.panels?.[0]?.original_image_prompt).toBe('ORIGINAL IMAGE PROMPT');
    expect(sw.generateImageWithRefusalHandling).toHaveBeenCalledTimes(1);
  });

  it('make-factual rewrites caption with explicit evidence markers', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const caption = sw.transformPanelCaption(
      {
        beat_summary: 'The parliament approved the budget after a late-night vote.',
        facts_used: {
          entities: ['Parliament'],
          dates: ['2026'],
          numbers: ['61']
        }
      },
      'make-factual'
    );

    expect(caption).toContain('The parliament approved the budget after a late-night vote.');
    expect(caption).toContain('Fact focus:');
    expect(caption).toContain('entity: Parliament');
    expect(caption).toContain('date: 2026');
    expect(caption).toContain('number: 61');
  });

  it('sanitizes image prompt labels/panel markers and enforces no-text guardrail before provider call', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const fakeProvider = {
      generateImage: vi.fn(async () => ({
        imageData: 'data:image/png;base64,AAA',
        providerMetadata: { provider_id: 'fake' }
      }))
    };

    const panel = {
      panel_id: 'panel_7',
      caption: 'Panel 7: Context: The policy update reshaped rate expectations.',
      beat_summary: 'Mechanism: Investors repriced forecasts after the guidance.',
      image_prompt: [
        'Comic panel 7/8.',
        'Caption: Panel 7: Context: The policy update reshaped rate expectations.',
        'Summary: Mechanism: Investors repriced forecasts after the guidance.',
        'Style: editorial'
      ].join('\n')
    };

    const job = {
      sourceTitle: 'Test Source',
      sourceUrl: 'https://example.com/story',
      settings: {
        provider_image: 'gemini-free',
        image_refusal_handling: 'rewrite_and_retry',
        output_language: 'en'
      }
    };

    const result = await sw.generateImageWithRefusalHandling(
      fakeProvider,
      panel,
      6,
      8,
      job,
      null
    );

    expect(fakeProvider.generateImage).toHaveBeenCalledTimes(1);
    const promptSent = String(fakeProvider.generateImage.mock.calls[0][0] || '');
    expect(promptSent).not.toMatch(/comic\s*panel\s*7\s*\/\s*8/i);
    expect(promptSent).not.toMatch(/\bcaption\s*:/i);
    expect(promptSent).not.toMatch(/\bsummary\s*:/i);
    expect(promptSent).toMatch(/do not render any text/i);
    expect(promptSent).toMatch(/never render the full caption text/i);
    expect(promptSent).toMatch(/render exactly one panel scene/i);
    expect(result?.imageData).toContain('data:image/png;base64,AAA');
  });

  it('derives stable storyboard title/description heuristically when LLM metadata is unavailable', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const storyboard = {
      title: 'Austin mass shooting death toll | Epstein deposition videos / Total lunar eclipse',
      panels: [
        { beat_summary: 'Israel inflation cooled to 3.2% in 2024 while the Bank of Israel held rates steady.' },
        { beat_summary: 'Officials said the policy path remains data-dependent into 2026.' }
      ]
    };

    const meta = await sw.generateStableStoryboardMeta(
      {
        sourceTitle: 'Austin mass shooting death toll | Epstein deposition videos',
        extractedText: 'Israel inflation cooled to 3.2% in 2024 while the Bank of Israel held rates steady.'
      },
      storyboard,
      { provider_text: 'openai' }
    );

    expect(meta && typeof meta).toBe('object');
    expect(String(meta.title || '')).toContain('Israel inflation cooled to 3.2% in 2024');
    expect(String(meta.title || '')).not.toContain('|');
    expect(String(meta.shortTitle || '').length).toBeGreaterThan(0);
    expect(String(meta.shortTitle || '').length).toBeLessThanOrEqual(52);
    expect(String(meta.description || '').length).toBeGreaterThan(20);
  });

  it('prefers beat-specific snippet over generic sentence when caption phrasing is generic', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const facts = sw.extractPanelFacts(
      {
        caption: 'In this moment: this story develops.',
        beat_summary: 'Israel inflation reached 3.2% in 2024 according to the Bank of Israel.'
      },
      [
        'This story develops as reactions continue across markets.',
        'Israel inflation reached 3.2% in 2024 according to the Bank of Israel in Jerusalem.'
      ].join(' ')
    );

    expect(String(facts.source_snippet || '')).toContain('Israel inflation reached 3.2% in 2024');
    const entitiesText = (facts.entities || []).join(' ');
    expect(entitiesText).toContain('Israel');
    expect(entitiesText).toContain('Bank');
  });

  it('filters noisy wire/news entities that are not tied to the beat', async () => {
    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const facts = sw.extractPanelFacts(
      {
        beat_summary: 'Apple reported revenue growth in 2025 and iPhone sales increased.'
      },
      [
        'Breaking Update Reuters Live: Apple reported revenue growth in 2025 and iPhone sales increased.',
        'Analysts said the report reflects stronger demand.'
      ].join(' ')
    );

    const entities = Array.isArray(facts.entities) ? facts.entities.join(' ') : '';
    expect(entities).toContain('Apple');
    expect(entities).not.toMatch(/Reuters|Breaking|Update|Live/);
  });

  it('connects Google Drive via OAuth code flow and stores refresh token', async () => {
    let googleDriveAuth = null;
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'settings') return { settings: { googleDriveAutoSave: true } };
      if (key === 'oauthClientConfig') {
        return { oauthClientConfig: { googleDriveClientId: 'test-google-client-id.apps.googleusercontent.com' } };
      }
      if (key === 'googleDriveAuth') return { googleDriveAuth };
      if (key === 'history') return { history: [] };
      if (key === 'promptTemplates') return { promptTemplates: {} };
      if (key === 'apiKeys') return { apiKeys: {} };
      return {};
    });
    chrome.storage.local.set.mockImplementation(async (payload) => {
      if (payload && payload.googleDriveAuth) {
        googleDriveAuth = payload.googleDriveAuth;
      }
    });

    chrome.identity = {
      getRedirectURL: vi.fn((path) => `https://test-extension.chromiumapp.org/${path || ''}`),
      launchWebAuthFlow: vi.fn((details, callback) => {
        const authUrl = String(details?.url || '');
        const stateMatch = authUrl.match(/[?&]state=([^&]+)/i);
        const state = stateMatch ? decodeURIComponent(stateMatch[1]) : '';
        callback(`https://test-extension.chromiumapp.org/google-oauth2?code=test-auth-code&state=${encodeURIComponent(state)}`);
      })
    };

    global.fetch.mockImplementation(async (url) => {
      const requestUrl = String(url || '');
      if (requestUrl.includes('shared/oauth-client-config.local.json')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (requestUrl.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'drive-access-token',
            refresh_token: 'drive-refresh-token',
            expires_in: 3600
          })
        };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });

    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const result = await sw.handleGoogleDriveConnect({ payload: {} });
    expect(result?.status?.connected).toBe(true);

    const savedAuthCall = chrome.storage.local.set.mock.calls.find((call) => call[0] && call[0].googleDriveAuth);
    expect(savedAuthCall).toBeTruthy();
    expect(savedAuthCall[0].googleDriveAuth.accessToken).toBe('drive-access-token');
    expect(savedAuthCall[0].googleDriveAuth.refreshToken).toBe('drive-refresh-token');
    expect(savedAuthCall[0].googleDriveAuth.clientId).toBe('test-google-client-id.apps.googleusercontent.com');
  });

  it('refreshes expired Google Drive token before upload and saves into MyComics folder', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'settings') return { settings: { googleDriveAutoSave: true } };
      if (key === 'oauthClientConfig') {
        return { oauthClientConfig: { googleDriveClientId: 'test-google-client-id.apps.googleusercontent.com' } };
      }
      if (key === 'googleDriveAuth') {
        return {
          googleDriveAuth: {
            accessToken: 'expired-token',
            refreshToken: 'refresh-me',
            expiresAt: Date.now() - 60_000,
            clientId: 'test-google-client-id.apps.googleusercontent.com'
          }
        };
      }
      return {};
    });

    global.fetch.mockImplementation(async (url) => {
      const requestUrl = String(url || '');
      if (requestUrl.includes('shared/oauth-client-config.local.json')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (requestUrl.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'fresh-drive-token',
            expires_in: 3600
          })
        };
      }
      if (requestUrl.includes('/upload/drive/v3/files?uploadType=multipart')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'file-1', name: 'comic.html', webViewLink: 'https://drive.google.com/file-1' })
        };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });

    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();
    sw.ensureGoogleDriveFolder = vi.fn().mockResolvedValue('folder-123');

    const result = await sw.uploadStoryboardToGoogleDrive({
      storyboard: {
        title: 'Story title',
        source: { url: 'https://example.com/story', title: 'Story' },
        panels: [{ caption: 'Panel A', artifacts: { image_blob_ref: 'data:image/png;base64,AAA' } }]
      }
    }, { force: false });

    expect(result?.skipped).toBe(false);
    expect(sw.ensureGoogleDriveFolder).toHaveBeenCalledWith('fresh-drive-token', 'MyComics');

    const uploadCall = global.fetch.mock.calls.find((call) =>
      String(call?.[0] || '').includes('/upload/drive/v3/files?uploadType=multipart')
    );
    expect(uploadCall).toBeTruthy();
    expect(String(uploadCall[1]?.headers?.Authorization || '')).toBe('Bearer fresh-drive-token');

    const refreshedAuthSave = chrome.storage.local.set.mock.calls.find((call) => {
      const auth = call[0]?.googleDriveAuth;
      return auth && auth.accessToken === 'fresh-drive-token';
    });
    expect(refreshedAuthSave).toBeTruthy();
  });

  it('connects Facebook and stores manageable pages for posting', async () => {
    let facebookAuth = null;
    let launchUrl = '';
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'settings') return { settings: {} };
      if (key === 'oauthClientConfig') return { oauthClientConfig: { facebookAppId: 'fb-app-id-123' } };
      if (key === 'facebookAuth') return { facebookAuth };
      return {};
    });
    chrome.storage.local.set.mockImplementation(async (payload) => {
      if (payload && payload.facebookAuth) facebookAuth = payload.facebookAuth;
    });

    chrome.identity = {
      getRedirectURL: vi.fn(() => 'https://test-extension.chromiumapp.org/facebook-oauth2'),
      launchWebAuthFlow: vi.fn((details, callback) => {
        launchUrl = String(details?.url || '');
        const stateMatch = launchUrl.match(/[?&]state=([^&]+)/i);
        const state = stateMatch ? decodeURIComponent(stateMatch[1]) : '';
        callback(`https://test-extension.chromiumapp.org/facebook-oauth2?code=fb-code-123&state=${encodeURIComponent(state || '')}`);
      })
    };

    global.fetch.mockImplementation(async (url, init) => {
      const requestUrl = String(url || '');
      if (requestUrl.includes('/oauth/access_token')) {
        const body = String(init?.body || '');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: body.includes('code=fb-code-123') ? 'fb-user-token' : '',
            expires_in: 3600
          })
        };
      }
      if (requestUrl.includes('/me/accounts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 'page-1', name: 'Web2Comics Page', access_token: 'page-token-1', perms: ['CREATE_CONTENT'] }
            ]
          })
        };
      }
      if (requestUrl.includes('shared/oauth-client-config.local.json')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });

    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const response = await sw.handleFacebookConnect({ payload: {} });
    expect(response?.status?.connected).toBe(true);
    expect(response?.status?.hasPageAccess).toBe(true);
    expect(response?.status?.pageCount).toBe(1);
    expect(launchUrl).toContain('response_type=code');
    expect(launchUrl).toContain('code_challenge=');
    expect(launchUrl).toContain('code_challenge_method=S256');
    expect(facebookAuth).toBeTruthy();
    expect(Array.isArray(facebookAuth.pages)).toBe(true);
    expect(facebookAuth.pages[0].id).toBe('page-1');
    expect(facebookAuth.selectedPageId).toBe('page-1');
  });

  it('publishes to selected Facebook page feed via Graph API', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'facebookAuth') {
        return {
          facebookAuth: {
            accessToken: 'fb-user-token',
            expiresAt: Date.now() + 3600_000,
            selectedPageId: 'page-1',
            pages: [
              { id: 'page-1', name: 'Web2Comics Page', accessToken: 'page-token-1', perms: ['CREATE_CONTENT'] }
            ]
          }
        };
      }
      if (key === 'settings') return { settings: {} };
      if (key === 'oauthClientConfig') return { oauthClientConfig: { facebookAppId: 'fb-app-id-123' } };
      return {};
    });

    global.fetch.mockImplementation(async (url, init) => {
      const requestUrl = String(url || '');
      if (requestUrl.includes('/page-1/feed')) {
        const body = String(init?.body || '');
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: body.includes('link=') ? 'page-1_post-123' : 'page-1_post-plain' })
        };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });

    await import('../../background/service-worker.js');
    const hook = globalThis.__WEB2COMICS_E2E__;
    const sw = hook.getServiceWorker();

    const response = await sw.handleFacebookPostPage({
      payload: {
        message: 'Shared via Web2Comics',
        link: 'https://example.com/story'
      }
    });

    expect(response?.pageId).toBe('page-1');
    expect(String(response?.postId || '')).toContain('page-1_post');
  });
});
