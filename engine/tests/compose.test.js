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
});
