const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapText(text, maxCharsPerLine, maxLines) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      return;
    }
    if (current) lines.push(current);
    current = word;
  });
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const trimmed = lines.slice(0, maxLines);
  trimmed[maxLines - 1] = `${trimmed[maxLines - 1].slice(0, Math.max(0, maxCharsPerLine - 1))}…`;
  return trimmed;
}

function buildTextBlockSvg({ width, height, title, subtitle, lines, background }) {
  const titleSafe = escapeXml(title || '');
  const subtitleSafe = escapeXml(subtitle || '');
  const lineItems = Array.isArray(lines) ? lines : [];
  const linesSvg = lineItems
    .map((line, idx) => `<text x="20" y="${56 + (idx * 30)}" font-size="26" fill="#0f172a" font-family="Segoe UI, Arial, sans-serif">${escapeXml(line)}</text>`)
    .join('');

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(background || '#ffffff')}"/>` +
      (titleSafe ? `<text x="20" y="34" font-size="24" font-weight="700" fill="#111827" font-family="Segoe UI, Arial, sans-serif">${titleSafe}</text>` : '') +
      (subtitleSafe ? `<text x="20" y="52" font-size="14" fill="#475569" font-family="Segoe UI, Arial, sans-serif">${subtitleSafe}</text>` : '') +
      linesSvg +
    `</svg>`
  );
}

async function ensurePanelImage(buffer, panelWidth, panelHeight) {
  return sharp(buffer)
    .resize(panelWidth, panelHeight, { fit: 'cover' })
    .jpeg({ quality: 86 })
    .toBuffer();
}

async function composeComicSheet({ storyboard, panelImages, source, outputConfig, outputPath }) {
  const cfg = outputConfig;
  const panelCount = storyboard.panels.length;
  const width = cfg.width;
  const panelWidth = width - (cfg.padding * 2);
  const panelHeight = cfg.panel_height;
  const captionHeight = cfg.caption_height;

  const totalHeight =
    cfg.padding +
    cfg.header_height +
    cfg.gap +
    (panelCount * (panelHeight + captionHeight + cfg.gap)) +
    cfg.footer_height +
    cfg.padding;

  const base = sharp({
    create: {
      width,
      height: totalHeight,
      channels: 4,
      background: cfg.background || '#f8fafc'
    }
  });

  const composites = [];

  const headerLines = wrapText(storyboard.description || '', Math.max(24, Math.floor(panelWidth / 18)), 2);
  composites.push({
    input: buildTextBlockSvg({
      width: panelWidth,
      height: cfg.header_height,
      title: storyboard.title || 'Comic Summary',
      subtitle: source,
      lines: headerLines,
      background: '#ffffff'
    }),
    left: cfg.padding,
    top: cfg.padding
  });

  let cursorY = cfg.padding + cfg.header_height + cfg.gap;

  for (let i = 0; i < panelCount; i += 1) {
    const panel = storyboard.panels[i];
    const imageBuffer = await ensurePanelImage(panelImages[i].buffer, panelWidth, panelHeight);
    composites.push({ input: imageBuffer, left: cfg.padding, top: cursorY });

    const captionLines = wrapText(panel.caption || `Panel ${i + 1}`, Math.max(24, Math.floor(panelWidth / 18)), 3);
    composites.push({
      input: buildTextBlockSvg({
        width: panelWidth,
        height: captionHeight,
        title: `Panel ${i + 1}`,
        subtitle: '',
        lines: captionLines,
        background: '#ffffff'
      }),
      left: cfg.padding,
      top: cursorY + panelHeight
    });

    cursorY += panelHeight + captionHeight + cfg.gap;
  }

  if (cfg.footer_height > 0) {
    composites.push({
      input: buildTextBlockSvg({
        width: panelWidth,
        height: cfg.footer_height,
        title: '',
        subtitle: '',
        lines: [cfg.brand || 'Made with Web2Comics Engine'],
        background: '#f1f5f9'
      }),
      left: cfg.padding,
      top: totalHeight - cfg.padding - cfg.footer_height
    });
  }

  const finalBuffer = await base.composite(composites).png().toBuffer();
  const resolvedOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, finalBuffer);

  return {
    outputPath: resolvedOutput,
    width,
    height: totalHeight,
    bytes: finalBuffer.length
  };
}

module.exports = {
  composeComicSheet,
  wrapText
};
