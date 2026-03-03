#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT_DIR, 'popup', 'assets');
const OUT_PNG = path.join(OUT_DIR, 'comicify-hero.png');
const OUT_JSON = path.join(OUT_DIR, 'comicify-hero.json');

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
  'Create a polished illustration for a "Comicify" button in a Chrome extension.',
  'Scene: a person looking at a computer display and sketching a comic page.',
  'The display should show comic-like panels and speech bubbles as abstract shapes.',
  'Style: modern digital illustration, vibrant, clean, dynamic composition.',
  'No text, no logos, no watermark.',
  'Center-focused composition suitable for a rounded square icon crop.'
].join(' ');

async function main() {
  if (!API_KEY) {
    throw new Error('Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY in environment.');
  }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

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
  fs.writeFileSync(OUT_PNG, imageBuffer);

  const responseText = parts
    .filter((p) => p && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n')
    .trim();
  fs.writeFileSync(OUT_JSON, JSON.stringify({ model: MODEL, prompt: PROMPT, responseText }, null, 2));

  console.log(`Generated: ${OUT_PNG}`);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
