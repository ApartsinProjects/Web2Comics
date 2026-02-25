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

    select.value = 'cinema-carousel';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    await flush();

    expect(comicDisplay.classList.contains('preset-cinema-carousel')).toBe(true);
    expect(comicDisplay.classList.contains('mode-carousel')).toBe(true);
    expect(carousel.classList.contains('hidden')).toBe(false);
    expect(strip.classList.contains('hidden')).toBe(true);
    expect(persistedPrefs.layoutPreset).toBe('cinema-carousel');
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

    expect(select.value).toBe('reading-grid');
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
});
