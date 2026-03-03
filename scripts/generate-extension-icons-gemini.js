#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(ROOT_DIR, 'icons');
const MASTER_PNG = path.join(ICONS_DIR, 'icon-master-gemini.png');
const MASTER_JSON = path.join(ICONS_DIR, 'icon-master-gemini.json');

function loadLocalEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env.e2e.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    process.env[key] = value;
  }
}

loadLocalEnvFile();

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-exp-image-generation';
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

const PROMPT = [
  'Create a premium Chrome extension app icon for "Web2Comics".',
  'Primary symbol: a bold electric thunderbolt merged with a subtle AI circuit motif.',
  'Style: modern, minimal, vector-like, crisp geometric edges.',
  'Composition: centered, one dominant symbol, high contrast, no tiny details, no text.',
  'Palette: deep navy background, neon cyan + electric yellow highlights, small white accents.',
  'Mood: energetic, intelligent, creative.',
  'Output must be clean and legible at 16x16 toolbar size.',
  'Square app icon, no watermark, no border, no mockup.'
].join(' ');

async function generateMasterIcon() {
  if (!API_KEY) {
    throw new Error('Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY in environment.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(API_KEY)}`;
  const payload = {
    contents: [{ parts: [{ text: PROMPT }] }],
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 4096,
      responseModalities: ['image', 'text']
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const imagePart = parts.find((p) => p && p.inlineData && p.inlineData.data);
  if (!imagePart) {
    throw new Error('Gemini response did not contain inline image data.');
  }

  const imageBuffer = Buffer.from(String(imagePart.inlineData.data), 'base64');
  fs.writeFileSync(MASTER_PNG, imageBuffer);

  const responseText = parts
    .filter((p) => p && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n')
    .trim();

  fs.writeFileSync(MASTER_JSON, JSON.stringify({
    model: MODEL,
    prompt: PROMPT,
    responseText
  }, null, 2));
}

function exportPngSizes() {
  const pythonCode = `
from PIL import Image
from pathlib import Path

master = Path(r"${MASTER_PNG.replace(/\\/g, '\\\\')}")
icons_dir = master.parent
sizes = [16, 32, 48, 128, 256]

img = Image.open(master).convert("RGBA")

for size in sizes:
    out = img.resize((size, size), Image.Resampling.LANCZOS)
    out.save(icons_dir / f"icon{size}.png", format="PNG")
print("exported", ",".join(str(s) for s in sizes))
`;

  const result = spawnSync('python', ['-c', pythonCode], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    encoding: 'utf-8'
  });
  if (result.status !== 0) {
    throw new Error('Failed exporting icon PNG sizes with Python/Pillow.');
  }
}

async function main() {
  if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });
  await generateMasterIcon();
  exportPngSizes();
  console.log('Icon generation complete.');
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
