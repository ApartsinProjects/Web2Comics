const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { composeComicSheet } = require('../src/compose');

async function solid(color) {
  return sharp({
    create: { width: 512, height: 512, channels: 4, background: color }
  }).png().toBuffer();
}

describe('engine compose', () => {
  it('renders a png sheet from storyboard + panel images', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2c-engine-'));
    const outputPath = path.join(tmpDir, 'comic.png');
    const storyboard = {
      title: 'Test Story',
      description: 'desc',
      panels: [
        { caption: 'Panel one caption' },
        { caption: 'Panel two caption' }
      ]
    };
    const panelImages = [
      { buffer: await solid('#f97316') },
      { buffer: await solid('#0ea5e9') }
    ];

    const result = await composeComicSheet({
      storyboard,
      panelImages,
      source: 'file://input.txt',
      outputConfig: {
        width: 900,
        panel_height: 260,
        caption_height: 80,
        padding: 16,
        gap: 12,
        header_height: 90,
        footer_height: 26,
        background: '#ffffff',
        brand: 'test'
      },
      outputPath
    });

    expect(fs.existsSync(result.outputPath)).toBe(true);
    expect(result.bytes).toBeGreaterThan(1000);
    const meta = await sharp(result.outputPath).metadata();
    expect(meta.width).toBe(900);
    expect(meta.height).toBeGreaterThan(500);
  });

  it('renders single-image grid layout when layout=grid', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2c-engine-grid-'));
    const outputPath = path.join(tmpDir, 'comic-grid.png');
    const storyboard = {
      title: 'Grid Story',
      description: 'desc',
      panels: [
        { caption: 'Panel 1' },
        { caption: 'Panel 2' },
        { caption: 'Panel 3' },
        { caption: 'Panel 4' }
      ]
    };
    const panelImages = [
      { buffer: await solid('#ef4444') },
      { buffer: await solid('#22c55e') },
      { buffer: await solid('#3b82f6') },
      { buffer: await solid('#f59e0b') }
    ];

    const result = await composeComicSheet({
      storyboard,
      panelImages,
      source: 'text',
      outputConfig: {
        layout: 'grid',
        grid_columns: 2,
        width: 1000,
        panel_height: 200,
        caption_height: 80,
        padding: 16,
        gap: 10,
        header_height: 60,
        footer_height: 20,
        background: '#ffffff',
        brand: 'test'
      },
      outputPath
    });

    expect(fs.existsSync(result.outputPath)).toBe(true);
    const meta = await sharp(result.outputPath).metadata();
    expect(meta.width).toBe(1000);
    expect(meta.height).toBe(542);
  });
});
