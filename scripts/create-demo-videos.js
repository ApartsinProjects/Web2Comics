const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const OUT_BASE = path.resolve(EXTENSION_PATH, 'artifacts', 'demo-videos');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function getExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
  }
  return new URL(worker.url()).host;
}

async function clickIfVisible(page, selector) {
  const el = page.locator(selector);
  const visible = await el.isVisible().catch(() => false);
  if (!visible) return false;
  const enabled = await el.isEnabled().catch(() => false);
  if (!enabled) return false;
  await el.click();
  return true;
}

function toSrtTime(totalSeconds) {
  const ms = Math.max(0, Math.floor(totalSeconds * 1000));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

function writeSrt(outputPath, cues) {
  const lines = [];
  cues.forEach((cue, i) => {
    lines.push(String(i + 1));
    lines.push(`${toSrtTime(cue.start)} --> ${toSrtTime(cue.end)}`);
    lines.push(cue.text);
    lines.push('');
  });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
}

function buildShortCues() {
  return [
    { start: 0, end: 7, text: 'Web2Comics: Turn any page into a comic summary.' },
    { start: 7, end: 20, text: 'Two clicks: Create Comic, then Generate.' },
    { start: 20, end: 33, text: 'Stories: auto-pick best section, or switch manually.' },
    { start: 33, end: 46, text: 'Viewer supports layout presets and panel refinements.' },
    { start: 46, end: 60, text: 'Share or download. Create, edit, and publish fast.' }
  ];
}

function buildFullCues() {
  return [
    { start: 0, end: 15, text: 'Turn any page into a visual comic summary in seconds.' },
    { start: 15, end: 40, text: 'Default flow: Create Comic, then Generate.' },
    { start: 40, end: 65, text: 'Detected stories are auto-ranked; you can switch manually.' },
    { start: 65, end: 85, text: 'Use highlighted text mode for precise source control.' },
    { start: 85, end: 115, text: 'Viewer supports layout presets and per-panel quick edits.' },
    { start: 115, end: 135, text: 'History keeps generated comics for quick reopen.' },
    { start: 135, end: 160, text: 'Export/share to social targets and email.' },
    { start: 160, end: 180, text: 'Web2Comics helps summarize, learn, and communicate faster.' }
  ];
}

async function runPlan(planName, chapterCues) {
  const runDir = path.join(OUT_BASE, `${planName}-${stamp()}`);
  ensureDir(runDir);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `web2comics-${planName}-`));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: runDir,
      size: { width: 1280, height: 720 }
    },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox'
    ]
  });

  let videoFilePath = '';
  try {
    const extensionId = await getExtensionId(context);
    const page = await context.newPage();

    // Chapter 1: source page
    await page.goto('https://www.cnn.com', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(2500);

    // Chapter 2: popup create flow
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await clickIfVisible(page, '#create-comic-btn');
    await page.waitForTimeout(1200);
    await clickIfVisible(page, '#story-picker-btn');
    await page.waitForTimeout(1200);
    await clickIfVisible(page, '#close-story-picker-btn');
    await page.waitForTimeout(600);

    // Chapter 3: options connections quick pass
    await page.goto(`chrome-extension://${extensionId}/options/options.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.locator('.nav-btn[data-section="connections"]').click();
    await page.waitForTimeout(1600);
    await clickIfVisible(page, '#connect-google-drive-btn');
    await page.waitForTimeout(1200);

    // Chapter 4: sidepanel
    await page.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    await clickIfVisible(page, '#share-btn');
    await page.waitForTimeout(1200);

    const video = page.video();
    await page.close();
    if (video) {
      videoFilePath = await video.path();
      const target = path.join(runDir, `${planName}.webm`);
      fs.copyFileSync(videoFilePath, target);
      videoFilePath = target;
    }

    const srtPath = path.join(runDir, `${planName}.srt`);
    writeSrt(srtPath, chapterCues);

    const manifest = {
      plan: planName,
      createdAt: new Date().toISOString(),
      outputDir: runDir,
      video: path.basename(videoFilePath || ''),
      subtitles: path.basename(srtPath)
    };
    fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function main() {
  ensureDir(OUT_BASE);
  const shortManifest = await runPlan('demo-60s', buildShortCues());
  const fullManifest = await runPlan('demo-full', buildFullCues());
  console.log(JSON.stringify({ ok: true, outputs: [shortManifest, fullManifest] }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

