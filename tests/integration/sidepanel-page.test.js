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
    expect(global.confirm).toHaveBeenCalledWith('Delete this comic from history?');
    expect(history).toHaveLength(2);

    global.confirm = vi.fn(() => true);
    deleteBtn.click();
    await flush();
    await flush();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe('history-2');
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

    expect(values.length).toBe(22);
    expect(new Set(values).size).toBe(values.length);
    expect(labels).toContain('Single panel (Full-page)');
    expect(labels).toContain('Manga page (Right-to-left flow)');
    expect(labels).toContain('Webtoon scroll (Vertical strip)');
    expect(labels).toContain('Carousel (Swipe panels)');
    expect(labels).toContain('Guided path (Numbered / arrowed flow)');
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
    await flush();

    expect(String(document.getElementById('gen-status-text')?.textContent || '')).toContain('Canceling');
    expect(cancelBtn.disabled).toBe(true);
  });

  it('exports a composite comic image on Download using canvas and image APIs', async () => {
    const history = [makeHistoryItem(1)];
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
      expect(fakeCtx.fillText).toHaveBeenCalledWith('Generated by Web2Comics', expect.any(Number), expect.any(Number));
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
});
