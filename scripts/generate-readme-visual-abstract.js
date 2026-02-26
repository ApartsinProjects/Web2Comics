const fs = require('fs');
const path = require('path');

function loadLocalEnvFile() {
  const envPath = path.resolve(__dirname, '../.env.e2e.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    process.env[key] = value;
  }
}

loadLocalEnvFile();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-exp-image-generation';

if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY missing (.env.e2e.local)');
  process.exit(1);
}

const prompt = [
  'Create a polished visual abstract hero image for a Chrome extension named Web2Comics.',
  'Wide banner composition, clean modern flat illustration, friendly and professional.',
  'Show a left-to-right workflow with 4 stages:',
  '1) a web page/article in a browser tab,',
  '2) an AI processing/storyboard stage (robot/AI spark icon),',
  '3) comic strip panels being generated,',
  '4) a side panel viewer and an exported PNG image.',
  'Use bright colors, strong contrast, white or very light background, subtle gradients.',
  'No logos from other companies. No watermarks. No tiny unreadable text.',
  'If text is included, keep it minimal and legible: "Web Page", "AI", "Comic", "Export".',
  'Style should feel inviting for a README visual abstract.',
  '16:9 landscape.'
].join(' ');

async function main() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['image', 'text'],
        maxOutputTokens: 1024
      }
    })
  });

  const raw = await res.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch (_) {}

  if (!res.ok) {
    console.error(`Gemini request failed: ${res.status}`);
    console.error(raw.slice(0, 2000));
    process.exit(1);
  }

  const parts = json?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p?.inlineData?.data);
  if (!imagePart) {
    console.error('No image returned by Gemini.');
    console.error(JSON.stringify(json, null, 2).slice(0, 4000));
    process.exit(1);
  }

  const mimeType = imagePart.inlineData?.mimeType || 'image/png';
  const ext = mimeType.includes('jpeg') ? 'jpg' : 'png';
  const outDir = path.resolve(__dirname, '../docs');
  fs.mkdirSync(outDir, { recursive: true });

  const outImage = path.join(outDir, `visual-abstract-gemini.${ext}`);
  fs.writeFileSync(outImage, Buffer.from(imagePart.inlineData.data, 'base64'));

  const outMeta = path.join(outDir, 'visual-abstract-gemini.json');
  fs.writeFileSync(
    outMeta,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        provider: 'gemini',
        model: MODEL,
        prompt,
        mimeType,
        textParts: parts.filter((p) => p?.text).map((p) => p.text)
      },
      null,
      2
    )
  );

  console.log(`Saved image: ${path.relative(path.resolve(__dirname, '..'), outImage)}`);
  console.log(`Saved metadata: ${path.relative(path.resolve(__dirname, '..'), outMeta)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
