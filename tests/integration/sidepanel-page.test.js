import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const sidepanelHtmlPath = path.resolve(__dirname, '../../sidepanel/sidepanel.html');

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeHistoryItem(index) {
  return {
    id: `history-${index}`,
    generated_at: new Date(Date.UTC(2026, 1, index + 1)).toISOString(),
    thumbnail:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII=',
    source: {
      url: `https://www.cnn.com/${index}`,
      title: `CNN Story ${index}`
    },
    storyboard: {
      source: {
        url: `https://www.cnn.com/${index}`,
        title: `CNN Story ${index}`
      },
      panels: [
        {
          caption: `Panel ${index} caption`,
          artifacts: {
            image_blob_ref:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII='
          }
        }
      ]
    }
  };
}

function formatLikeViewerDateTime(value) {
  return new Date(value).toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

describe('Sidepanel Page UX', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.innerHTML = fs.readFileSync(sidepanelHtmlPath, 'utf8');

    global.alert = vi.fn();
    global.confirm = vi.fn(() => true);
    chrome.storage.onChanged = chrome.storage.onChanged || {};
    chrome.storage.onChanged.addListener = vi.fn();

    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [] };
      return {};
    });
    chrome.storage.local.set.mockResolvedValue(undefined);
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });
    chrome.action.openPopup.mockResolvedValue?.(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
  });

  it('supports keyboard navigation between Comic View and History Browser tabs', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [makeHistoryItem(1)] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const tablist = document.querySelector('.header-mode-toggle');
    const comicBtn = document.getElementById('mode-comic-btn');
    const historyBtn = document.getElementById('mode-history-btn');
    const comicShell = document.getElementById('comic-view-shell');
    const historyShell = document.getElementById('history-browser-view');
    const sidebar = document.getElementById('sidebar');
    const headerHelp = document.querySelector('.viewer-header .help-link-icon');

    expect(comicBtn.getAttribute('aria-selected')).toBe('true');
    expect(historyBtn.getAttribute('aria-selected')).toBe('false');
    expect(headerHelp).toBeTruthy();
    expect(headerHelp.getAttribute('href')).toContain('../docs/user-manual.html#sidepanel-overview');

    comicBtn.focus();
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(historyBtn);

    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    expect(historyBtn.getAttribute('aria-selected')).toBe('true');
    expect(comicBtn.getAttribute('aria-selected')).toBe('false');
    expect(historyShell.classList.contains('hidden')).toBe(false);
    expect(comicShell.classList.contains('hidden')).toBe(true);
    expect(sidebar.classList.contains('hidden')).toBe(true);
  });

  it('opens in My Collection view when URL requests view=history', async () => {
    window.history.replaceState({}, '', '?view=history');
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [makeHistoryItem(1)] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const comicBtn = document.getElementById('mode-comic-btn');
    const historyBtn = document.getElementById('mode-history-btn');
    const comicShell = document.getElementById('comic-view-shell');
    const historyShell = document.getElementById('history-browser-view');

    expect(historyBtn.getAttribute('aria-selected')).toBe('true');
    expect(comicBtn.getAttribute('aria-selected')).toBe('false');
    expect(historyShell.classList.contains('hidden')).toBe(false);
    expect(comicShell.classList.contains('hidden')).toBe(true);

    window.history.replaceState({}, '', '/');
  });

  it('renders History Browser in chunks and loads more items on demand', async () => {
    const history = Array.from({ length: 15 }, (_, i) => makeHistoryItem(i + 1));
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();

    const grid = document.getElementById('history-browser-grid');
    const actions = document.getElementById('history-browser-actions');
    const moreBtn = document.getElementById('history-browser-more-btn');

    expect(grid.querySelectorAll('.history-item').length).toBe(12);
    expect(actions.classList.contains('hidden')).toBe(false);
    expect(moreBtn.textContent).toContain('3 remaining');

    moreBtn.click();
    await flush();

    expect(grid.querySelectorAll('.history-item').length).toBe(15);
    expect(actions.classList.contains('hidden')).toBe(true);
  });

  it('rehydrates distinct archived panel images even when panel_id values are duplicated', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });
    chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg?.type === 'GET_ARCHIVED_PANEL_IMAGES') {
        return {
          images: {
            'comic-dup::panel_1': 'data:image/png;base64,AAA111',
            'comic-dup::panel_2': 'data:image/png;base64,BBB222'
          }
        };
      }
      return { success: true };
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const viewer = window.__sidepanelViewer;
    const storyboard = {
      panels: [
        { panel_id: 'panel_1', artifacts: {} },
        { panel_id: 'panel_1', artifacts: {} }
      ]
    };
    const hydrated = await viewer.hydrateStoryboardImagesFromArchive(storyboard, 'comic-dup');
    const first = String(hydrated?.panels?.[0]?.artifacts?.image_blob_ref || '');
    const second = String(hydrated?.panels?.[1]?.artifacts?.image_blob_ref || '');

    expect(first).toContain('AAA111');
    expect(second).toContain('BBB222');
    expect(first).not.toBe(second);
  });

  it('prefers index archive keys over stale explicit image_archive_key values', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });
    chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg?.type === 'GET_ARCHIVED_PANEL_IMAGES') {
        return {
          images: {
            'comic-stale::panel_1': 'data:image/png;base64,IDX1',
            'comic-stale::panel_2': 'data:image/png;base64,IDX2',
            stale_shared_key: 'data:image/png;base64,STALE'
          }
        };
      }
      return { success: true };
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const viewer = window.__sidepanelViewer;
    const storyboard = {
      panels: [
        { panel_id: 'panel_1', artifacts: { image_archive_key: 'stale_shared_key' } },
        { panel_id: 'panel_2', artifacts: { image_archive_key: 'stale_shared_key' } }
      ]
    };
    const hydrated = await viewer.hydrateStoryboardImagesFromArchive(storyboard, 'comic-stale');
    const first = String(hydrated?.panels?.[0]?.artifacts?.image_blob_ref || '');
    const second = String(hydrated?.panels?.[1]?.artifacts?.image_blob_ref || '');
    const firstKey = String(hydrated?.panels?.[0]?.artifacts?.image_archive_key || '');
    const secondKey = String(hydrated?.panels?.[1]?.artifacts?.image_archive_key || '');

    expect(first).toContain('IDX1');
    expect(second).toContain('IDX2');
    expect(first).not.toContain('STALE');
    expect(second).not.toContain('STALE');
    expect(firstKey).toBe('comic-stale::panel_1');
    expect(secondKey).toBe('comic-stale::panel_2');
  });

  it('prefers panel-id archive keys over stale explicit keys when index keys are missing', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });
    chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg?.type === 'GET_ARCHIVED_PANEL_IMAGES') {
        return {
          images: {
            // No index keys available on purpose.
            'comic-id-fallback::custom_a': 'data:image/png;base64,IDA',
            'comic-id-fallback::custom_b': 'data:image/png;base64,IDB',
            stale_shared_key: 'data:image/png;base64,STALE'
          }
        };
      }
      return { success: true };
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const viewer = window.__sidepanelViewer;
    const storyboard = {
      panels: [
        { panel_id: 'custom_a', artifacts: { image_archive_key: 'stale_shared_key' } },
        { panel_id: 'custom_b', artifacts: { image_archive_key: 'stale_shared_key' } }
      ]
    };
    const hydrated = await viewer.hydrateStoryboardImagesFromArchive(storyboard, 'comic-id-fallback');
    const first = String(hydrated?.panels?.[0]?.artifacts?.image_blob_ref || '');
    const second = String(hydrated?.panels?.[1]?.artifacts?.image_blob_ref || '');
    const firstKey = String(hydrated?.panels?.[0]?.artifacts?.image_archive_key || '');
    const secondKey = String(hydrated?.panels?.[1]?.artifacts?.image_archive_key || '');

    expect(first).toContain('IDA');
    expect(second).toContain('IDB');
    expect(first).not.toContain('STALE');
    expect(second).not.toContain('STALE');
    expect(firstKey).toBe('comic-id-fallback::custom_a');
    expect(secondKey).toBe('comic-id-fallback::custom_b');
  });

  it('does not clone single history thumbnail across all panels for multi-panel comics', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const viewer = window.__sidepanelViewer;
    const item = {
      id: 'comic-x',
      thumbnail: 'data:image/png;base64,THUMBONLY',
      storyboard: {
        source: { url: 'https://example.com', title: 'Example' },
        panels: [{ artifacts: {} }, { artifacts: {} }, { artifacts: {} }]
      }
    };
    const prepared = viewer.prepareHistoryStoryboardForDisplay(item);
    const panelSources = (prepared?.panels || []).map((p) => viewer.getPanelImageSource(p));

    expect(panelSources.filter(Boolean).length).toBe(0);
  });

  it('filters My Collection to favorites only when favorites toggle is enabled', async () => {
    const a = makeHistoryItem(1);
    const b = makeHistoryItem(2);
    const c = makeHistoryItem(3);
    a.favorite = true;
    b.favorite = false;
    c.favorite = true;
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [a, b, c] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();

    const before = document.querySelectorAll('#history-browser-grid .history-item');
    expect(before.length).toBe(3);

    document.getElementById('history-filter-favorites-btn').click();
    await flush();

    const after = document.querySelectorAll('#history-browser-grid .history-item');
    expect(after.length).toBe(2);
    const btn = document.getElementById('history-filter-favorites-btn');
    expect(btn.classList.contains('is-active')).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('sorts My Collection by title and toggles between A-Z and Z-A', async () => {
    const a = makeHistoryItem(1);
    const b = makeHistoryItem(2);
    const c = makeHistoryItem(3);
    a.source.title = 'Zulu Update';
    b.source.title = 'Alpha Brief';
    c.source.title = 'Bravo Story';
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [a, b, c] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();

    const sortTitleBtn = document.getElementById('history-sort-title-btn');
    sortTitleBtn.click(); // A-Z
    await flush();

    const firstAsc = String(document.querySelector('#history-browser-grid .history-title')?.textContent || '');
    expect(firstAsc).toContain('Alpha Brief');

    sortTitleBtn.click(); // Z-A
    await flush();

    const firstDesc = String(document.querySelector('#history-browser-grid .history-title')?.textContent || '');
    expect(firstDesc).toContain('Zulu Update');
  });

  it('renders history thumbnail fallback from storyboard panel image when thumbnail is missing', async () => {
    const item = makeHistoryItem(1);
    delete item.thumbnail;
    item.storyboard.panels[0].artifacts.image_blob_ref =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII=';
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();

    const thumb = document.querySelector('#history-browser-grid .history-thumb img');
    expect(thumb).toBeTruthy();
    expect(String(thumb.getAttribute('src') || '')).toContain('data:image/png;base64');
  });

  it('renders history thumbnail using the first available panel image', async () => {
    const item = makeHistoryItem(1);
    item.thumbnail = '';
    item.storyboard.panels = [
      { artifacts: { image_blob_ref: 'data:image/png;base64,AAA1' } },
      { artifacts: { image_blob_ref: 'data:image/png;base64,AAA2' } },
      { artifacts: { image_blob_ref: 'data:image/png;base64,AAA3' } },
      { artifacts: { image_blob_ref: 'data:image/png;base64,AAA4' } }
    ];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();

    const thumb = document.querySelector('#history-browser-grid .history-thumb img');
    expect(thumb).toBeTruthy();
    expect(String(thumb.getAttribute('src') || '')).toContain('data:image/png;base64,AAA1');
  });

  it('uses persisted historyThumbnails map to keep preview visible when panel images are compacted', async () => {
    const item = makeHistoryItem(1);
    item.thumbnail = '';
    item.storyboard.panels = [
      { caption: 'Compacted panel', artifacts: { image_omitted_due_to_quota: true } }
    ];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (Array.isArray(key)) {
        return {
          history: [item],
          historyThumbnails: { 'history-1': 'data:image/jpeg;base64,TINY_PREVIEW_1' }
        };
      }
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();

    const thumb = document.querySelector('#history-browser-grid .history-thumb img');
    expect(thumb).toBeTruthy();
    expect(String(thumb.getAttribute('src') || '')).toContain('data:image/jpeg;base64,TINY_PREVIEW_1');
  });

  it('renders history thumbnail fallback from panel image_url when image_blob_ref is missing', async () => {
    const item = makeHistoryItem(1);
    item.thumbnail = '';
    item.storyboard.panels = [
      { artifacts: { image_url: 'data:image/png;base64,URL1' } },
      { image_url: 'data:image/png;base64,URL2' }
    ];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();

    const thumb = document.querySelector('#history-browser-grid .history-thumb img');
    expect(thumb).toBeTruthy();
    expect(String(thumb.getAttribute('src') || '')).toContain('data:image/png;base64,URL1');
  });

  it('renders history thumbnail when image_url is stored as an object shape', async () => {
    const item = makeHistoryItem(1);
    item.thumbnail = '';
    item.storyboard.panels = [
      { artifacts: { image_url: { url: 'data:image/png;base64,OBJECT_URL_1' } } }
    ];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();

    const thumb = document.querySelector('#history-browser-grid .history-thumb img');
    expect(thumb).toBeTruthy();
    expect(String(thumb.getAttribute('src') || '')).toContain('data:image/png;base64,OBJECT_URL_1');
  });

  it('hydrates and persists missing history thumbnail from panel image source', async () => {
    const item = makeHistoryItem(1);
    item.thumbnail = '';
    item.storyboard.panels = [
      { artifacts: { image_url: { url: 'data:image/png;base64,HYDRATE_URL_1' } } }
    ];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();
    document.getElementById('mode-history-btn').click();
    await flush();

    expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      history: expect.any(Array)
    }));
    const persistedCall = chrome.storage.local.set.mock.calls.find((args) =>
      args && args[0] && Array.isArray(args[0].history)
    );
    expect(persistedCall).toBeTruthy();
    const persistedItem = persistedCall[0].history[0];
    expect(String(persistedItem.thumbnail || '')).toContain('data:image/png;base64,HYDRATE_URL_1');

    const thumb = document.querySelector('#history-browser-grid .history-thumb img');
    expect(thumb).toBeTruthy();
    expect(String(thumb.getAttribute('src') || '')).toContain('data:image/png;base64,HYDRATE_URL_1');
  });

  it('shows panel image when opening a history card that stores image_url only', async () => {
    const item = makeHistoryItem(1);
    item.thumbnail = '';
    item.storyboard.panels = [
      {
        caption: 'Image URL only panel',
        artifacts: {
          image_url: 'data:image/png;base64,URL_PANEL_ONLY'
        }
      }
    ];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();
    document.querySelector('#history-browser-grid .history-item').click();
    await flush();
    await flush();

    const panelImage = document.querySelector('#comic-strip .panel .panel-image img');
    expect(panelImage).toBeTruthy();
    expect(String(panelImage.getAttribute('src') || '')).toContain('data:image/png;base64,URL_PANEL_ONLY');
  });

  it('falls back to history thumbnail when opening a card whose panels have no image refs', async () => {
    const item = makeHistoryItem(1);
    item.thumbnail = 'data:image/png;base64,HISTORY_THUMB_ONLY';
    item.storyboard.panels = [
      {
        caption: 'Panel missing image refs',
        artifacts: {}
      }
    ];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();
    document.querySelector('#history-browser-grid .history-item').click();
    await flush();
    await flush();

    const panelImage = document.querySelector('#comic-strip .panel .panel-image img');
    expect(panelImage).toBeTruthy();
    expect(String(panelImage.getAttribute('src') || '')).toContain('data:image/png;base64,HISTORY_THUMB_ONLY');
  });

  it('rehydrates full panel image from archive when history panel image refs were compacted', async () => {
    const item = makeHistoryItem(1);
    item.thumbnail = 'data:image/jpeg;base64,TINY_PREVIEW_ONLY';
    item.storyboard.panels = [
      {
        panel_id: 'panel_1',
        caption: 'Archived panel image',
        artifacts: {
          image_omitted_due_to_quota: true,
          image_archive_key: 'history-1::panel_1'
        }
      }
    ];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [item] };
      return {};
    });
    chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg?.type === 'GET_ARCHIVED_PANEL_IMAGES') {
        return {
          success: true,
          images: {
            'history-1::panel_1': 'data:image/png;base64,ARCHIVE_PANEL_1'
          }
        };
      }
      return { success: true };
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();
    document.querySelector('#history-browser-grid .history-item').click();
    await flush();
    await flush();

    const archiveCall = chrome.runtime.sendMessage.mock.calls.find((args) => args?.[0]?.type === 'GET_ARCHIVED_PANEL_IMAGES');
    expect(archiveCall).toBeTruthy();
    const panelImage = document.querySelector('#comic-strip .panel .panel-image img');
    expect(panelImage).toBeTruthy();
    expect(String(panelImage.getAttribute('src') || '')).toContain('data:image/png;base64,ARCHIVE_PANEL_1');
  });

  it('renders a fallback preview image when no history thumbnail images are available', async () => {
    const item = makeHistoryItem(1);
    item.thumbnail = '';
    item.storyboard.panels = [{ caption: 'Only text panel', artifacts: {} }];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const viewer = window.__sidepanelViewer;
    vi.spyOn(viewer, 'getHistoryFallbackPreviewImage').mockReturnValue('data:image/png;base64,FALLBACK_PREVIEW');

    document.getElementById('mode-history-btn').click();
    await flush();
    viewer.renderHistoryBrowser();
    await flush();

    const thumb = document.querySelector('#history-browser-grid .history-thumb img');
    expect(thumb).toBeTruthy();
    expect(String(thumb.getAttribute('src') || '')).toContain('data:image/png;base64,FALLBACK_PREVIEW');
  });

  it('renders history title and source link from sourceTitle/sourceUrl fallback fields', async () => {
    const item = makeHistoryItem(1);
    delete item.source;
    item.sourceTitle = 'CNN Fallback Source Title';
    item.sourceUrl = 'https://www.cnn.com/fallback';
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const titleEl = document.querySelector('#history-list .history-title');
    const originalLink = document.querySelector('#history-list .history-source-link');
    expect(String(titleEl?.textContent || '')).toContain('CNN Fallback Source Title');
    expect(originalLink).toBeTruthy();
    expect(String(originalLink?.getAttribute('href') || '').toLowerCase()).not.toContain('javascript:');
  });

  it('renders Source label and human-readable date time in history cards', async () => {
    const item = makeHistoryItem(1);
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();

    const link = document.querySelector('#history-browser-grid .history-source-link');
    const dateEl = document.querySelector('#history-browser-grid .history-date');
    expect(String(link?.textContent || '').trim()).toBe('Source');
    expect(String(dateEl?.textContent || '').trim()).toBe(formatLikeViewerDateTime(item.generated_at));
  });

  it('opens a history card with keyboard and returns to Comic View', async () => {
    const history = [makeHistoryItem(1), makeHistoryItem(2)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();

    const firstCard = document.querySelector('#history-browser-grid .history-item');
    firstCard.focus();
    firstCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    await flush();

    expect(document.getElementById('mode-comic-btn').getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('history-browser-view').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('comic-display').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('comic-title').textContent).toContain('CNN Story');
    expect(document.querySelectorAll('#comic-strip .panel').length).toBeGreaterThan(0);
  });

  it('applies and persists a layout preset selection', async () => {
    let persistedPrefs;
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });
    chrome.storage.local.set.mockImplementation(async (payload) => {
      if (payload.sidepanelPrefs) persistedPrefs = payload.sidepanelPrefs;
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const select = document.getElementById('layout-preset-select');
    const comicDisplay = document.getElementById('comic-display');
    const strip = document.getElementById('comic-strip');
    const carousel = document.getElementById('comic-carousel');

    document.getElementById('mode-history-btn').click();
    await flush();
    document.querySelector('#history-browser-grid .history-item').click();
    await flush();
    await flush();

    select.value = 'carousel';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    await flush();

    expect(comicDisplay.classList.contains('preset-cinema-carousel')).toBe(true);
    expect(comicDisplay.classList.contains('mode-carousel')).toBe(true);
    expect(carousel.classList.contains('hidden')).toBe(false);
    expect(strip.classList.contains('hidden')).toBe(true);
    expect(persistedPrefs.layoutPreset).toBe('carousel');
  });

  it('prefers generated storyboard title for comic title', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.title = 'Israel: Key Timeline in 3 Panels';
    item.storyboard.description = 'Inflation cooled in 2024 while policymakers held rates steady and signaled caution.';
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    expect(document.getElementById('comic-title').textContent).toBe('Israel: Key Timeline in 3 Panels');
    expect(document.getElementById('comic-description').textContent).toContain('Inflation cooled in 2024');
    expect(document.getElementById('comic-description').classList.contains('hidden')).toBe(false);
  });

  it('avoids noisy multi-headline source title mashups in comic title', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.title = '';
    item.storyboard.source.title =
      'Austin mass shooting death toll Epstein deposition videos Total lunar eclipse to turn the moon red Global breast cancer cases Why Jim Carrey face is up for de';
    item.storyboard.panels = [
      {
        caption: 'Austin shooting investigation advances as officials release updated details.',
        artifacts: { image_blob_ref: 'data:image/png;base64,AAA' }
      }
    ];

    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const titleText = String(document.getElementById('comic-title').textContent || '');
    expect(titleText).not.toContain('Epstein deposition videos');
    expect(titleText).toContain('Austin shooting investigation advances');
  });

  it('uses a story short title in My Collection cards instead of generic Web2Comics label', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.title = 'Web2Comics';
    item.storyboard.collection_title_short = '';
    item.source.title = 'Web2Comics';
    item.storyboard.source.title = 'Web2Comics';
    item.storyboard.panels = [
      {
        caption: 'Israel inflation cools as the central bank holds rates steady.',
        artifacts: { image_blob_ref: 'data:image/png;base64,AAA' }
      }
    ];

    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();
    const historyTitle = document.querySelector('#history-browser-grid .history-title');
    expect(historyTitle).toBeTruthy();
    expect(String(historyTitle.textContent || '')).not.toBe('Web2Comics');
    expect(String(historyTitle.textContent || '')).toContain('Israel inflation cools');
  });

  it('shows page favicon next to source link when source URL is available', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.source.url = 'https://www.cnn.com/world';
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history: [item] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const viewer = window.__sidepanelViewer;
    expect(viewer).toBeTruthy();
    expect(viewer.getFaviconUrl('https://www.cnn.com/world')).toBe('https://www.cnn.com/favicon.ico');
    viewer.updateComicSourceFavicon('https://www.cnn.com/world');

    const favicon = document.getElementById('comic-source-favicon');
    expect(favicon).toBeTruthy();
  });

  it('downloads debug logs from sidepanel header icon', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [] };
      if (key === 'debugLogs') return { debugLogs: [{ event: 'viewer.open' }] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('download-logs-sidepanel-btn').click();
    await flush();

    expect(createObjectURL).toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalled();
  });

  it('asks for confirmation before deleting a history item and only deletes on confirm', async () => {
    let history = [makeHistoryItem(1), makeHistoryItem(2)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });
    chrome.storage.local.set.mockImplementation(async (payload) => {
      if (payload.history) history = payload.history;
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();

    const deleteBtn = document.querySelector('#history-browser-grid .history-item-delete-btn');
    expect(deleteBtn).toBeTruthy();

    global.confirm = vi.fn(() => false);
    deleteBtn.click();
    await flush();
    expect(global.confirm).toHaveBeenCalledWith('Delete this comic from My Collection?');
    expect(history).toHaveLength(2);

    global.confirm = vi.fn(() => true);
    deleteBtn.click();
    await flush();
    await flush();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe('history-2');
  });

  it('toggles favorite on history item via star icon and persists', async () => {
    let history = [makeHistoryItem(1), makeHistoryItem(2)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });
    chrome.storage.local.set.mockImplementation(async (payload) => {
      if (payload.history) history = payload.history;
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();

    const starBtn = document.querySelector('#history-browser-grid .history-item-favorite-btn');
    expect(starBtn).toBeTruthy();
    expect(starBtn.classList.contains('is-active')).toBe(false);

    starBtn.click();
    await flush();
    await flush();

    expect(history[0].favorite).toBe(true);
    const updatedStarBtn = document.querySelector('#history-browser-grid .history-item-favorite-btn');
    expect(updatedStarBtn.classList.contains('is-active')).toBe(true);
  });

  it('does not render share icon on My Collection cards', async () => {
    const history = [makeHistoryItem(1), makeHistoryItem(2)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();

    const shareBtn = document.querySelector('#history-browser-grid .history-item-share-btn');
    expect(shareBtn).toBeFalsy();
  });

  it('shows expanded deduplicated layout preset list', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const select = document.getElementById('layout-preset-select');
    const values = Array.from(select.options).map((o) => o.value);
    const labels = Array.from(select.options).map((o) => o.textContent.trim());

    expect(values.length).toBeGreaterThanOrEqual(26);
    expect(new Set(values).size).toBe(values.length);
    expect(labels).toContain('Single panel (Full-page)');
    expect(labels).toContain('Manga page (Right-to-left flow)');
    expect(labels).toContain('Webtoon scroll (Vertical strip)');
    expect(labels).toContain('Carousel (Swipe panels)');
    expect(labels).toContain('Guided path (Numbered / arrowed flow)');
    expect(labels).toContain('4-panel strip (Horizontal)');
    expect(labels).toContain('Square comic grid (1:1)');
    expect(labels).toContain('A4 comic page (Portrait)');
    expect(labels).toContain('A5 comic page (Portrait)');
  });

  it('restores persisted layout preset and matching view mode on load', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: { layoutPreset: 'reading-grid' } };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const select = document.getElementById('layout-preset-select');
    const comicDisplay = document.getElementById('comic-display');
    const panels = document.getElementById('comic-panels');
    const strip = document.getElementById('comic-strip');

    expect(select.value).toBe('guided-path');
    expect(comicDisplay.classList.contains('preset-reading-grid')).toBe(true);
    expect(panels.classList.contains('hidden')).toBe(false);
    expect(strip.classList.contains('hidden')).toBe(true);
  });

  it('supports Home and End keyboard navigation on primary view tabs', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [makeHistoryItem(1)] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const tablist = document.querySelector('.header-mode-toggle');
    const comicBtn = document.getElementById('mode-comic-btn');
    const historyBtn = document.getElementById('mode-history-btn');

    comicBtn.focus();
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(historyBtn);

    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(comicBtn);
  });

  it('shows elapsed/phase/ETA detail in generation view while panels are rendering', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') {
        return {
          currentJob: {
            status: 'generating_images',
            completedPanels: 1,
            currentPanelIndex: 1,
            settings: { panel_count: 3 },
            storyboard: {
              panels: [
                { caption: 'Panel 1', runtime_status: 'completed', artifacts: { image_blob_ref: 'data:image/png;base64,aaa' } },
                { caption: 'Panel 2', runtime_status: 'rendering', artifacts: {} },
                { caption: 'Panel 3', runtime_status: 'pending', artifacts: {} }
              ]
            }
          }
        };
      }
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const detail = document.getElementById('gen-status-detail');
    expect(detail).toBeTruthy();
    const text = String(detail.textContent || '');
    expect(text).toContain('Elapsed');
    expect(text).toContain('Rendering panels');
    expect(text).toContain('ETA:');
  });

  it('shows debug-only caption quality summary in generation view', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') {
        return {
          currentJob: {
            status: 'generating_images',
            completedPanels: 1,
            currentPanelIndex: 1,
            captionQuality: {
              storyLikeCaptions: 5,
              promptLikeCaptions: 1,
              promptLikeCaptionRepairs: 1
            },
            settings: { panel_count: 3, debug_flag: true },
            storyboard: {
              settings: { debug_flag: true },
              panels: [{}, {}, {}]
            }
          }
        };
      }
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const line = document.getElementById('gen-caption-quality');
    expect(line).toBeTruthy();
    expect(line.classList.contains('hidden')).toBe(false);
    expect(String(line.textContent || '')).toContain('Caption quality: 5 story-like / 1 prompt-like (repaired 1)');
  });

  it('renders generation panel caption text using fallback fields when caption is missing', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') {
        return {
          currentJob: {
            status: 'generating_images',
            completedPanels: 0,
            currentPanelIndex: 0,
            settings: { panel_count: 2 },
            storyboard: {
              panels: [
                { beat_summary: 'Fallback summary caption', runtime_status: 'rendering', artifacts: {} },
                { title: 'Alt title caption', runtime_status: 'pending', artifacts: {} }
              ]
            }
          }
        };
      }
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const captions = Array.from(document.querySelectorAll('#gen-panels .gen-panel-caption')).map((el) => el.textContent || '');
    expect(captions.join(' ')).toContain('Fallback summary caption');
    expect(captions.join(' ')).toContain('Alt title caption');
  });

  it('displays the selected history comic when selectedHistoryComicId is set', async () => {
    const history = [makeHistoryItem(1), makeHistoryItem(2)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (Array.isArray(key)) {
        return { selectedHistoryComicId: 'history-2', history };
      }
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();
    await flush();

    expect(document.getElementById('comic-title').textContent).toContain('CNN Story 2');
    expect(document.getElementById('comic-display').classList.contains('hidden')).toBe(false);
  });

  it('shows rate-limit retry countdown in sidepanel generation detail when retryState is present', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') {
        return {
          currentJob: {
            status: 'generating_images',
            completedPanels: 1,
            currentPanelIndex: 1,
            retryState: {
              type: 'rate_limit',
              provider: 'gemini-free',
              panelIndex: 1,
              delayMs: 6000,
              retryAt: new Date(Date.now() + 5000).toISOString()
            },
            settings: { panel_count: 3 },
            storyboard: { panels: [{}, {}, {}] }
          }
        };
      }
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const text = String(document.getElementById('gen-status-detail')?.textContent || '');
    expect(text).toContain('Rate limited');
    expect(text).toContain('Gemini');
    expect(text).toContain('retrying panel 2');
  });

  it('does not alert for canceled jobs and keeps generation canceled status visible', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { id: 'job-cancel', status: 'canceled', settings: { panel_count: 2 }, storyboard: { panels: [{}, {}] } } };
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    expect(global.alert).not.toHaveBeenCalledWith(expect.stringContaining('Generation was canceled.'));
    expect(String(document.getElementById('gen-status-text')?.textContent || '')).toContain('Canceled');
    expect(document.getElementById('generation-view').classList.contains('hidden')).toBe(false);
  });

  it('shows canceling status immediately when cancel is requested', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'generating_images', settings: { panel_count: 2 }, storyboard: { panels: [{}, {}] } } };
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const cancelBtn = document.getElementById('cancel-gen-btn');
    cancelBtn.click();

    expect(String(document.getElementById('gen-status-text')?.textContent || '')).toContain('Canceling');
    expect(cancelBtn.disabled).toBe(true);
  });

  it('exports a composite comic image on Download using canvas and image APIs', async () => {
    const history = [makeHistoryItem(1)];
    history[0].storyboard.description = 'Short export summary';
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    const originalCreateElement = document.createElement.bind(document);
    const anchorClicks = [];
    const fakeGradient = { addColorStop: vi.fn() };
    const fakeCtx = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      arcTo: vi.fn(),
      closePath: vi.fn(),
      fillRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      clip: vi.fn(),
      drawImage: vi.fn(),
      restore: vi.fn(),
      createLinearGradient: vi.fn(() => fakeGradient),
      measureText: vi.fn((text) => ({ width: String(text || '').length * 8 })),
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => fakeCtx),
      toDataURL: vi.fn(() => 'data:image/png;base64,ZmFrZS1wbmc=')
    };

    document.createElement = vi.fn((tagName, ...rest) => {
      if (String(tagName).toLowerCase() === 'canvas') return fakeCanvas;
      const el = originalCreateElement(tagName, ...rest);
      if (String(tagName).toLowerCase() === 'a') {
        el.click = vi.fn(() => {
          anchorClicks.push({ href: el.href, download: el.download });
        });
      }
      return el;
    });

    const OriginalImage = global.Image;
    global.Image = class FakeImage {
      constructor() {
        this.width = 800;
        this.height = 600;
      }
      set src(_value) {
        setTimeout(() => this.onload && this.onload(), 0);
      }
    };

    try {
      await import('../../sidepanel/sidepanel.js');
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await flush();
      await flush();

      await new Promise((resolve) => setTimeout(resolve, 10));
      document.getElementById('download-btn').click();
      await flush();
      await flush();

      expect(fakeCanvas.getContext).toHaveBeenCalledWith('2d');
      expect(fakeCanvas.toDataURL).toHaveBeenCalledWith('image/png');
      expect(fakeCtx.drawImage).toHaveBeenCalled();
      const exportTexts = fakeCtx.fillText.mock.calls.map((call) => String(call?.[0] || ''));
      expect(exportTexts.some((text) => text === '1. Panel 1 caption')).toBe(true);
      expect(exportTexts.some((text) => text === 'Panel 1')).toBe(false);
      expect(exportTexts.some((text) => text === 'Short export summary')).toBe(true);
      expect(fakeCtx.fillText).toHaveBeenCalledWith('Made with Web2Comics', expect.any(Number), expect.any(Number));
      expect(anchorClicks.length).toBeGreaterThan(0);
      const exportClick = [...anchorClicks].reverse().find((c) => String(c.download || '').includes('-comic-sheet.png'));
      expect(exportClick).toBeTruthy();
      expect(exportClick.download).toContain('CNN-Story-1-comic-sheet.png');
      expect(exportClick.href.startsWith('data:image/png;base64,')).toBe(true);
    } finally {
      document.createElement = originalCreateElement;
      global.Image = OriginalImage;
    }
  });

  it('exports panel images when only image_url is available in artifacts', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.panels = [
      {
        caption: 'Image URL export panel',
        artifacts: {
          image_url: 'data:image/png;base64,URL_ONLY_FOR_EXPORT'
        }
      }
    ];
    const history = [item];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    const originalCreateElement = document.createElement.bind(document);
    const fakeGradient = { addColorStop: vi.fn() };
    const fakeCtx = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      arcTo: vi.fn(),
      closePath: vi.fn(),
      fillRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      clip: vi.fn(),
      drawImage: vi.fn(),
      restore: vi.fn(),
      createLinearGradient: vi.fn(() => fakeGradient),
      measureText: vi.fn((text) => ({ width: String(text || '').length * 8 })),
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => fakeCtx),
      toDataURL: vi.fn(() => 'data:image/png;base64,ZmFrZS1wbmc=')
    };

    document.createElement = vi.fn((tagName, ...rest) => {
      if (String(tagName).toLowerCase() === 'canvas') return fakeCanvas;
      const el = originalCreateElement(tagName, ...rest);
      if (String(tagName).toLowerCase() === 'a') el.click = vi.fn();
      return el;
    });

    const OriginalImage = global.Image;
    global.Image = class FakeImage {
      constructor() {
        this.width = 800;
        this.height = 600;
      }
      set src(_value) {
        setTimeout(() => this.onload && this.onload(), 0);
      }
    };

    try {
      await import('../../sidepanel/sidepanel.js');
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await flush();
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 10));

      document.getElementById('download-btn').click();
      await flush();
      await flush();

      expect(fakeCtx.drawImage).toHaveBeenCalled();
    } finally {
      document.createElement = originalCreateElement;
      global.Image = OriginalImage;
    }
  });

  it('exports comic using preset-aware layout geometry (different presets produce different canvas sizes)', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.panels = Array.from({ length: 6 }, (_, i) => ({
      caption: `Panel ${i + 1} caption`,
      artifacts: {
        image_blob_ref:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII='
      }
    }));
    const history = [item];

    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    const originalCreateElement = document.createElement.bind(document);
    const createdCanvases = [];
    const fakeGradient = { addColorStop: vi.fn() };
    function makeCanvas() {
      const ctx = {
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        arcTo: vi.fn(),
        closePath: vi.fn(),
        fillRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        fillText: vi.fn(),
        save: vi.fn(),
        clip: vi.fn(),
        drawImage: vi.fn(),
        restore: vi.fn(),
        createLinearGradient: vi.fn(() => fakeGradient),
        measureText: vi.fn((text) => ({ width: String(text || '').length * 8 })),
        font: '',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1
      };
      const canvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => ctx),
        toDataURL: vi.fn(() => 'data:image/png;base64,ZmFrZS1wbmc=')
      };
      canvas._ctx = ctx;
      return canvas;
    }

    document.createElement = vi.fn((tagName, ...rest) => {
      if (String(tagName).toLowerCase() === 'canvas') {
        const c = makeCanvas();
        createdCanvases.push(c);
        return c;
      }
      const el = originalCreateElement(tagName, ...rest);
      if (String(tagName).toLowerCase() === 'a') {
        el.click = vi.fn();
      }
      return el;
    });

    const OriginalImage = global.Image;
    global.Image = class FakeImage {
      constructor() { this.width = 800; this.height = 600; }
      set src(_value) { setTimeout(() => this.onload && this.onload(), 0); }
    };

    try {
      await import('../../sidepanel/sidepanel.js');
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await flush();
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const select = document.getElementById('layout-preset-select');
      const comicDisplay = document.getElementById('comic-display');
      const viewer = window.__sidepanelViewer;
      expect(viewer).toBeTruthy();

      select.value = 'single-panel-full';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
      expect(comicDisplay.classList.contains('preset-id-single-panel-full')).toBe(true);
      createdCanvases.length = 0;
      await viewer.exportComicAsCompositeImage();
      await flush();
      await flush();
      const first = createdCanvases[0];
      expect(first).toBeTruthy();

      select.value = 'grid-6';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
      expect(comicDisplay.classList.contains('preset-id-grid-6')).toBe(true);
      createdCanvases.length = 0;
      await viewer.exportComicAsCompositeImage();
      await flush();
      await flush();
      const second = createdCanvases[0];
      expect(second).toBeTruthy();
      expect(first.width).toBe(1200);
      expect(second.width).toBe(1200);
      expect(first.height).not.toBe(second.height);
      expect(first._ctx.drawImage).toHaveBeenCalled();
      expect(second._ctx.drawImage).toHaveBeenCalled();
      expect(first._ctx.drawImage.mock.calls.length).toBe(1);
      expect(second._ctx.drawImage.mock.calls.length).toBeGreaterThan(1);
    } finally {
      document.createElement = originalCreateElement;
      global.Image = OriginalImage;
    }
  });

  it('uses preset mode for export profile (preset is single source of truth)', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.panels = Array.from({ length: 6 }, (_, i) => ({
      caption: `Panel ${i + 1} caption`,
      artifacts: {
        image_blob_ref:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII='
      }
    }));
    const history = [item];

    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const viewer = window.__sidepanelViewer;
    const select = document.getElementById('layout-preset-select');
    expect(viewer).toBeTruthy();

    // Preset defaults to panels; direct mode override should not change export kind.
    select.value = 'grid-6';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    viewer.setViewMode('strip');
    await flush();
    const stripProfile = viewer.getExportLayoutProfile();
    expect(stripProfile.kind).toBe('grid');

    // Preset defaults to strip; direct mode override should not change export kind.
    select.value = 'classic-strip';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    viewer.setViewMode('panels');
    await flush();
    const panelProfile = viewer.getExportLayoutProfile();
    expect(panelProfile.kind).toBe('strip');
    expect(panelProfile.columns).toBe(3);

    select.value = 'strip-4-horizontal';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const strip4Profile = viewer.getExportLayoutProfile();
    expect(strip4Profile.kind).toBe('strip');
    expect(strip4Profile.columns).toBe(4);

    select.value = 'square-comic-grid';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const squareProfile = viewer.getExportLayoutProfile();
    expect(squareProfile.kind).toBe('grid');
    expect(squareProfile.cols).toBe(2);
    expect(squareProfile.aspect).toBeCloseTo(1, 4);

    select.value = 'a4-comic-page';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const a4Profile = viewer.getExportLayoutProfile();
    expect(a4Profile.kind).toBe('grid');
    expect(a4Profile.cols).toBe(2);
    expect(a4Profile.aspect).toBeCloseTo(0.75, 4);

    select.value = 'a5-comic-page';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const a5Profile = viewer.getExportLayoutProfile();
    expect(a5Profile.kind).toBe('grid');
    expect(a5Profile.cols).toBe(2);
    expect(a5Profile.aspect).toBeCloseTo(0.8, 4);

    select.value = 'masonry-landscape-2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const masonry2Profile = viewer.getExportLayoutProfile();
    expect(masonry2Profile.kind).toBe('masonry');
    expect(masonry2Profile.cols).toBe(2);

    select.value = 'masonry-landscape-3';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const masonry3Profile = viewer.getExportLayoutProfile();
    expect(masonry3Profile.kind).toBe('masonry');
    expect(masonry3Profile.cols).toBe(3);

    select.value = 'masonry-landscape-4';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const masonry4Profile = viewer.getExportLayoutProfile();
    expect(masonry4Profile.kind).toBe('masonry');
    expect(masonry4Profile.cols).toBe(4);
    expect(masonry4Profile.compact).toBe(true);
  });

  it('includes new comic book layout presets in layout selector', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const select = document.getElementById('layout-preset-select');
    const values = Array.from(select.options).map((opt) => opt.value);
    expect(values).toEqual(expect.arrayContaining([
      'strip-4-horizontal',
      'square-comic-grid',
      'a4-comic-page',
      'a5-comic-page',
      'masonry-landscape-2',
      'masonry-landscape-3',
      'masonry-landscape-4'
    ]));
  });

  it('alerts when composite export fails', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    const originalCreateElement = document.createElement.bind(document);
    document.createElement = vi.fn((tagName, ...rest) => {
      if (String(tagName).toLowerCase() === 'canvas') {
        return {
          getContext: () => null
        };
      }
      return originalCreateElement(tagName, ...rest);
    });

    try {
      await import('../../sidepanel/sidepanel.js');
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await flush();
      await flush();

      document.getElementById('download-btn').click();
      await flush();
      await flush();

      expect(global.alert).toHaveBeenCalledWith('Failed to export comic as a single image.');
    } finally {
      document.createElement = originalCreateElement;
    }
  });

  it('shows rewritten/blocked indicators and prompt button for blocked panels when debug is enabled', async () => {
    const blockedComic = makeHistoryItem(1);
    blockedComic.storyboard.settings = {
      debug_flag: true,
      show_rewritten_badge: true
    };
    blockedComic.storyboard.panels = [
      {
        caption: 'Political panel',
        artifacts: {
          image_blob_ref:
            'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%221%22%20height%3D%221%22/%3E',
          provider_metadata: {
            refusal_handling: {
              mode: 'rewrite_and_retry',
              retried: true,
              rewritten: true,
              blockedPlaceholder: false
            }
          },
          refusal_debug: {
            originalPrompt: 'Donald Trump at a rally',
            effectivePrompt: 'A well-known public figure in neutral editorial context'
          }
        }
      },
      {
        caption: 'Blocked panel',
        artifacts: {
          image_blob_ref:
            'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%221%22%20height%3D%221%22/%3E',
          provider_metadata: {
            refusal_handling: {
              mode: 'show_blocked',
              blockedPlaceholder: true,
              refusalMessage: 'content policy'
            }
          },
          refusal_debug: {
            originalPrompt: 'blocked prompt'
          }
        }
      }
    ];

    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: blockedComic.storyboard } };
      if (key === 'history') return { history: [blockedComic] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    expect(document.querySelectorAll('.panel-badge-rewritten').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelectorAll('.panel-badge-blocked').length).toBeGreaterThanOrEqual(1);

    const promptButtons = document.querySelectorAll('.panel-debug-prompt-btn');
    expect(promptButtons.length).toBeGreaterThanOrEqual(2);

    promptButtons[0].click();
    expect(global.alert).toHaveBeenCalled();
    expect(String(global.alert.mock.calls.at(-1)?.[0] || '')).toContain('Original prompt');
  });

  it('renders compact panel quick actions without grounding indicator', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.panels = [
      {
        caption: 'Panel with grounded facts',
        facts_used: {
          entities: ['Israel', 'Jerusalem', 'UN'],
          dates: ['1948'],
          numbers: ['2 million'],
          source_snippet: 'Relevant extracted source sentence.'
        },
        artifacts: {
          image_blob_ref:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII='
        }
      }
    ];

    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history: [item] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const quickActionButtons = Array.from(document.querySelectorAll('.comic-strip .panel-action-btn'));
    expect(quickActionButtons.length).toBe(1);
    expect(quickActionButtons.every((el) => el.classList.contains('panel-action-btn-icon'))).toBe(true);
    expect(document.querySelector('[data-panel-action="regenerate-image"]')).toBeTruthy();
    expect(document.querySelector('[data-panel-action="regenerate-caption"]')).toBeFalsy();
    expect(document.querySelector('[data-panel-action="make-factual"]')).toBeFalsy();
    expect(String(document.querySelector('[data-panel-action="regenerate-image"]')?.getAttribute('title') || '')).toContain('Regenerate panel image');
    expect(document.querySelector('.comic-strip .panel-image .panel-image-corner-actions [data-panel-action="regenerate-image"]')).toBeTruthy();

    expect(document.querySelector('.comic-strip .panel-facts-shell')).toBeFalsy();
  });

  it('does not render panel More dropdown actions', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.panels = [
      {
        caption: 'Panel caption without More actions',
        artifacts: {
          image_blob_ref:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII='
        }
      }
    ];

    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history: [item] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    expect(document.querySelector('.comic-strip .panel-more-actions')).toBeFalsy();
    expect(document.querySelector('.comic-strip [data-panel-action="make-simpler"]')).toBeFalsy();
    expect(document.querySelector('.comic-strip [data-panel-action="jump-source"]')).toBeFalsy();
  });

  it('shows per-panel spinner/status while image regenerate action is running', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.panels = [
      {
        caption: 'Original caption',
        artifacts: {
          image_blob_ref:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII='
        }
      }
    ];

    let resolveEdit;
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history: [item] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });
    chrome.runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg?.type === 'EDIT_PANEL' && msg?.payload?.action === 'regenerate-image') {
        return await new Promise((resolve) => {
          resolveEdit = resolve;
        });
      }
      return { success: true };
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const imageBtn = document.querySelector('.comic-strip [data-panel-action="regenerate-image"]');
    expect(imageBtn).toBeTruthy();
    imageBtn.click();
    await flush();
    await flush();

    const editStatus = document.querySelector('.comic-strip .panel-edit-status');
    expect(editStatus).toBeTruthy();
    expect(String(editStatus.textContent || '')).toContain('Regenerating image');
    const actionButtons = Array.from(document.querySelectorAll('.comic-strip .panel-action-btn'));
    expect(actionButtons.every((btn) => btn.disabled)).toBe(true);

    resolveEdit({
      success: true,
      job: {
        storyboard: {
          source: item.storyboard.source,
          panels: [
            {
              caption: 'Updated caption',
              artifacts: item.storyboard.panels[0].artifacts
            }
          ]
        }
      }
    });
    await flush();
    await flush();

    expect(document.querySelector('.comic-strip .panel-edit-status')).toBeFalsy();
    const updatedCaption = document.querySelector('.comic-strip .panel-caption');
    expect(String(updatedCaption.textContent || '')).toContain('Updated caption');
  });

  it('sends image panel edit requests with history comic id when comic is opened from history', async () => {
    const history = [makeHistoryItem(1), makeHistoryItem(2)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (Array.isArray(key) && key.includes('selectedHistoryComicId')) {
        return { selectedHistoryComicId: 'history-2', history };
      }
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });
    chrome.runtime.sendMessage.mockResolvedValue({
      success: true,
      job: { storyboard: history[1].storyboard }
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const quickBtn = document.querySelector('.comic-strip [data-panel-action="regenerate-image"]');
    expect(quickBtn).toBeTruthy();
    quickBtn.click();
    await flush();
    await flush();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'EDIT_PANEL',
      payload: { panelIndex: 0, action: 'regenerate-image', comicId: 'history-2' }
    });
  });

  it('does not render grounding indicator after image panel action', async () => {
    const history = [makeHistoryItem(1)];
    const storyboardAfterEdit = JSON.parse(JSON.stringify(history[0].storyboard));
    storyboardAfterEdit.panels[0].caption = 'Fact-focused caption';
    storyboardAfterEdit.panels[0].facts_used = {
      entities: ['Israel'],
      dates: ['2026'],
      numbers: ['3.2%'],
      source_snippet: 'Israel inflation reached 3.2% in 2026.'
    };

    chrome.storage.local.get.mockImplementation(async (key) => {
      if (Array.isArray(key) && key.includes('selectedHistoryComicId')) {
        return { selectedHistoryComicId: 'history-1', history };
      }
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });
    chrome.runtime.sendMessage.mockResolvedValue({
      success: true,
      job: { storyboard: storyboardAfterEdit }
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const imageBtn = document.querySelector('.comic-strip [data-panel-action="regenerate-image"]');
    expect(imageBtn).toBeTruthy();
    imageBtn.click();
    await flush();
    await flush();

    expect(document.querySelector('.comic-strip .panel .panel-facts-shell')).toBeFalsy();
  });

  it('renders caption fallback text when panel.caption is missing', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.panels = [
      {
        beat_summary: 'Fallback beat summary text',
        artifacts: {
          image_blob_ref:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII='
        }
      }
    ];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history: [item] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const panelCaption = document.querySelector('.comic-strip .panel-caption');
    expect(panelCaption).toBeTruthy();
    expect(String(panelCaption.textContent)).toContain('Fallback beat summary text');

    const carouselCaption = document.getElementById('carousel-panel-caption-text');
    expect(String(carouselCaption.textContent)).toContain('Fallback beat summary text');
  });

  it('normalizes object-shaped caption values instead of rendering [object Object]', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.panels = [
      {
        caption: { text: 'Caption from object payload' },
        artifacts: {
          image_blob_ref:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII='
        }
      }
    ];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history: [item] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const panelCaption = document.querySelector('.comic-strip .panel-caption');
    expect(panelCaption).toBeTruthy();
    expect(String(panelCaption.textContent)).toContain('Caption from object payload');
    expect(String(panelCaption.textContent)).not.toContain('[object Object]');

    const carouselCaption = document.getElementById('carousel-panel-caption-text');
    expect(String(carouselCaption.textContent)).toContain('Caption from object payload');
    expect(String(carouselCaption.textContent)).not.toContain('[object Object]');
  });

  it('prefers story-like caption text when caption looks like an image prompt', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.panels = [
      {
        panel_id: 'panel_prompty',
        caption: 'Comic panel illustration of: A dramatic newsroom scene, cinematic lighting, digital art, highly detailed, camera angle from above, ultra detailed editorial style',
        beat_summary: 'Newsroom reacts to a major breaking update.',
        image_prompt: 'Comic panel illustration of: A dramatic newsroom scene, cinematic lighting, digital art, highly detailed, camera angle from above, ultra detailed editorial style',
        artifacts: {
          image_blob_ref:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII='
        }
      }
    ];
    const setCalls = [];
    chrome.storage.local.set.mockImplementation(async (payload) => {
      setCalls.push(payload);
    });
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history: [item] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      if (key === 'debugLogs') return { debugLogs: [] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const panelCaption = document.querySelector('.comic-strip .panel-caption');
    expect(String(panelCaption.textContent)).toContain('Newsroom reacts to a major breaking update.');
    expect(String(panelCaption.textContent)).not.toContain('cinematic lighting');

    const debugSet = setCalls.find((p) => Array.isArray(p.debugLogs));
    expect(debugSet).toBeTruthy();
    expect(debugSet.debugLogs.some((e) => e.event === 'caption.prompt_like_substituted')).toBe(true);
  });

  it('logs caption.missing when a panel has no usable caption fields', async () => {
    const item = makeHistoryItem(1);
    item.storyboard.panels = [
      {
        panel_id: 'panel_x',
        artifacts: {
          image_blob_ref:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII='
        }
      }
    ];
    const setCalls = [];
    chrome.storage.local.set.mockImplementation(async (payload) => {
      setCalls.push(payload);
    });
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: item.storyboard } };
      if (key === 'history') return { history: [item] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      if (key === 'debugLogs') return { debugLogs: [] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const debugSet = setCalls.find((p) => Array.isArray(p.debugLogs));
    expect(debugSet).toBeTruthy();
    const last = debugSet.debugLogs.at(-1);
    expect(last.event).toBe('caption.missing');
    expect(last.data.panelId).toBe('panel_x');
  });

  it('does not log caption.missing for expected generation placeholders', async () => {
    const setCalls = [];
    chrome.storage.local.set.mockImplementation(async (payload) => {
      setCalls.push(payload);
    });
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') {
        return {
          currentJob: {
            status: 'generating_images',
            settings: { panel_count: 6 },
            storyboard: {
              source: { url: 'https://example.com/article', title: 'Example' },
              panels: Array.from({ length: 5 }, (_, i) => ({
                caption: 'Panel caption ' + (i + 1),
                runtime_status: i < 2 ? 'completed' : 'rendering',
                artifacts: i < 2 ? {
                  image_blob_ref:
                    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII='
                } : {}
              }))
            }
          }
        };
      }
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      if (key === 'debugLogs') return { debugLogs: [] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const captions = Array.from(document.querySelectorAll('#gen-panels .gen-panel-caption')).map((el) => String(el.textContent || ''));
    expect(captions).toContain('Panel 6');

    const debugSets = setCalls.filter((p) => Array.isArray(p.debugLogs));
    const captionMissingLogs = debugSets.flatMap((p) => p.debugLogs).filter((e) => e && e.event === 'caption.missing');
    expect(captionMissingLogs.length).toBe(0);
  });

  it('escapes history/comic text and sanitizes unsafe source links', async () => {
    const malicious = makeHistoryItem(1);
    malicious.id = 'x"><svg onload=alert(1)>';
    malicious.source = {
      url: 'javascript:alert(1)',
      title: '<img src=x onerror=alert(1)> Breaking <b>News</b>'
    };
    malicious.storyboard.source = { ...malicious.source };
    malicious.storyboard.panels = [
      {
        caption: '<script>alert(1)</script> Caption',
        artifacts: {
          image_blob_ref:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII='
        }
      }
    ];

    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: malicious.storyboard } };
      if (key === 'history') return { history: [malicious] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    expect(document.querySelector('#comic-strip script')).toBeNull();
    expect(document.querySelector('#comic-strip img[src="x"]')).toBeNull();
    expect(document.getElementById('comic-source').getAttribute('href')).toBe('#');

    document.getElementById('mode-history-btn').click();
    await flush();
    const historyTitle = document.querySelector('#history-browser-grid .history-title');
    expect(historyTitle.innerHTML).not.toContain('<img');
    const originalLink = document.querySelector('#history-browser-grid .history-source-link');
    expect(originalLink.getAttribute('href')).toBe('#');
  });

  it('refreshes viewer when currentJob completes while sidepanel is already open', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const listener = chrome.storage.onChanged.addListener.mock.calls[0]?.[0];
    expect(typeof listener).toBe('function');

    listener({
      currentJob: {
        newValue: {
          id: 'job-completed-live',
          status: 'completed',
          storyboard: {
            source: { url: 'https://www.cnn.com/new', title: 'CNN Live Refresh' },
            panels: [
              { beat_summary: 'Live beat A', artifacts: { image_blob_ref: 'data:image/png;base64,aaa' } },
              { beat_summary: 'Live beat B', artifacts: { image_blob_ref: 'data:image/png;base64,bbb' } }
            ]
          }
        }
      }
    }, 'local');
    await flush();
    await flush();

    expect(document.getElementById('empty-state').classList.contains('hidden')).toBe(true);
    expect(document.body.textContent).toContain('Live beat A');
  });

  it('resets comic canvas to empty generation placeholder when a fresh job starts', async () => {
    const history = [makeHistoryItem(1)];
    let currentJobState = { id: 'job-old', status: 'completed', storyboard: history[0].storyboard };
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: currentJobState };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    expect(document.getElementById('comic-display').classList.contains('hidden')).toBe(false);
    expect(document.querySelector('#comic-strip .panel-image img')).toBeTruthy();

    const listener = chrome.storage.onChanged.addListener.mock.calls[0]?.[0];
    expect(typeof listener).toBe('function');
    currentJobState = {
      id: 'job-new',
      status: 'pending',
      completedPanels: 0,
      settings: { panel_count: 3 },
      storyboard: { panels: [] }
    };
    listener({
      currentJob: {
        newValue: currentJobState
      }
    }, 'local');
    await flush();
    await flush();

    expect(document.getElementById('generation-view').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('comic-display').classList.contains('hidden')).toBe(true);
    expect(document.querySelectorAll('#gen-panels .gen-panel').length).toBe(3);
    expect(document.querySelector('#gen-panels .gen-panel-thumb img')).toBeNull();
  });

  it('updates viewer from runtime progress broadcast so multiple open sidepanels can refresh', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const runtimeListener = chrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
    expect(typeof runtimeListener).toBe('function');

    runtimeListener({
      type: 'JOB_PROGRESS_BROADCAST',
      job: {
        id: 'job-runtime-broadcast',
        status: 'completed',
        storyboard: {
          source: { url: 'https://www.cnn.com/broadcast', title: 'Broadcast Comic' },
          panels: [
            { caption: 'Broadcast panel', artifacts: { image_blob_ref: 'data:image/png;base64,aaa' } }
          ]
        }
      }
    });
    await flush();
    await flush();

    expect(document.getElementById('empty-state').classList.contains('hidden')).toBe(true);
    expect(document.body.textContent).toContain('Broadcast panel');
  });

  it('keeps generation view visible with failed status and partial panel results on failed job update', async () => {
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const listener = chrome.storage.onChanged.addListener.mock.calls[0]?.[0];
    listener({
      currentJob: {
        newValue: {
          id: 'job-failed-live',
          status: 'failed',
          error: 'Provider timeout',
          completedPanels: 1,
          currentPanelIndex: 1,
          settings: { panel_count: 3 },
          storyboard: {
            panels: [
              { caption: 'Done panel', runtime_status: 'completed', artifacts: { image_blob_ref: 'data:image/png;base64,aaa' } },
              { caption: 'Failed panel', runtime_status: 'error', artifacts: {} },
              { caption: 'Pending panel', runtime_status: 'pending', artifacts: {} }
            ]
          }
        }
      }
    }, 'local');
    await flush();
    await flush();

    expect(document.getElementById('generation-view').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('gen-status-title').textContent).toContain('Generation Failed');
    expect(document.getElementById('gen-status-text').textContent).toContain('Failed');
    expect(document.getElementById('gen-panels').textContent).toContain('Done panel');
    expect(global.alert).toHaveBeenCalled();
  });

  it('enables share/open-tab controls only when a comic is visible in Comic View', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const shareBtn = document.getElementById('share-btn');
    const shareMenu = document.getElementById('share-target-menu');
    const openTabBtn = document.getElementById('open-tab-btn');
    expect(shareBtn.disabled).toBe(true);
    expect(shareMenu.classList.contains('hidden')).toBe(true);
    expect(openTabBtn.disabled).toBe(true);

    document.getElementById('mode-history-btn').click();
    await flush();
    document.querySelector('#history-browser-grid .history-item').click();
    await flush();
    await flush();

    expect(shareBtn.disabled).toBe(false);
    expect(openTabBtn.disabled).toBe(false);

    document.getElementById('mode-history-btn').click();
    await flush();
    expect(shareBtn.disabled).toBe(true);
    expect(openTabBtn.disabled).toBe(true);
  });

  it('restores comic panel images when switching back from History to Comic view', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();
    document.querySelector('#history-browser-grid .history-item').click();
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();
    document.getElementById('mode-comic-btn').click();
    await flush();
    await flush();

    const comicDisplay = document.getElementById('comic-display');
    const panelImage = document.querySelector('#comic-strip .panel .panel-image img');
    expect(comicDisplay.classList.contains('hidden')).toBe(false);
    expect(panelImage).toBeTruthy();
    expect(String(panelImage.getAttribute('src') || '')).toContain('data:image/png;base64');
  });

  it('keeps panel images when a compacted completed currentJob update arrives before switching back to Comic view', async () => {
    const richItem = makeHistoryItem(1);
    const richStoryboard = richItem.storyboard;
    const compactedStoryboard = {
      ...richStoryboard,
      panels: [
        {
          caption: richStoryboard.panels[0].caption,
          artifacts: {}
        }
      ]
    };
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') {
        return { currentJob: { id: 'job-compacted', status: 'completed', storyboard: richStoryboard } };
      }
      if (key === 'history') return { history: [richItem] };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const initialImage = document.querySelector('#comic-strip .panel .panel-image img');
    const initialSrc = String(initialImage?.getAttribute('src') || '');
    expect(initialSrc.startsWith('data:image/')).toBe(true);

    const listener = chrome.storage.onChanged.addListener.mock.calls[0]?.[0];
    expect(typeof listener).toBe('function');
    listener({
      currentJob: {
        newValue: {
          id: 'job-compacted',
          status: 'completed',
          storyboard: compactedStoryboard
        }
      }
    }, 'local');
    await flush();
    await flush();

    document.getElementById('mode-history-btn').click();
    await flush();
    document.getElementById('mode-comic-btn').click();
    await flush();
    await flush();

    const recoveredImage = document.querySelector('#comic-strip .panel .panel-image img');
    expect(recoveredImage).toBeTruthy();
    expect(String(recoveredImage.getAttribute('src') || '')).toBe(initialSrc);
  });

  it('shows counters for comics, panels, and unique pages processed', async () => {
    const a = makeHistoryItem(1);
    const b = makeHistoryItem(2);
    const c = makeHistoryItem(3);
    // Reuse one source URL to verify unique-page counting.
    c.source.url = b.source.url;
    c.storyboard.source.url = b.storyboard.source.url;
    // Make one comic have multiple panels to verify panel aggregation.
    b.storyboard.panels.push({
      caption: 'Extra panel',
      artifacts: {
        image_blob_ref:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axlF8UAAAAASUVORK5CYII='
      }
    });

    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: null };
      if (key === 'history') return { history: [a, b, c] };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    expect(document.getElementById('viewer-stat-comics').textContent).toBe('3');
    expect(document.getElementById('viewer-stat-panels').textContent).toBe('4');
    expect(document.getElementById('viewer-stat-pages').textContent).toBe('2');
  });

  it('opens current comic viewer in a full Chrome tab', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('open-tab-btn').click();
    await flush();

    expect(chrome.tabs.create).toHaveBeenCalled();
    const call = chrome.tabs.create.mock.calls.at(-1)?.[0] || {};
    expect(String(call.url || '')).toContain('chrome-extension://test/sidepanel/sidepanel.html');
  });

  it('opens X share intent with source URL and summary text', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('share-btn').click();
    await flush();
    document.querySelector('[data-share-target="x"]').click();
    await flush();

    expect(chrome.tabs.create).toHaveBeenCalled();
    const call = chrome.tabs.create.mock.calls.at(-1)?.[0] || {};
    expect(String(call.url || '')).toContain('x.com/intent/tweet');
    expect(String(call.url || '')).toContain('CNN%20Story%201');
    expect(String(call.url || '')).toContain('Made%20with%20Web2Comics');
  });

  it('uses Instagram fallback flow by downloading image and opening instagram.com', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const viewer = window.__sidepanelViewer;
    vi.spyOn(viewer, 'exportComicAsCompositeImage').mockResolvedValue({
      dataUrl: 'data:image/png;base64,ZmFrZS1wbmc=',
      filename: 'cnn-story-comic-sheet.png',
      sourceTitle: 'CNN Story 1',
      sourceUrl: 'https://www.cnn.com/1'
    });

    document.getElementById('share-btn').click();
    await flush();
    document.querySelector('[data-share-target="instagram"]').click();
    await flush();
    await flush();

    expect(viewer.exportComicAsCompositeImage).toHaveBeenCalledWith({ download: false });
    expect(anchorClick).toHaveBeenCalled();
    const call = chrome.tabs.create.mock.calls.at(-1)?.[0] || {};
    expect(String(call.url || '')).toBe('https://www.instagram.com/');
    expect(global.alert).toHaveBeenCalled();
  });

  it('uses Facebook fallback flow by downloading image and opening Facebook composer', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const viewer = window.__sidepanelViewer;
    vi.spyOn(viewer, 'exportComicAsCompositeImage').mockResolvedValue({
      dataUrl: 'data:image/png;base64,ZmFrZS1wbmc=',
      filename: 'cnn-story-comic-sheet.png',
      sourceTitle: 'CNN Story 1',
      sourceUrl: 'https://www.cnn.com/1'
    });

    document.getElementById('share-btn').click();
    await flush();
    document.querySelector('[data-share-target="facebook"]').click();
    await flush();
    await flush();

    expect(viewer.exportComicAsCompositeImage).toHaveBeenCalledWith({ download: false });
    expect(anchorClick).toHaveBeenCalled();
    const call = chrome.tabs.create.mock.calls.at(-1)?.[0] || {};
    expect(String(call.url || '')).toBe('https://www.facebook.com/?sk=composer');
    expect(global.alert).toHaveBeenCalled();
  });

  it('keeps Facebook visible in share menu even when connector is not connected', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'connectionStates') return { connectionStates: {} };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, status: { connected: false } });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('share-btn').click();
    await flush();

    const facebookItem = document.querySelector('[data-share-target="facebook"]');
    const emptyState = document.getElementById('share-target-empty');
    expect(facebookItem).toBeTruthy();
    expect(facebookItem.classList.contains('hidden')).toBe(false);
    expect(emptyState.classList.contains('hidden')).toBe(true);
  });

  it('shows safe alert when share export fails', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const viewer = window.__sidepanelViewer;
    vi.spyOn(viewer, 'exportComicAsCompositeImage').mockRejectedValue(new Error('Canvas export is unavailable'));

    document.getElementById('share-btn').click();
    await flush();
    document.querySelector('[data-share-target="instagram"]').click();
    await flush();
    await flush();

    expect(global.alert).toHaveBeenCalledWith('Failed to open sharing target.');
  });

  it('uses email-card fallback by downloading image and opening mail client link', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const viewer = window.__sidepanelViewer;
    vi.spyOn(viewer, 'exportComicAsCompositeImage').mockResolvedValue({
      dataUrl: 'data:image/png;base64,ZmFrZS1wbmc=',
      filename: 'cnn-story-comic-sheet.png',
      sourceTitle: 'CNN Story 1',
      sourceUrl: 'https://www.cnn.com/1'
    });

    document.getElementById('share-btn').click();
    await flush();
    document.querySelector('[data-share-target="email-card"]').click();
    await flush();
    await flush();

    expect(viewer.exportComicAsCompositeImage).toHaveBeenCalledWith({ download: false });
    expect(anchorClick).toHaveBeenCalled();
    const call = chrome.tabs.create.mock.calls.at(-1)?.[0] || {};
    expect(String(call.url || '')).toContain('mailto:?subject=');
    expect(global.alert).toHaveBeenCalled();
  });

  it('uses linkedin-post fallback by downloading image and opening LinkedIn feed', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const viewer = window.__sidepanelViewer;
    vi.spyOn(viewer, 'exportComicAsCompositeImage').mockResolvedValue({
      dataUrl: 'data:image/png;base64,ZmFrZS1wbmc=',
      filename: 'cnn-story-comic-sheet.png',
      sourceTitle: 'CNN Story 1',
      sourceUrl: 'https://www.cnn.com/1'
    });

    document.getElementById('share-btn').click();
    await flush();
    document.querySelector('[data-share-target="linkedin-post"]').click();
    await flush();
    await flush();

    expect(viewer.exportComicAsCompositeImage).toHaveBeenCalledWith({ download: false });
    expect(anchorClick).toHaveBeenCalled();
    const call = chrome.tabs.create.mock.calls.at(-1)?.[0] || {};
    expect(String(call.url || '')).toBe('https://www.linkedin.com/feed/');
    expect(global.alert).toHaveBeenCalled();
  });

  it('shows clear alert for unsupported share target values', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    const menu = document.getElementById('share-target-menu');
    const unsupported = document.createElement('button');
    unsupported.type = 'button';
    unsupported.className = 'share-target-item';
    unsupported.dataset.shareTarget = 'unsupported-target';
    unsupported.textContent = 'Unsupported';
    menu.appendChild(unsupported);
    document.getElementById('share-btn').click();
    await flush();
    unsupported.click();
    await flush();

    expect(global.alert).toHaveBeenCalledWith('Unsupported share target.');
  });

  it('opens settings on Connections tab from the share menu "Connect more" action', async () => {
    const history = [makeHistoryItem(1)];
    chrome.storage.local.get.mockImplementation(async (key) => {
      if (key === 'currentJob') return { currentJob: { status: 'completed', storyboard: history[0].storyboard } };
      if (key === 'history') return { history };
      if (key === 'connectionStates') return { connectionStates: {} };
      if (key === 'sidepanelPrefs') return { sidepanelPrefs: {} };
      return {};
    });

    await import('../../sidepanel/sidepanel.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
    await flush();

    document.getElementById('share-btn').click();
    await flush();

    const connectMoreBtn = document.querySelector('[data-share-action="connect-more"]');
    expect(connectMoreBtn).toBeTruthy();
    connectMoreBtn.click();
    await flush();

    expect(chrome.tabs.create).toHaveBeenCalled();
    const call = chrome.tabs.create.mock.calls.at(-1)?.[0] || {};
    expect(String(call.url || '')).toContain('chrome-extension://test/options/options.html?section=connections');
  });
});
