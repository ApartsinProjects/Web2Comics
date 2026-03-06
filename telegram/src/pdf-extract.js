const path = require('path');

const PDF_EXTRACTOR_VALUES = ['llamaparse', 'unstructured'];
const PDF_EXTRACTOR_SET = new Set(PDF_EXTRACTOR_VALUES);
const PDF_MIN_TEXT_CHARS = 120;

function normalizePdfExtractor(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'llamaparse';
  if (value === 'llama' || value === 'llama-parse') return 'llamaparse';
  if (value === 'unstruct' || value === 'unstructured-io') return 'unstructured';
  if (PDF_EXTRACTOR_SET.has(value)) return value;
  return 'llamaparse';
}

function getConfiguredPdfExtractor(config) {
  return normalizePdfExtractor(config?.generation?.pdf_extractor || 'llamaparse');
}

function getLlamaParseApiKey() {
  const key = String(process.env.LLAMA_CLOUD_API_KEY || process.env.LLAMAPARSE_API_KEY || '').trim();
  if (!key) throw new Error('Missing LLAMA_CLOUD_API_KEY for LlamaParse PDF extractor');
  return key;
}

function normalizeBaseUrl() {
  const raw = String(process.env.LLAMAPARSE_BASE_URL || process.env.LLAMA_CLOUD_BASE_URL || 'https://api.cloud.llamaindex.ai').trim();
  return raw.replace(/\/+$/, '');
}

function getUnstructuredApiKey() {
  const key = String(process.env.UNSTRUCTURED_API_KEY || '').trim();
  if (!key) throw new Error('Missing UNSTRUCTURED_API_KEY for Unstructured PDF extractor');
  return key;
}

function normalizeUnstructuredBaseUrl() {
  const raw = String(process.env.UNSTRUCTURED_BASE_URL || 'https://api.unstructuredapp.io').trim();
  return raw.replace(/\/+$/, '');
}

async function fetchTextWithTimeout(url, init, timeoutMs, label) {
  const ms = Math.max(2000, Number(timeoutMs || 45000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { ...(init || {}), signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    throw new Error(`${label || 'request'} failed: ${String(error?.message || error)}`);
  } finally {
    clearTimeout(timer);
  }
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

function parseJsonLoose(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch (_) {
    return null;
  }
}

function extractLlamaParseText(json) {
  if (!json || typeof json !== 'object') return '';
  const candidates = [
    json?.text,
    json?.markdown,
    json?.content,
    json?.result?.text,
    json?.result?.markdown,
    json?.result?.content,
    json?.output?.text,
    json?.output?.markdown,
    json?.job_result?.text,
    json?.job_result?.markdown
  ];
  for (const candidate of candidates) {
    const out = String(candidate || '').trim();
    if (out) return out;
  }
  return '';
}

function resolveLlamaParseJobId(json) {
  const id = String(
    json?.job_id
    || json?.id
    || json?.result?.job_id
    || json?.job?.id
    || ''
  ).trim();
  return id;
}

async function pollLlamaParseResult(baseUrl, key, jobId, timeoutMs) {
  const startedAt = Date.now();
  const pollEveryMs = 2500;
  const maxWaitMs = Math.max(15000, Number(timeoutMs || 90000));
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' };
  const resultUrls = [
    `${baseUrl}/api/v1/parsing/job/${encodeURIComponent(jobId)}/result/markdown`,
    `${baseUrl}/api/v1/parsing/job/${encodeURIComponent(jobId)}/result/text`,
    `${baseUrl}/api/v1/parsing/job/${encodeURIComponent(jobId)}`,
    `${baseUrl}/api/v2alpha1/parsing/job/${encodeURIComponent(jobId)}/result/markdown`,
    `${baseUrl}/api/v2alpha1/parsing/job/${encodeURIComponent(jobId)}`
  ];

  while ((Date.now() - startedAt) < maxWaitMs) {
    for (const url of resultUrls) {
      const { response, text } = await fetchTextWithTimeout(url, { method: 'GET', headers }, timeoutMs, 'llamaparse poll');
      if (!response.ok) continue;
      const json = parseJsonLoose(text);
      if (json) {
        const parsed = extractLlamaParseText(json);
        if (parsed) return parsed;
      }
      const plain = String(text || '').trim();
      if (plain && !plain.startsWith('{') && !plain.startsWith('[')) return plain;
    }
    await new Promise((resolve) => setTimeout(resolve, pollEveryMs));
  }

  throw new Error(`LlamaParse result timeout for job ${jobId}`);
}

async function uploadPdfToLlamaParse(pdfBuffer, fileName, runtime = {}) {
  const key = getLlamaParseApiKey();
  const baseUrl = normalizeBaseUrl();
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const form = new FormData();
  const safeName = String(fileName || 'input.pdf').trim() || 'input.pdf';
  form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), safeName);

  const uploadUrls = [
    `${baseUrl}/api/v1/parsing/upload`,
    `${baseUrl}/api/v2alpha1/parsing/upload`
  ];
  let lastError = null;
  for (const url of uploadUrls) {
    const { response, text } = await fetchTextWithTimeout(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form
    }, timeoutMs, 'llamaparse upload');
    const json = parseJsonLoose(text);
    if (!response.ok) {
      const reason = String(json?.error || json?.message || text || `HTTP ${response.status}`).slice(0, 300);
      lastError = new Error(`LlamaParse upload failed (${response.status}): ${reason}`);
      continue;
    }
    const immediate = json ? extractLlamaParseText(json) : '';
    if (immediate) return immediate;
    const jobId = resolveLlamaParseJobId(json || {});
    if (jobId) return pollLlamaParseResult(baseUrl, key, jobId, timeoutMs * 2);
    const raw = String(text || '').trim();
    if (raw && !raw.startsWith('{') && !raw.startsWith('[')) return raw;
    lastError = new Error('LlamaParse upload succeeded but returned no parsable text');
  }
  throw lastError || new Error('LlamaParse upload failed');
}

function extractUnstructuredText(json) {
  if (!json) return '';
  const rows = Array.isArray(json)
    ? json
    : (Array.isArray(json?.elements) ? json.elements : []);
  if (!rows.length) return '';
  return rows
    .map((row) => String(row?.text || row?.content || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function resolveUnstructuredStrategy(config = {}) {
  const raw = String(config?.generation?.pdf_extractor_unstructured_strategy || 'auto').trim().toLowerCase();
  if (raw === 'hi_res' || raw === 'ocr_only' || raw === 'fast' || raw === 'auto') return raw;
  return 'auto';
}

async function uploadPdfToUnstructured(pdfBuffer, fileName, runtime = {}, config = {}) {
  const key = getUnstructuredApiKey();
  const baseUrl = normalizeUnstructuredBaseUrl();
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const strategy = resolveUnstructuredStrategy(config);
  const form = new FormData();
  const safeName = String(fileName || 'input.pdf').trim() || 'input.pdf';
  form.append('files', new Blob([pdfBuffer], { type: 'application/pdf' }), safeName);
  form.append('strategy', strategy);

  const { response, text } = await fetchTextWithTimeout(`${baseUrl}/general/v0/general`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'unstructured-api-key': key
    },
    body: form
  }, timeoutMs, 'unstructured upload');

  const json = parseJsonLoose(text);
  if (!response.ok) {
    const reason = String(json?.error || json?.message || text || `HTTP ${response.status}`).slice(0, 300);
    throw new Error(`Unstructured upload failed (${response.status}): ${reason}`);
  }
  const extracted = extractUnstructuredText(json);
  if (!extracted) throw new Error('Unstructured response had no extractable text');
  return extracted;
}

async function downloadPdfFromUrl(pdfUrl, runtime = {}) {
  const timeoutMs = Math.max(5000, Number(runtime?.fetchTimeoutMs || 45000));
  const { response, buffer } = await fetchBufferWithTimeout(
    pdfUrl,
    { method: 'GET', headers: { Accept: 'application/pdf,*/*;q=0.8' } },
    timeoutMs,
    'pdf download'
  );
  if (!response.ok) {
    throw new Error(`PDF download failed (${response.status})`);
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const maybePdf = contentType.includes('pdf') || String(pdfUrl || '').toLowerCase().includes('.pdf');
  if (!maybePdf) {
    const preview = String(buffer.toString('utf8') || '').trim().slice(0, 120);
    throw new Error(`URL does not look like PDF content (${contentType || 'unknown'}): ${preview}`);
  }
  const bytes = Buffer.from(buffer);
  if (!bytes.length) throw new Error('Downloaded PDF is empty');
  return bytes;
}

async function extractPdfStory(input, runtime = {}, config = {}, options = {}) {
  const selected = getConfiguredPdfExtractor(config);
  const order = [selected, ...PDF_EXTRACTOR_VALUES].filter((v, idx, arr) => arr.indexOf(v) === idx);
  let lastError = null;

  for (const provider of order) {
    try {
      let text = '';
      if (String(process.env.RENDER_BOT_FAKE_PDF_EXTRACTOR || '').trim().toLowerCase() === 'true') {
        const title = String(input?.fileName || input?.url || 'PDF').slice(0, 120);
        text = [
          `Extracted story from PDF (${title}).`,
          'This is synthetic test content for comic generation flow.',
          'A curious hero discovers a surprising clue, follows it across the city,',
          'and finally uncovers the hidden truth behind the mystery in a dramatic finale.'
        ].join(' ');
      } else if (provider === 'llamaparse' || provider === 'unstructured') {
        let pdfBytes = input?.pdfBytes || null;
        if (!pdfBytes && input?.url) {
          pdfBytes = await downloadPdfFromUrl(input.url, runtime);
        }
        if (!pdfBytes || !Buffer.isBuffer(pdfBytes) || !pdfBytes.length) {
          throw new Error('PDF bytes are empty');
        }
        if (provider === 'llamaparse') {
          text = await uploadPdfToLlamaParse(pdfBytes, input?.fileName || 'input.pdf', runtime);
        } else {
          text = await uploadPdfToUnstructured(pdfBytes, input?.fileName || 'input.pdf', runtime, config);
        }
      } else {
        throw new Error(`Unsupported PDF extractor provider: ${provider}`);
      }

      const extracted = String(text || '').replace(/\s+\n/g, '\n').trim();
      if (extracted.length < PDF_MIN_TEXT_CHARS) {
        throw new Error(`PDF extraction produced too little text (${extracted.length} chars)`);
      }
      if (provider !== selected && typeof options.onFallback === 'function') {
        await options.onFallback({ from: selected, to: provider, reason: 'extractor_failure', section: 'pdf_extraction' });
      }
      return {
        providerSelected: selected,
        providerUsed: provider,
        text: extracted
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('PDF extraction failed');
}

async function extractPdfFromTelegramDocument(api, document) {
  const fileId = String(document?.file_id || '').trim();
  if (!fileId) throw new Error('Telegram PDF document missing file_id');
  const fileInfo = await api.getFile(fileId);
  const filePath = String(fileInfo?.file_path || '').trim();
  if (!filePath) throw new Error('Telegram getFile returned no file_path for PDF');
  const bytes = await api.downloadFile(filePath);
  return {
    pdfBytes: bytes,
    fileName: String(document?.file_name || path.basename(filePath) || 'telegram.pdf').trim() || 'telegram.pdf'
  };
}

module.exports = {
  PDF_EXTRACTOR_VALUES,
  normalizePdfExtractor,
  getConfiguredPdfExtractor,
  extractPdfStory,
  extractPdfFromTelegramDocument
};
