const DEFAULT_TIMEOUT_MS = 120000;

function withTimeout(promise, timeoutMs, label) {
  const ms = Math.max(1000, Number(timeoutMs || DEFAULT_TIMEOUT_MS));
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label || 'Request'} timed out after ${ms}ms`));
    }, ms);

    Promise.resolve(promise).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function fetchJson(url, init, timeoutMs, label) {
  const response = await withTimeout(fetch(url, init), timeoutMs, label);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {}
  if (!response.ok) {
    const message = (json && (json.error?.message || json.message || json.result?.error)) || text.slice(0, 600);
    throw new Error(`${label || 'Request'} failed (${response.status}): ${message}`);
  }
  return { response, text, json };
}

async function fetchBufferFromUrl(url, timeoutMs, label) {
  const res = await withTimeout(fetch(url), timeoutMs, label || 'Image download');
  if (!res.ok) throw new Error(`Image download failed (${res.status})`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function resolveProviderValue(providerConfig, key, fallbackEnvKey) {
  if (providerConfig && providerConfig[key]) return String(providerConfig[key]);
  if (providerConfig && providerConfig[`${key}_env`]) {
    const envKey = String(providerConfig[`${key}_env`]);
    if (process.env[envKey]) return String(process.env[envKey]);
  }
  if (fallbackEnvKey && process.env[fallbackEnvKey]) return String(process.env[fallbackEnvKey]);
  return '';
}

function getGeminiText(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p?.text || '').filter(Boolean).join(' ').trim();
}

function decodeDataUri(value) {
  const raw = String(value || '');
  const match = raw.match(/^data:[^;]+;base64,(.+)$/i);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

async function generateTextWithProvider(providerConfig, prompt, runtimeConfig) {
  const provider = String(providerConfig.provider || '').toLowerCase();
  const model = String(providerConfig.model || '').trim();
  const timeoutMs = Number(runtimeConfig.timeout_ms || DEFAULT_TIMEOUT_MS);

  if (provider === 'gemini') {
    const apiKey = resolveProviderValue(providerConfig, 'api_key', 'GEMINI_API_KEY');
    if (!apiKey) throw new Error('Missing GEMINI_API_KEY for Gemini text provider');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const { json } = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4096 }
      })
    }, timeoutMs, 'Gemini text');
    const text = getGeminiText(json);
    if (!text) throw new Error('Gemini text response was empty');
    return text;
  }

  if (provider === 'openai') {
    const apiKey = resolveProviderValue(providerConfig, 'api_key', 'OPENAI_API_KEY');
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY for OpenAI text provider');
    const { json } = await fetchJson('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    }, timeoutMs, 'OpenAI text');
    const text = String(json?.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('OpenAI text response was empty');
    return text;
  }

  if (provider === 'openrouter') {
    const apiKey = resolveProviderValue(providerConfig, 'api_key', 'OPENROUTER_API_KEY');
    if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY for OpenRouter text provider');
    const { json } = await fetchJson('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://web2comics.local',
        'X-Title': 'Web2Comics Engine'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    }, timeoutMs, 'OpenRouter text');
    const text = String(json?.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('OpenRouter text response was empty');
    return text;
  }

  if (provider === 'cloudflare') {
    const accountId = resolveProviderValue(providerConfig, 'account_id', 'CLOUDFLARE_ACCOUNT_ID');
    const apiToken = resolveProviderValue(providerConfig, 'api_token', 'CLOUDFLARE_API_TOKEN');
    if (!accountId || !apiToken) throw new Error('Missing CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN for Cloudflare text provider');
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    const { json } = await fetchJson(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt })
    }, timeoutMs, 'Cloudflare text');
    const text = String(json?.result?.response || json?.result?.text || '').trim();
    if (!text) throw new Error('Cloudflare text response was empty');
    return text;
  }

  if (provider === 'huggingface') {
    const apiKey = resolveProviderValue(providerConfig, 'api_key', 'HUGGINGFACE_INFERENCE_API_TOKEN') || process.env.HUGGINGFACE_API_KEY || '';
    if (!apiKey) throw new Error('Missing HUGGINGFACE_INFERENCE_API_TOKEN for Hugging Face text provider');
    const { json } = await fetchJson(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 512 } })
    }, timeoutMs, 'Hugging Face text');
    const text = Array.isArray(json)
      ? String(json[0]?.generated_text || '').trim()
      : String(json?.generated_text || json?.[0]?.generated_text || '').trim();
    if (!text) throw new Error('Hugging Face text response was empty');
    return text;
  }

  throw new Error(`Unsupported text provider: ${provider}`);
}

async function generateImageWithProvider(providerConfig, prompt, runtimeConfig) {
  const provider = String(providerConfig.provider || '').toLowerCase();
  const model = String(providerConfig.model || '').trim();
  const timeoutMs = Number(runtimeConfig.timeout_ms || DEFAULT_TIMEOUT_MS);

  if (provider === 'gemini') {
    const apiKey = resolveProviderValue(providerConfig, 'api_key', 'GEMINI_API_KEY');
    if (!apiKey) throw new Error('Missing GEMINI_API_KEY for Gemini image provider');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const { json } = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['image', 'text'], maxOutputTokens: 512 }
      })
    }, timeoutMs, 'Gemini image');
    const parts = json?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p?.inlineData?.data);
    if (!imagePart?.inlineData?.data) throw new Error('Gemini image response did not include inline image bytes');
    return {
      buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
      mimeType: imagePart.inlineData.mimeType || 'image/png'
    };
  }

  if (provider === 'openai') {
    const apiKey = resolveProviderValue(providerConfig, 'api_key', 'OPENAI_API_KEY');
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY for OpenAI image provider');
    const size = String(providerConfig.size || '1024x1024');
    const { json } = await fetchJson('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        prompt,
        size,
        quality: String(providerConfig.quality || 'standard'),
        n: 1
      })
    }, timeoutMs, 'OpenAI image');
    const item = json?.data?.[0] || {};
    if (item.b64_json) {
      return { buffer: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png' };
    }
    if (item.url) {
      const buffer = await fetchBufferFromUrl(item.url, timeoutMs, 'OpenAI image URL');
      return { buffer, mimeType: 'image/png' };
    }
    throw new Error('OpenAI image response had no image data');
  }

  if (provider === 'openrouter') {
    const apiKey = resolveProviderValue(providerConfig, 'api_key', 'OPENROUTER_API_KEY');
    if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY for OpenRouter image provider');
    const { json } = await fetchJson('https://openrouter.ai/api/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://web2comics.local',
        'X-Title': 'Web2Comics Engine'
      },
      body: JSON.stringify({
        model,
        prompt,
        size: String(providerConfig.size || '1024x1024'),
        n: 1
      })
    }, timeoutMs, 'OpenRouter image');
    const item = json?.data?.[0] || {};
    if (item.b64_json) return { buffer: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png' };
    if (item.url) return { buffer: await fetchBufferFromUrl(item.url, timeoutMs, 'OpenRouter image URL'), mimeType: 'image/png' };
    throw new Error('OpenRouter image response had no image data');
  }

  if (provider === 'cloudflare') {
    const accountId = resolveProviderValue(providerConfig, 'account_id', 'CLOUDFLARE_ACCOUNT_ID');
    const apiToken = resolveProviderValue(providerConfig, 'api_token', 'CLOUDFLARE_API_TOKEN');
    if (!accountId || !apiToken) throw new Error('Missing CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN for Cloudflare image provider');
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    const { json } = await fetchJson(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt })
    }, timeoutMs, 'Cloudflare image');
    const imagePayload = json?.result?.image || json?.result?.output?.[0] || '';
    if (!imagePayload) throw new Error('Cloudflare image response had no image payload');
    const dataUriBuffer = decodeDataUri(imagePayload);
    if (dataUriBuffer) return { buffer: dataUriBuffer, mimeType: 'image/png' };
    return { buffer: Buffer.from(String(imagePayload), 'base64'), mimeType: 'image/png' };
  }

  if (provider === 'huggingface') {
    const apiKey = resolveProviderValue(providerConfig, 'api_key', 'HUGGINGFACE_INFERENCE_API_TOKEN') || process.env.HUGGINGFACE_API_KEY || '';
    if (!apiKey) throw new Error('Missing HUGGINGFACE_INFERENCE_API_TOKEN for Hugging Face image provider');
    const response = await withTimeout(fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: prompt })
    }), timeoutMs, 'Hugging Face image');
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Hugging Face image failed (${response.status}): ${text.slice(0, 400)}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: response.headers.get('content-type') || 'image/png'
    };
  }

  throw new Error(`Unsupported image provider: ${provider}`);
}

module.exports = {
  generateTextWithProvider,
  generateImageWithProvider
};
