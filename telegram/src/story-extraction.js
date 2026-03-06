const path = require('path');
const {
  classifyMessageInput,
  isLikelyWebPageUrl,
  isLikelyPdfUrl,
  isLikelyImageUrl,
  isLikelyAudioUrl,
  extractFirstPdfUrlLikeToken,
  extractFirstImageUrlLikeToken,
  extractFirstAudioUrlLikeToken
} = require('./message-utils');
const { extractStoryFromUrlText } = require('./generate');
const { extractPdfStory, extractPdfFromTelegramDocument, getConfiguredPdfExtractor } = require('./pdf-extract');

const IMAGE_EXTRACTOR_VALUES = ['gemini', 'openai'];
const IMAGE_EXTRACTOR_SET = new Set(IMAGE_EXTRACTOR_VALUES);
const VOICE_EXTRACTOR_VALUES = ['assemblyai'];
const VOICE_EXTRACTOR_SET = new Set(VOICE_EXTRACTOR_VALUES);
const IMAGE_STORY_MIN_CHARS = 120;
const VOICE_STORY_MIN_CHARS = 40;

function normalizeImageExtractor(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'gemini';
  if (IMAGE_EXTRACTOR_SET.has(value)) return value;
  return 'gemini';
}

function getConfiguredImageExtractor(config) {
  return normalizeImageExtractor(config?.generation?.image_extractor || 'gemini');
}

function normalizeVoiceExtractor(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'assemblyai';
  if (VOICE_EXTRACTOR_SET.has(value)) return value;
  return 'assemblyai';
}

function getConfiguredVoiceExtractor(config) {
  return normalizeVoiceExtractor(config?.generation?.voice_extractor || 'assemblyai');
}

function getImageDocumentFromMessage(message) {
  const doc = message?.document;
  if (!doc || typeof doc !== 'object') return null;
  const mime = String(doc?.mime_type || '').trim().toLowerCase();
  if (mime.startsWith('image/')) return doc;
  const fileName = String(doc?.file_name || '').trim().toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName)) return doc;
  return null;
}

function getPhotoFromMessage(message) {
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  if (!photos.length) return null;
  return photos[photos.length - 1] || null;
}

function detectStoryExtractionSource(message, text) {
  const value = String(text || '').trim();
  const parsed = classifyMessageInput(value);
  const parsedUrl = parsed.kind === 'url' ? String(parsed.value || '').trim() : '';
  if (parsedUrl) {
    if (isLikelyPdfUrl(parsedUrl)) {
      return { type: 'pdf_url', url: parsedUrl, fileName: path.basename(String(parsedUrl).split('?')[0] || 'input.pdf') || 'input.pdf' };
    }
    if (isLikelyImageUrl(parsedUrl)) {
      return { type: 'image_url', url: parsedUrl, fileName: path.basename(String(parsedUrl).split('?')[0] || 'image') || 'image' };
    }
    if (isLikelyWebPageUrl(parsedUrl)) {
      return { type: 'html_url', url: parsedUrl };
    }
  }

  const audioUrl = (parsed.kind === 'url' && isLikelyAudioUrl(parsed.value)) ? parsed.value : extractFirstAudioUrlLikeToken(value);
  if (audioUrl) return { type: 'audio_url', url: audioUrl, fileName: path.basename(String(audioUrl).split('?')[0] || 'input-audio') || 'input-audio' };
  const pdfDocument = message?.document && String(message?.document?.mime_type || '').toLowerCase() === 'application/pdf'
    ? message.document
    : null;
  if (pdfDocument) {
    return { type: 'pdf_file', document: pdfDocument, fileName: String(pdfDocument?.file_name || 'telegram.pdf') };
  }
  const audioDocument = message?.document && String(message?.document?.mime_type || '').toLowerCase().startsWith('audio/')
    ? message.document
    : null;
  if (audioDocument) {
    return { type: 'audio_file', document: audioDocument, fileName: String(audioDocument?.file_name || 'telegram-audio') };
  }
  const voice = message?.voice && typeof message.voice === 'object' ? message.voice : null;
  if (voice) {
    return { type: 'audio_file', document: voice, fileName: `telegram-voice-${String(voice?.file_unique_id || voice?.file_id || 'voice')}.ogg` };
  }
  const imageDocument = getImageDocumentFromMessage(message);
  if (imageDocument) {
    return { type: 'image_file', document: imageDocument, fileName: String(imageDocument?.file_name || 'telegram-image') };
  }
  const photo = getPhotoFromMessage(message);
  if (photo) {
    return { type: 'image_file', document: photo, fileName: `telegram-photo-${String(photo?.file_unique_id || photo?.file_id || 'image')}.jpg` };
  }

  const pdfUrl = (parsed.kind === 'url' && isLikelyPdfUrl(parsed.value)) ? parsed.value : extractFirstPdfUrlLikeToken(value);
  if (pdfUrl) return { type: 'pdf_url', url: pdfUrl, fileName: path.basename(String(pdfUrl).split('?')[0] || 'input.pdf') || 'input.pdf' };
  const imageUrl = (parsed.kind === 'url' && isLikelyImageUrl(parsed.value)) ? parsed.value : extractFirstImageUrlLikeToken(value);
  if (imageUrl) return { type: 'image_url', url: imageUrl, fileName: path.basename(String(imageUrl).split('?')[0] || 'image') || 'image' };
  if (parsed.kind === 'url' && isLikelyWebPageUrl(parsed.value)) return { type: 'html_url', url: parsed.value };
  if (parsed.kind === 'text') return { type: 'text', text: parsed.value };
  if (!value) return { type: 'empty', text: '' };
  return { type: 'text', text: value };
}

async function fetchBufferWithTimeout(url, init, timeoutMs, label) {
  const ms = Math.max(2000, Number(timeoutMs || 45000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { ...(init || {}), signal: controller.signal });
    const buffer = Buffer.from(await response.arrayBuffer());
    return { response, buffer };
  } catch (error) {
    throw new Error(`${label || 'request'} failed: ${String(error?.message || error)}`);
  } finally {
    clearTimeout(timer);
  }
}

function parseGeminiTextResponse(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => String(p?.text || '')).filter(Boolean).join('\n').trim();
}

async function extractStoryFromImageGemini(imageBytes, fileName, runtime, config) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('Missing GEMINI_API_KEY for image extraction');
  const model = String(config?.generation?.image_extractor_gemini_model || config?.providers?.text?.model || 'gemini-2.5-flash').trim();
  const mime = /\.(png)$/i.test(String(fileName || '')) ? 'image/png' : 'image/jpeg';
  const prompt = [
    'Extract the most interesting coherent story from this image.',
    'Return plain narrative text only (no markdown, no JSON, no bullet list).',
    'Include key actors, scene context, sequence, and implied events.'
  ].join('\n');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: mime, data: imageBytes.toString('base64') } }
          ]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
      }),
      signal: AbortSignal.timeout(Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000)))
    }
  );
  const raw = await res.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch (_) {}
  if (!res.ok) {
    const reason = String(json?.error?.message || raw || `HTTP ${res.status}`).slice(0, 400);
    throw new Error(`Gemini image extraction failed (${res.status}): ${reason}`);
  }
  const text = parseGeminiTextResponse(json);
  if (!text) throw new Error('Gemini image extraction returned empty text');
  return text;
}

async function extractStoryFromImageOpenAI(imageBytes, fileName, runtime, config) {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) throw new Error('Missing OPENAI_API_KEY for image extraction');
  const model = String(config?.generation?.image_extractor_openai_model || 'gpt-4.1-mini').trim();
  const mime = /\.(png)$/i.test(String(fileName || '')) ? 'image/png' : 'image/jpeg';
  const dataUrl = `data:${mime};base64,${imageBytes.toString('base64')}`;
  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Extract the most interesting coherent story from this image. Return plain narrative text only.' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }],
    temperature: 0.2
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000)))
  });
  const raw = await res.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch (_) {}
  if (!res.ok) {
    const reason = String(json?.error?.message || raw || `HTTP ${res.status}`).slice(0, 400);
    throw new Error(`OpenAI image extraction failed (${res.status}): ${reason}`);
  }
  const text = String(json?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('OpenAI image extraction returned empty text');
  return text;
}

async function extractStoryFromImage(input, runtime, config = {}, options = {}) {
  const selected = getConfiguredImageExtractor(config);
  const order = [selected, ...IMAGE_EXTRACTOR_VALUES].filter((v, idx, arr) => v && arr.indexOf(v) === idx);
  const fileName = String(input?.fileName || 'image').trim() || 'image';

  if (String(process.env.RENDER_BOT_FAKE_IMAGE_EXTRACTOR || '').trim().toLowerCase() === 'true') {
    const synthetic = [
      `Story extracted from image (${fileName}).`,
      'A central character notices a visual clue, interprets the scene,',
      'and follows a chain of events to a clear narrative outcome.'
    ].join(' ');
    return { providerSelected: selected, providerUsed: selected, text: synthetic };
  }

  let bytes = input?.imageBytes || null;
  if (!bytes && input?.url) {
    const { response, buffer } = await fetchBufferWithTimeout(
      input.url,
      { method: 'GET', headers: { Accept: 'image/*,*/*;q=0.8' } },
      runtime?.fetchTimeoutMs,
      'image download'
    );
    if (!response.ok) throw new Error(`Image download failed (${response.status})`);
    bytes = buffer;
  }
  if (!bytes || !Buffer.isBuffer(bytes) || !bytes.length) throw new Error('Image extraction input is empty');

  let lastError = null;
  for (const provider of order) {
    try {
      let text = '';
      if (provider === 'gemini') text = await extractStoryFromImageGemini(bytes, fileName, runtime, config);
      else if (provider === 'openai') text = await extractStoryFromImageOpenAI(bytes, fileName, runtime, config);
      else throw new Error(`Unsupported image extractor provider: ${provider}`);

      const out = String(text || '').trim();
      if (out.length < IMAGE_STORY_MIN_CHARS) throw new Error(`Image extraction produced too little text (${out.length} chars)`);
      if (provider !== selected && typeof options.onFallback === 'function') {
        await options.onFallback({ from: selected, to: provider, reason: 'extractor_failure', section: 'image_extraction' });
      }
      return { providerSelected: selected, providerUsed: provider, text: out };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Image extraction failed');
}

async function extractStoryFromAudioAssemblyAI(audioBytes, runtime, config = {}) {
  const apiKey = String(process.env.ASSEMBLYAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('Missing ASSEMBLYAI_API_KEY for voice extraction');
  const speechModelRaw = String(config?.generation?.voice_extractor_assemblyai_model || 'best').trim().toLowerCase();
  // AssemblyAI deprecated `speech_model`; prefer ordered `speech_models`.
  const speechModels = speechModelRaw === 'nano'
    ? ['universal-2']
    : ['universal-3-pro', 'universal-2'];
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/octet-stream'
    },
    body: audioBytes,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const uploadRaw = await uploadRes.text();
  let uploadJson = null;
  try { uploadJson = uploadRaw ? JSON.parse(uploadRaw) : null; } catch (_) {}
  if (!uploadRes.ok) {
    const reason = String(uploadJson?.error || uploadRaw || `HTTP ${uploadRes.status}`).slice(0, 400);
    throw new Error(`AssemblyAI upload failed (${uploadRes.status}): ${reason}`);
  }
  const audioUrl = String(uploadJson?.upload_url || '').trim();
  if (!audioUrl) throw new Error('AssemblyAI upload returned no upload_url');

  const createRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_models: speechModels,
      punctuate: true,
      format_text: true
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const createRaw = await createRes.text();
  let createJson = null;
  try { createJson = createRaw ? JSON.parse(createRaw) : null; } catch (_) {}
  if (!createRes.ok) {
    const reason = String(createJson?.error || createRaw || `HTTP ${createRes.status}`).slice(0, 400);
    throw new Error(`AssemblyAI transcript start failed (${createRes.status}): ${reason}`);
  }
  const transcriptId = String(createJson?.id || '').trim();
  if (!transcriptId) throw new Error('AssemblyAI transcript start returned no id');

  const started = Date.now();
  const maxWaitMs = Math.max(timeoutMs, 90000);
  while ((Date.now() - started) < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      method: 'GET',
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const pollRaw = await pollRes.text();
    let pollJson = null;
    try { pollJson = pollRaw ? JSON.parse(pollRaw) : null; } catch (_) {}
    if (!pollRes.ok) {
      const reason = String(pollJson?.error || pollRaw || `HTTP ${pollRes.status}`).slice(0, 400);
      throw new Error(`AssemblyAI transcript poll failed (${pollRes.status}): ${reason}`);
    }
    const status = String(pollJson?.status || '').trim().toLowerCase();
    if (status === 'completed') {
      const text = String(pollJson?.text || '').trim();
      if (!text) throw new Error('AssemblyAI transcript returned empty text');
      return text;
    }
    if (status === 'error') {
      const reason = String(pollJson?.error || 'transcription error').trim();
      throw new Error(`AssemblyAI transcription failed: ${reason}`);
    }
  }
  throw new Error('AssemblyAI transcription timed out');
}

async function extractStoryFromAudio(input, runtime, config = {}, options = {}) {
  const selected = getConfiguredVoiceExtractor(config);
  const order = [selected, ...VOICE_EXTRACTOR_VALUES].filter((v, idx, arr) => v && arr.indexOf(v) === idx);

  if (String(process.env.RENDER_BOT_FAKE_VOICE_EXTRACTOR || '').trim().toLowerCase() === 'true') {
    const synthetic = [
      'Transcribed voice story:',
      'a narrator introduces a challenge, explains key moments,',
      'and concludes with a clear outcome that can be storyboarded.'
    ].join(' ');
    return { providerSelected: selected, providerUsed: selected, text: synthetic };
  }

  let bytes = input?.audioBytes || null;
  if (!bytes && input?.url) {
    const { response, buffer } = await fetchBufferWithTimeout(
      input.url,
      { method: 'GET', headers: { Accept: 'audio/*,*/*;q=0.8' } },
      runtime?.fetchTimeoutMs,
      'audio download'
    );
    if (!response.ok) throw new Error(`Audio download failed (${response.status})`);
    bytes = buffer;
  }
  if (!bytes || !Buffer.isBuffer(bytes) || !bytes.length) throw new Error('Voice extraction input is empty');

  let lastError = null;
  for (const provider of order) {
    try {
      let text = '';
      if (provider === 'assemblyai') text = await extractStoryFromAudioAssemblyAI(bytes, runtime, config);
      else throw new Error(`Unsupported voice extractor provider: ${provider}`);
      const out = String(text || '').trim();
      if (out.length < VOICE_STORY_MIN_CHARS) throw new Error(`Voice extraction produced too little text (${out.length} chars)`);
      if (provider !== selected && typeof options.onFallback === 'function') {
        await options.onFallback({ from: selected, to: provider, reason: 'extractor_failure', section: 'voice_extraction' });
      }
      return { providerSelected: selected, providerUsed: provider, text: out };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Voice extraction failed');
}

async function extractImageFromTelegramMessage(api, imageLike) {
  if (String(process.env.RENDER_BOT_FAKE_IMAGE_EXTRACTOR || '').trim().toLowerCase() === 'true') {
    return {
      imageBytes: Buffer.from('fake-image-bytes', 'utf8'),
      fileName: 'fake-image.jpg'
    };
  }
  const fileId = String(imageLike?.file_id || '').trim();
  if (!fileId) throw new Error('Telegram image missing file_id');
  const info = await api.getFile(fileId);
  const filePath = String(info?.file_path || '').trim();
  if (!filePath) throw new Error('Telegram image getFile returned no file_path');
  const bytes = await api.downloadFile(filePath);
  return {
    imageBytes: bytes,
    fileName: path.basename(filePath) || 'telegram-image'
  };
}

async function extractAudioFromTelegramMessage(api, audioLike) {
  if (String(process.env.RENDER_BOT_FAKE_VOICE_EXTRACTOR || '').trim().toLowerCase() === 'true') {
    return {
      audioBytes: Buffer.from('fake-audio-bytes', 'utf8'),
      fileName: 'fake-audio.ogg'
    };
  }
  const fileId = String(audioLike?.file_id || '').trim();
  if (!fileId) throw new Error('Telegram audio missing file_id');
  const info = await api.getFile(fileId);
  const filePath = String(info?.file_path || '').trim();
  if (!filePath) throw new Error('Telegram audio getFile returned no file_path');
  const bytes = await api.downloadFile(filePath);
  return {
    audioBytes: bytes,
    fileName: path.basename(filePath) || 'telegram-audio'
  };
}

async function extractStoryFromSource(source, context = {}) {
  const runtime = context.runtime || {};
  const config = context.config || {};
  if (!source || source.type === 'empty') throw new Error('Empty message. Send plain text, URL, PDF, or image.');

  if (source.type === 'text') {
    return { sourceType: 'text', text: String(source.text || '').trim(), providerSelected: '', providerUsed: '' };
  }

  if (source.type === 'html_url') {
    const out = await extractStoryFromUrlText(source.url, runtime, config, {
      onExtractorFallback: context.onExtractorFallback
    });
    return {
      sourceType: 'html_url',
      text: String(out.text || '').trim(),
      providerSelected: String(out.extractorSelected || '').trim(),
      providerUsed: String(out.extractorUsed || '').trim()
    };
  }

  if (source.type === 'pdf_url' || source.type === 'pdf_file') {
    const input = source.type === 'pdf_url'
      ? { url: source.url, fileName: source.fileName || 'input.pdf' }
      : { pdfBytes: source.pdfBytes, fileName: source.fileName || 'input.pdf' };
    const out = await extractPdfStory(input, runtime, config, { onFallback: context.onPdfFallback });
    return {
      sourceType: source.type,
      text: String(out.text || '').trim(),
      providerSelected: String(out.providerSelected || getConfiguredPdfExtractor(config)).trim(),
      providerUsed: String(out.providerUsed || getConfiguredPdfExtractor(config)).trim()
    };
  }

  if (source.type === 'image_url' || source.type === 'image_file') {
    const input = source.type === 'image_url'
      ? { url: source.url, fileName: source.fileName || 'image' }
      : { imageBytes: source.imageBytes, fileName: source.fileName || 'image' };
    const out = await extractStoryFromImage(input, runtime, config, { onFallback: context.onImageFallback });
    return {
      sourceType: source.type,
      text: String(out.text || '').trim(),
      providerSelected: String(out.providerSelected || getConfiguredImageExtractor(config)).trim(),
      providerUsed: String(out.providerUsed || getConfiguredImageExtractor(config)).trim()
    };
  }

  if (source.type === 'audio_url' || source.type === 'audio_file') {
    const input = source.type === 'audio_url'
      ? { url: source.url, fileName: source.fileName || 'audio' }
      : { audioBytes: source.audioBytes, fileName: source.fileName || 'audio' };
    const out = await extractStoryFromAudio(input, runtime, config, { onFallback: context.onVoiceFallback });
    return {
      sourceType: source.type,
      text: String(out.text || '').trim(),
      providerSelected: String(out.providerSelected || getConfiguredVoiceExtractor(config)).trim(),
      providerUsed: String(out.providerUsed || getConfiguredVoiceExtractor(config)).trim()
    };
  }

  throw new Error(`Unsupported extraction source type: ${String(source.type)}`);
}

module.exports = {
  IMAGE_EXTRACTOR_VALUES,
  VOICE_EXTRACTOR_VALUES,
  normalizeImageExtractor,
  normalizeVoiceExtractor,
  getConfiguredImageExtractor,
  getConfiguredVoiceExtractor,
  detectStoryExtractionSource,
  extractStoryFromSource,
  extractImageFromTelegramMessage,
  extractAudioFromTelegramMessage,
  extractPdfFromTelegramDocument
};
