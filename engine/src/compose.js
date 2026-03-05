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

function resolveGridColumns(panelCount, explicitColumns = 0) {
  const count = Math.max(1, Number(panelCount || 0));
  const requested = Math.max(0, Number(explicitColumns || 0));
  if (requested >= 1) return Math.min(count, Math.floor(requested));
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

async function composeComicSheet({ storyboard, panelImages, source, outputConfig, outputPath }) {
  const cfg = outputConfig;
  const panelCount = storyboard.panels.length;
  const layout = String(cfg.layout || 'column').trim().toLowerCase();
  const width = cfg.width;
  const panelWidth = width - (cfg.padding * 2);
  const panelHeight = cfg.panel_height;
  const captionHeight = cfg.caption_height;
  const headerHeight = Number(cfg.header_height || 0);
  const footerHeight = Number(cfg.footer_height || 0);
  const gap = Number(cfg.gap || 0);
  const padding = Number(cfg.padding || 0);
  const useGrid = layout === 'grid';
  const columns = useGrid ? resolveGridColumns(panelCount, cfg.grid_columns) : 1;
  const rows = useGrid ? Math.ceil(panelCount / columns) : panelCount;
  const imagePanelWidth = useGrid
    ? Math.floor((width - (padding * 2) - ((columns - 1) * gap)) / columns)
    : panelWidth;

  const totalHeight = useGrid
    ? (
        padding +
        headerHeight +
        (headerHeight > 0 ? gap : 0) +
        (rows * panelHeight) +
        ((rows - 1) * gap) +
        (footerHeight > 0 ? gap : 0) +
        footerHeight +
        padding
      )
    : (
        padding +
        headerHeight +
        gap +
        (panelCount * (panelHeight + captionHeight + gap)) +
        footerHeight +
        padding
      );

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
      height: headerHeight,
      title: storyboard.title || 'Comic Summary',
      subtitle: source,
      lines: headerLines,
      background: '#ffffff'
    }),
    left: padding,
    top: padding
  });

  let cursorY = padding + headerHeight + (headerHeight > 0 ? gap : 0);

  for (let i = 0; i < panelCount; i += 1) {
    const panel = storyboard.panels[i];
    const imageBuffer = await ensurePanelImage(panelImages[i].buffer, imagePanelWidth, panelHeight);
    if (useGrid) {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const left = padding + (col * (imagePanelWidth + gap));
      const top = cursorY + (row * (panelHeight + gap));
      composites.push({ input: imageBuffer, left, top });
      continue;
    }
    composites.push({ input: imageBuffer, left: padding, top: cursorY });

    const panelLabel = `${i + 1}.`;
    const captionLines = wrapText(panel.caption || panelLabel, Math.max(24, Math.floor(panelWidth / 18)), 3);
    composites.push({
      input: buildTextBlockSvg({
        width: panelWidth,
        height: captionHeight,
        title: panelLabel,
        subtitle: '',
        lines: captionLines,
        background: '#ffffff'
      }),
      left: padding,
      top: cursorY + panelHeight
    });

    cursorY += panelHeight + captionHeight + gap;
  }

  if (footerHeight > 0) {
    composites.push({
      input: buildTextBlockSvg({
        width: panelWidth,
        height: footerHeight,
        title: '',
        subtitle: '',
        lines: [cfg.brand || 'Made with Web2Comics Engine'],
        background: '#f1f5f9'
      }),
      left: padding,
      top: totalHeight - padding - footerHeight
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
