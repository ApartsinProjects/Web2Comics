// Web2Comics - Service Worker
// Handles background processing, message routing, and job management

// ============ INLINE PROVIDER CLASSES ============

var STYLE_PRESETS = {
  'default': { name: 'Classic Comic', storyboard: 'Classic comic book style with bold outlines, readable panels, and vibrant colors', image: 'classic comic book illustration, bold outlines, vibrant colors' },
  'noir': { name: 'Noir', storyboard: 'Film noir style with dramatic shadows, moody lighting, and high contrast composition', image: 'film noir illustration, dramatic shadows, high contrast, moody lighting' },
  'manga': { name: 'Manga', storyboard: 'Japanese manga style with expressive characters, dynamic framing, and energetic motion cues', image: 'manga anime illustration, expressive faces, dynamic framing, crisp ink lines' },
  'superhero': { name: 'Superhero Action', storyboard: 'American superhero comic style with cinematic action poses and impact-heavy composition', image: 'superhero comic illustration, dynamic action pose, dramatic perspective, bold colors' },
  'watercolor': { name: 'Watercolor Storybook', storyboard: 'Soft watercolor storybook style with painterly textures and warm atmospheric scenes', image: 'watercolor storybook illustration, painterly textures, soft edges, warm atmosphere' },
  'pixel': { name: 'Pixel Art Retro', storyboard: 'Retro pixel art comic style with simple readable staging and iconic silhouettes', image: 'pixel art illustration, retro 8-bit 16-bit aesthetic, limited palette, crisp pixels' },
  'ligne-claire': { name: 'Ligne Claire', storyboard: 'Ligne claire European comic style with clean contour lines, flat colors, and clarity', image: 'ligne claire comic illustration, clean contour lines, flat colors, clear backgrounds' },
  'newspaper-strip': { name: 'Newspaper Strip', storyboard: 'Classic newspaper comic strip style with punchy beats and readable staging', image: 'newspaper comic strip illustration, clean ink lines, expressive cartooning' },
  'cyberpunk-neon': { name: 'Cyberpunk Neon', storyboard: 'Cyberpunk comic style with neon lighting, futuristic city mood, and high-tech visual motifs', image: 'cyberpunk comic illustration, neon lighting, futuristic city atmosphere, reflective surfaces' },
  'clay-stopmotion': { name: 'Clay Stop-Motion', storyboard: 'Clay stop-motion diorama style with handcrafted miniature textures and studio lighting', image: 'clay stop-motion style illustration, handcrafted miniature look, tactile textures' },
  'woodcut-print': { name: 'Woodcut Print', storyboard: 'Woodcut print graphic style with carved line textures and bold printmaking contrast', image: 'woodcut print style illustration, carved line textures, bold contrast, printmaking look' }
};

function getStyleSpec(options) {
  var styleId = (options && (options.styleId || options.style)) || 'default';
  var customStyleName = String((options && options.customStyleName) || '').trim();
  var customStyleTheme = String((options && options.customStyleTheme) || '').trim();
  var preset = STYLE_PRESETS[styleId] || STYLE_PRESETS['default'];

  if (styleId === 'custom') {
    var customName = customStyleName || 'Custom Style';
    var customDescription = customStyleTheme || 'User-defined comic visual style';
    return {
      id: 'custom',
      name: customName,
      storyboard: customDescription,
      image: customDescription,
      directive: 'Custom style "' + customName + '": ' + customDescription
    };
  }

  return {
    id: styleId,
    name: preset.name,
    storyboard: preset.storyboard,
    image: preset.image,
    directive: 'Preset style "' + preset.name + '": ' + preset.storyboard
  };
}

var OBJECTIVE_PROFILES = {
  summarize: {
    label: 'Quick Summary',
    guidance: 'Prioritize a concise overview of the most important claims and outcomes.'
  },
  fun: {
    label: 'Have Fun',
    guidance: 'Keep facts accurate, but use playful framing and lively narrative beats.'
  },
  'learn-step-by-step': {
    label: 'Learn Step by Step',
    guidance: 'Sequence panels as progressive steps that build understanding from basics to conclusions.'
  },
  'news-recap': {
    label: 'News Recap',
    guidance: 'Focus on who/what/when/where and the practical implications.'
  },
  timeline: {
    label: 'Timeline Breakdown',
    guidance: 'Present events chronologically, showing cause and effect between milestones.'
  },
  'key-facts': {
    label: 'Key Facts Only',
    guidance: 'Use dense factual captions with concrete entities, dates, and numbers; avoid fluff.'
  },
  'compare-views': {
    label: 'Compare Viewpoints',
    guidance: 'Contrast the main positions fairly and show where they differ or overlap.'
  },
  'explain-like-im-five': {
    label: "Explain Like I'm Five",
    guidance: 'Use simple language and analogies while keeping core facts correct.'
  },
  'study-guide': {
    label: 'Study Guide',
    guidance: 'Structure panels as exam-ready takeaways, key terms, and conclusions.'
  },
  'meeting-recap': {
    label: 'Meeting Recap',
    guidance: 'Highlight decisions, owners, and next actions clearly.'
  },
  'how-to-guide': {
    label: 'How-To Guide',
    guidance: 'Turn content into practical steps with prerequisites, actions, and outcomes.'
  },
  'debate-map': {
    label: 'Debate Map',
    guidance: 'Lay out claims, evidence, and counterpoints without taking unsupported sides.'
  }
};

function getObjectiveSpec(options) {
  var objectiveId = String((options && options.objective) || 'summarize');
  var profile = OBJECTIVE_PROFILES[objectiveId] || OBJECTIVE_PROFILES.summarize;
  return {
    id: profile === OBJECTIVE_PROFILES[objectiveId] ? objectiveId : 'summarize',
    label: profile.label,
    guidance: profile.guidance
  };
}

var OUTPUT_LANGUAGE_PROFILES = {
  auto: {
    label: 'Auto (match source language)',
    captionInstruction: 'Write captions, beat summaries, and story text in the same language as the source content.',
    imageInstruction: 'If visible text appears in the image, use the source content language.'
  },
  en: {
    label: 'English',
    captionInstruction: 'Write captions, beat summaries, and story text in English.',
    imageInstruction: 'If visible text appears in the image, it must be in English.'
  },
  es: {
    label: 'Spanish',
    captionInstruction: 'Write captions, beat summaries, and story text in Spanish.',
    imageInstruction: 'If visible text appears in the image, it must be in Spanish.'
  },
  fr: {
    label: 'French',
    captionInstruction: 'Write captions, beat summaries, and story text in French.',
    imageInstruction: 'If visible text appears in the image, it must be in French.'
  },
  de: {
    label: 'German',
    captionInstruction: 'Write captions, beat summaries, and story text in German.',
    imageInstruction: 'If visible text appears in the image, it must be in German.'
  },
  it: {
    label: 'Italian',
    captionInstruction: 'Write captions, beat summaries, and story text in Italian.',
    imageInstruction: 'If visible text appears in the image, it must be in Italian.'
  },
  pt: {
    label: 'Portuguese',
    captionInstruction: 'Write captions, beat summaries, and story text in Portuguese.',
    imageInstruction: 'If visible text appears in the image, it must be in Portuguese.'
  },
  ja: {
    label: 'Japanese',
    captionInstruction: 'Write captions, beat summaries, and story text in Japanese.',
    imageInstruction: 'If visible text appears in the image, it must be in Japanese.'
  },
  ko: {
    label: 'Korean',
    captionInstruction: 'Write captions, beat summaries, and story text in Korean.',
    imageInstruction: 'If visible text appears in the image, it must be in Korean.'
  },
  zh: {
    label: 'Chinese',
    captionInstruction: 'Write captions, beat summaries, and story text in Chinese.',
    imageInstruction: 'If visible text appears in the image, it must be in Chinese.'
  }
};

function getOutputLanguageSpec(options) {
  var raw = String(
    (options && (options.outputLanguage || options.output_language || options.language)) ||
    'en'
  ).trim().toLowerCase();
  var profile = OUTPUT_LANGUAGE_PROFILES[raw] || OUTPUT_LANGUAGE_PROFILES.en;
  return {
    id: OUTPUT_LANGUAGE_PROFILES[raw] ? raw : 'en',
    label: profile.label,
    captionInstruction: profile.captionInstruction,
    imageInstruction: profile.imageInstruction
  };
}

function appendLanguageInstruction(prompt, languageInstruction) {
  var base = String(prompt || '');
  var instruction = String(languageInstruction || '').trim();
  if (!instruction) return base;
  return base + '\nLanguage requirement: ' + instruction;
}

var DEFAULT_PROVIDER_PROMPT_TEMPLATES = {
  openai: {
    storyboard: 'Create a comic storyboard as strict JSON.\nJSON only, no markdown.\nSchema: {"panels":[{"caption":string,"image_prompt":string}]}\n' +
      'caption must be a short story beat for a reader (graphic-novel narration), not a visual prompt. image_prompt must be visual-generation instructions only.\n' +
      'Grounding rules:\n' +
      '- Choose one dominant story/topic from the content and keep all panels on that topic.\n' +
      '- Use concrete facts from the content (named people/orgs/places, numbers, dates, outcomes) when available.\n' +
      '- Do not invent facts, quotes, or events not supported by the content.\n' +
      '- Build a clear beginning -> development -> outcome arc across panels.\n' +
      '- Keep captions specific and concise; avoid generic filler like "things happen" or "people discuss issues".\n' +
      'Source: {{source_title}} ({{source_url}})\nPanels: {{panel_count}}\nObjective: {{objective_label}}\nObjective guidance: {{objective_guidance}}\nStyle: {{style_prompt}}\nContent:\n{{content}}',
    image: 'Comic panel {{panel_index}}/{{panel_count}}.\nCaption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
      'Image grounding rules:\n' +
      '- Depict the exact event/claim in caption+summary, not a generic scene.\n' +
      '- Reuse key entities/details from caption+summary (who/where/what/objects/context) when provided.\n' +
      '- Keep consistent characters/setting with prior panels and avoid adding unrelated elements.\n' +
      '- No text overlays unless explicitly required by the caption.'
  },
  gemini: {
    storyboard: 'Generate a comic storyboard in strict JSON.\nJSON only, no markdown.\nSchema: {"panels":[{"caption":string,"image_prompt":string}]}\n' +
      'caption must be a short story beat for a reader (graphic-novel narration), not a visual prompt. image_prompt must be visual-generation instructions only.\n' +
      'Grounding rules:\n' +
      '- Choose one dominant story/topic from the content and keep all panels on that topic.\n' +
      '- Use concrete facts from the content (named people/orgs/places, numbers, dates, outcomes) when available.\n' +
      '- Do not invent facts, quotes, or events not supported by the content.\n' +
      '- Build a clear beginning -> development -> outcome arc across panels.\n' +
      '- Keep captions specific and concise; avoid generic filler like "things happen" or "people discuss issues".\n' +
      'Source title: {{source_title}}\nSource URL: {{source_url}}\nPanel count: {{panel_count}}\nObjective: {{objective_label}}\nObjective guidance: {{objective_guidance}}\nStyle guidance: {{style_prompt}}\nContent:\n{{content}}',
    image: 'Create comic panel artwork {{panel_index}}/{{panel_count}}.\nPanel caption: {{panel_caption}}\nPanel summary: {{panel_summary}}\nStyle guidance: {{style_prompt}}\n' +
      'Image grounding rules:\n' +
      '- Depict the exact event/claim in caption+summary, not a generic scene.\n' +
      '- Reuse key entities/details from caption+summary (who/where/what/objects/context) when provided.\n' +
      '- Keep consistent characters/setting with prior panels and avoid adding unrelated elements.\n' +
      '- No text overlays unless explicitly required by the caption.'
  }
};
var STORYBOARD_RETRY_JSON_ONLY_PROMPT = 'Return ONLY valid JSON object with top-level "panels" array. No markdown fences.';
var STORYBOARD_CAPTION_IMAGE_PROMPT_RULE =
  'caption must be a short story beat for a reader (graphic-novel narration), not a visual prompt. image_prompt must be visual-generation instructions only.';
var STORYBOARD_CONTENT_GROUNDING_RULE =
  'Choose one dominant story/topic from the content and keep all panels on that topic. Use concrete facts from the content (named entities, numbers, dates, outcomes) when available. Do not invent unsupported facts, quotes, or events. Build a clear beginning -> development -> outcome arc across panels.';
var STORYBOARD_OBJECTIVE_RULE =
  'Follow the user objective "{{objective_label}}". Objective guidance: {{objective_guidance}}';
var IMAGE_PROMPT_GROUNDING_RULE =
  'Each image_prompt must depict the specific caption/summary facts (who/where/what), stay consistent with prior panels, and avoid unrelated generic scenes.';

var DEFAULT_FETCH_TIMEOUT_MS = 45000;
var STORYBOARD_TIMEOUT_MS = 90000;
var IMAGE_TIMEOUT_MS = 120000;

function timeoutError(label, timeoutMs) {
  var err = new Error((label || 'Request') + ' timed out after ' + timeoutMs + 'ms');
  err.name = 'TimeoutError';
  err.code = 'ETIMEDOUT';
  return err;
}

function withTimeout(promise, timeoutMs, label) {
  var ms = Math.max(1, Number(timeoutMs || DEFAULT_FETCH_TIMEOUT_MS));
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      reject(timeoutError(label, ms));
    }, ms);
    Promise.resolve(promise).then(function(value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    }).catch(function(error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function fetchWithTimeout(url, init, timeoutMs, label) {
  return withTimeout(fetch(url, init), timeoutMs || DEFAULT_FETCH_TIMEOUT_MS, label || 'Fetch');
}

function isTransientProviderErrorMessage(message) {
  var text = String(message || '').toLowerCase();
  return /timeout|timed out|failed to fetch|fetch failed|temporar|overload|503|502|504|rate limit|too many requests|429|connection reset|econnreset|socket/i.test(text);
}

function isRateLimitProviderErrorMessage(message) {
  var text = String(message || '').toLowerCase();
  return /rate limit|too many requests|429|resource_exhausted|quota exceeded:.*per minute|retry later/i.test(text);
}

function waitMs(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, Math.max(0, Number(ms) || 0)); });
}

function isBudgetProviderErrorMessage(message) {
  var text = String(message || '').toLowerCase();
  return /insufficient_quota|quota|budget|billing|payment required|402|exceeded your current quota|free[_ -]?tier|limit:\s*0|resource_exhausted|credits?\b/i.test(text);
}

function renderPromptTemplate(template, values) {
  return String(template || '').replace(/\{\{([^}]+)\}\}/g, function(match, key) {
    var token = String(key || '').trim();
    if (!values || !Object.prototype.hasOwnProperty.call(values, token)) return match;
    var value = values[token];
    return value == null ? '' : String(value);
  });
}

function normalizeLooseTextValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(normalizeLooseTextValue).filter(Boolean).join(' ').trim();
  }
  if (typeof value === 'object') {
    var preferredKeys = [
      'text', 'caption', 'content', 'title', 'summary', 'description', 'dialogue', 'value', 'label'
    ];
    for (var i = 0; i < preferredKeys.length; i++) {
      var normalized = normalizeLooseTextValue(value[preferredKeys[i]]);
      if (normalized) return normalized;
    }
    if (Array.isArray(value.parts)) {
      var partsText = normalizeLooseTextValue(value.parts);
      if (partsText) return partsText;
    }
    try {
      return JSON.stringify(value);
    } catch (_) {
      return '';
    }
  }
  return '';
}

function extractJsonCandidate(rawText) {
  var raw = String(rawText || '');
  var fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  var source = fenceMatch && fenceMatch[1] ? fenceMatch[1] : raw;
  var start = source.indexOf('{');
  if (start < 0) return '';

  var depth = 0;
  var inString = false;
  var escape = false;
  for (var i = start; i < source.length; i++) {
    var ch = source[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

function parseStoryboardMarkdownFallback(responseText, options) {
  var raw = String(responseText || '');
  var lines = raw.split(/\r?\n/).map(function(line) { return line.trim(); }).filter(Boolean);
  var titleLine = lines.find(function(line) { return /^#{1,6}\s+/.test(line); }) || '';
  var title = titleLine ? titleLine.replace(/^#{1,6}\s+/, '').trim() : 'Comic Summary';
  var segments = [];
  var current = null;

  lines.forEach(function(line) {
    if (/^#{1,6}\s+/.test(line) || /^panel\s*\d+\b[:.-]*/i.test(line)) {
      if (current && (current.caption || current.body.length)) segments.push(current);
      current = {
        caption: line.replace(/^#{1,6}\s+/, '').replace(/^panel\s*\d+\s*[:.-]*/i, '').trim(),
        body: []
      };
      return;
    }
    if (!current) current = { caption: '', body: [] };
    current.body.push(line);
  });
  if (current && (current.caption || current.body.length)) segments.push(current);

  var fallbackPanels = segments.map(function(seg, idx) {
    var bodyText = (seg.body || []).join(' ');
    var imagePromptMatch = bodyText.match(/image\s*prompt\s*[:\-]\s*(.+)$/i);
    var caption = seg.caption || ('Panel ' + (idx + 1));
    var beat = bodyText.replace(/image\s*prompt\s*[:\-]\s*.+$/i, '').trim();
    return {
      panel_id: 'panel_' + (idx + 1),
      beat_summary: beat || caption,
      caption: caption,
      image_prompt: (imagePromptMatch && imagePromptMatch[1] ? imagePromptMatch[1].trim() : ('Comic panel illustration of: ' + caption + (beat ? (', ' + beat) : '')))
    };
  }).filter(function(panel) { return panel.caption || panel.image_prompt; });

  return {
    title: title,
    panels: (options && options.panelCount) ? fallbackPanels.slice(0, options.panelCount) : fallbackPanels
  };
}

function scorePanelArrayKey(key) {
  var normalized = String(key || '').toLowerCase();
  var scoreMap = {
    panels: 100,
    frames: 95,
    scenes: 90,
    shots: 85,
    slides: 80,
    items: 75
  };
  if (Object.prototype.hasOwnProperty.call(scoreMap, normalized)) return scoreMap[normalized];
  if (/panel|frame|scene|shot|slide|item/.test(normalized)) return 50;
  return 10;
}

function discoverStoryboardPanelCandidates(parsed) {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== 'object') return [];

  var candidateSpecs = [];
  function pushCandidate(array, keyPath, keyName) {
    if (!Array.isArray(array)) return;
    candidateSpecs.push({
      array: array,
      keyPath: keyPath,
      keyName: keyName || keyPath.split('.').pop() || '',
      score: scorePanelArrayKey(keyName || keyPath)
    });
  }

  pushCandidate(parsed.panels, 'panels', 'panels');
  pushCandidate(parsed.frames, 'frames', 'frames');
  pushCandidate(parsed.scenes, 'scenes', 'scenes');
  pushCandidate(parsed.shots, 'shots', 'shots');
  pushCandidate(parsed.slides, 'slides', 'slides');
  pushCandidate(parsed.items, 'items', 'items');

  if (parsed.storyboard && typeof parsed.storyboard === 'object') {
    pushCandidate(parsed.storyboard.panels, 'storyboard.panels', 'panels');
    pushCandidate(parsed.storyboard.frames, 'storyboard.frames', 'frames');
    pushCandidate(parsed.storyboard.scenes, 'storyboard.scenes', 'scenes');
  }
  if (parsed.comic && typeof parsed.comic === 'object') {
    pushCandidate(parsed.comic.panels, 'comic.panels', 'panels');
    pushCandidate(parsed.comic.frames, 'comic.frames', 'frames');
  }
  if (parsed.data && typeof parsed.data === 'object') {
    pushCandidate(parsed.data.panels, 'data.panels', 'panels');
    pushCandidate(parsed.data.items, 'data.items', 'items');
  }
  if (parsed.result && typeof parsed.result === 'object') {
    pushCandidate(parsed.result.panels, 'result.panels', 'panels');
    pushCandidate(parsed.result.items, 'result.items', 'items');
  }

  Object.keys(parsed).forEach(function(key) {
    if (!Array.isArray(parsed[key])) return;
    pushCandidate(parsed[key], key, key);
  });

  candidateSpecs.sort(function(a, b) { return b.score - a.score; });
  return candidateSpecs.length ? candidateSpecs[0].array : [];
}

function normalizeStoryboardPanels(parsed, requestedPanelCount) {
  var panelCandidates = discoverStoryboardPanelCandidates(parsed);
  var normalizedPanels = (panelCandidates || [])
    .map(function(p, i) {
      if (!p || typeof p !== 'object') return null;
      var beat = normalizeLooseTextValue(p.beat_summary || p.summary || p.beat || p.description || p.text || p.narration || '');
      var caption = normalizeLooseTextValue(p.caption || p.title || p.dialogue || p.caption_text || p.text_content) || beat || ('Panel ' + (i + 1));
      var imagePrompt = normalizeLooseTextValue(p.image_prompt || p.prompt || p.imagePrompt || p.visual_prompt || p.visual || p.image || p.scene_prompt) || ('Comic panel illustration of: ' + caption);
      return {
        panel_id: 'panel_' + (i + 1),
        beat_summary: beat,
        caption: caption,
        image_prompt: imagePrompt
      };
    })
    .filter(function(p) { return p && (p.caption || p.image_prompt); });

  if (requestedPanelCount && Number(requestedPanelCount) > 0) {
    normalizedPanels = normalizedPanels.slice(0, Number(requestedPanelCount));
  }
  return normalizedPanels;
}

function parseStoryboardLoose(raw, options) {
  raw = String(raw || '');
  var parsed = null;
  var parseError = null;
  var normalizedPanels = [];

  try {
    var jsonCandidate = extractJsonCandidate(raw);
    if (!jsonCandidate) throw new Error('No JSON object found in provider response');
    parsed = JSON.parse(jsonCandidate);
    normalizedPanels = normalizeStoryboardPanels(parsed, options && options.panelCount);
  } catch (e) {
    parseError = e;
  }

  if (!normalizedPanels.length) {
    var fallback = parseStoryboardMarkdownFallback(raw, options || {});
    if (fallback && Array.isArray(fallback.panels) && fallback.panels.length) {
      normalizedPanels = normalizeStoryboardPanels({ panels: fallback.panels }, options && options.panelCount);
      if (!parsed || typeof parsed !== 'object') parsed = {};
      if (!parsed.title && fallback.title) parsed.title = fallback.title;
    }
  }

  return {
    parsed: parsed,
    parseError: parseError,
    panels: normalizedPanels
  };
}

function parseStoryboardResponseShared(responseText, options, config) {
  var providerTextId = (config && config.providerTextId) || 'unknown';
  var providerImageId = (config && config.providerImageId) || providerTextId;
  var defaultTextModel = (config && config.defaultTextModel) || '';
  var defaultImageModel = (config && config.defaultImageModel) || '';
  var loose = parseStoryboardLoose(responseText, options);
  var parsed = loose.parsed;
  var parseError = loose.parseError;
  var normalizedPanels = loose.panels || [];

  if (!normalizedPanels.length) {
    var keys = parsed && typeof parsed === 'object' ? Object.keys(parsed).join(', ') : '';
    var parseMsg = parseError ? parseError.message : ('No panels found' + (keys ? ('. Keys: ' + keys) : ''));
    var err = new Error('Failed to parse storyboard: ' + parseMsg);
    err.rawOutputSnippet = String(responseText || '').replace(/\s+/g, ' ').trim().substring(0, 280);
    err.parsedKeys = keys;
    throw err;
  }

  return {
    schema_version: '1.0',
    title: (parsed && parsed.title) ? normalizeLooseTextValue(parsed.title) : undefined,
    settings: {
      panel_count: (options && options.panelCount) || 6,
      objective: (options && options.objective) || 'summarize',
      output_language: (options && (options.outputLanguage || options.output_language)) || 'en',
      detail_level: (options && options.detailLevel) || 'medium',
      style_id: (options && options.styleId) || 'default',
      caption_len: (options && options.captionLength) || 'short',
      provider_text: providerTextId,
      provider_image: providerImageId,
      text_model: (options && options.textModel) || defaultTextModel || '',
      image_model: (options && options.imageModel) || defaultImageModel || '',
      image_quality: (options && options.imageQuality) || '',
      image_size: (options && options.imageSize) || '',
      custom_style_theme: (options && options.customStyleTheme) || '',
      custom_style_name: (options && options.customStyleName) || ''
    },
    panels: normalizedPanels
  };
}

function summarizeRawOutputForRetry(error) {
  var snippet = (error && error.rawOutputSnippet) ? String(error.rawOutputSnippet) : '';
  if (!snippet) return 'No parseable JSON found.';
  return 'Previous malformed output snippet: "' + snippet + '"';
}

function looksLikeImagePromptText(value) {
  var s = normalizeLooseTextValue(value).trim();
  if (!s) return false;
  var lower = s.toLowerCase();
  if (s.length > 220) return true;
  var promptPhrases = [
    'comic panel illustration',
    'illustration of',
    'digital art',
    'cinematic lighting',
    'highly detailed',
    'camera angle',
    'art style',
    'dramatic lighting',
    'ultra detailed'
  ];
  for (var i = 0; i < promptPhrases.length; i++) {
    if (lower.indexOf(promptPhrases[i]) >= 0) return true;
  }
  var commaCount = (s.match(/,/g) || []).length;
  if (commaCount >= 6) return true;
  return false;
}

function rewritePromptLikeCaptionToStoryBeat(captionText, panel, index) {
  var storyCandidates = [
    panel && panel.beat_summary,
    panel && panel.summary,
    panel && panel.beat,
    panel && panel.narration,
    panel && panel.description,
    panel && panel.title,
    panel && panel.text,
    panel && panel.text_content,
    panel && panel.caption_text,
    panel && panel.dialogue
  ];
  for (var i = 0; i < storyCandidates.length; i++) {
    var candidate = normalizeLooseTextValue(storyCandidates[i]);
    if (candidate && !looksLikeImagePromptText(candidate)) return candidate;
  }

  // Heuristic fallback: strip common prompt-style boilerplate and visual jargon.
  var src = normalizeLooseTextValue(captionText);
  if (!src) return 'Panel ' + (index + 1);
  var out = src
    .replace(/^comic panel illustration of:\s*/i, '')
    .replace(/^illustration of:\s*/i, '')
    .replace(/\b(digital art|cinematic lighting|highly detailed|ultra detailed|dramatic lighting|camera angle[^,.;]*|art style[^,.;]*)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/^[,.\s-]+|[,.\s-]+$/g, '');
  // Prefer first natural clause/sentence fragment as story beat.
  var split = out.split(/[.;]|, and /i).map(function(part) { return part.trim(); }).filter(Boolean);
  var candidateBeat = split[0] || out;
  if (!candidateBeat) return 'Panel ' + (index + 1);
  if (!/[.!?]$/.test(candidateBeat)) candidateBeat += '.';
  return candidateBeat.substring(0, 180);
}

function validateStoryboardContract(storyboard, requestedPanelCount) {
  var normalized = (storyboard && typeof storyboard === 'object') ? storyboard : {};
  if (!Array.isArray(normalized.panels)) normalized.panels = [];

  var beforeMissingCaption = 0;
  var beforeMissingImagePrompt = 0;
  var promptLikeCaptionRepairs = 0;
  var captionQuality = {
    totalPanels: 0,
    nonEmptyCaptions: 0,
    storyLikeCaptions: 0,
    promptLikeCaptions: 0,
    fallbackPanelLabelCaptions: 0
  };

  normalized.panels = normalized.panels
    .map(function(panel, index) {
      if (!panel || typeof panel !== 'object') return null;
      var p = { ...panel };
      var beat = normalizeLooseTextValue(p.beat_summary || p.summary || p.beat || p.description || p.text || p.narration || '');
      var caption = normalizeLooseTextValue(p.caption || p.title || p.dialogue || p.caption_text || p.text_content);
      var imagePrompt = normalizeLooseTextValue(p.image_prompt || p.prompt || p.imagePrompt || p.visual_prompt || p.visual || p.image || p.scene_prompt);

      if (!caption) beforeMissingCaption += 1;
      if (!imagePrompt) beforeMissingImagePrompt += 1;

      if (caption && (looksLikeImagePromptText(caption) || (imagePrompt && caption === imagePrompt))) {
        var repairedCaption = rewritePromptLikeCaptionToStoryBeat(caption, p, index);
        if (repairedCaption && repairedCaption !== caption) {
          caption = repairedCaption;
          promptLikeCaptionRepairs += 1;
        }
      }

      p.beat_summary = p.beat_summary || beat || '';
      p.caption = caption || beat || ('Panel ' + (index + 1));
      p.image_prompt = imagePrompt || ('Comic panel illustration of: ' + p.caption + (beat ? ('. ' + beat) : ''));
      if (!p.panel_id) p.panel_id = 'panel_' + (index + 1);

      captionQuality.totalPanels += 1;
      var finalCaption = normalizeLooseTextValue(p.caption);
      if (finalCaption) {
        captionQuality.nonEmptyCaptions += 1;
        if (looksLikeImagePromptText(finalCaption)) captionQuality.promptLikeCaptions += 1;
        else captionQuality.storyLikeCaptions += 1;
        if (/^Panel\s+\d+\.?$/i.test(finalCaption)) captionQuality.fallbackPanelLabelCaptions += 1;
      }
      return p;
    })
    .filter(function(panel) { return !!panel; });

  if (requestedPanelCount && Number(requestedPanelCount) > 0) {
    normalized.panels = normalized.panels.slice(0, Number(requestedPanelCount));
  }

  return {
    storyboard: normalized,
    meta: {
      hasPanelsArray: Array.isArray((storyboard && storyboard.panels)) || Array.isArray(normalized.panels),
      panelCount: normalized.panels.length,
      missingCaptionBeforeSynthesis: beforeMissingCaption,
      missingImagePromptBeforeSynthesis: beforeMissingImagePrompt,
      promptLikeCaptionRepairs: promptLikeCaptionRepairs,
      captionQuality: captionQuality
    }
  };
}

function getProviderPromptTemplateScope(providerId) {
  if (providerId === 'openai') return 'openai';
  if (providerId === 'gemini-free') return 'gemini';
  return null;
}

function resolvePromptTemplatesForProviders(storedPromptTemplates, textProviderId, imageProviderId) {
  var stored = storedPromptTemplates && typeof storedPromptTemplates === 'object' ? storedPromptTemplates : {};
  function resolveByProvider(providerId) {
    var scope = getProviderPromptTemplateScope(providerId);
    if (!scope) return null;
    return {
      storyboard: (stored[scope] && stored[scope].storyboard) || DEFAULT_PROVIDER_PROMPT_TEMPLATES[scope].storyboard,
      image: (stored[scope] && stored[scope].image) || DEFAULT_PROVIDER_PROMPT_TEMPLATES[scope].image
    };
  }
  return {
    text: resolveByProvider(textProviderId),
    image: resolveByProvider(imageProviderId)
  };
}

function orderedCandidates(preferred, defaults) {
  var list = Array.isArray(defaults) ? defaults.slice() : [];
  var model = String(preferred || '').trim();
  if (!model) return list;
  var out = [model];
  for (var i = 0; i < list.length; i++) {
    if (list[i] !== model) out.push(list[i]);
  }
  return out;
}

class GeminiProvider {
  constructor() {
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.modelName = 'gemini-2.5-flash';
    this.textModelCandidates = [
      'gemini-2.5-flash',
      'gemini-flash-lite-latest',
      'gemini-flash-latest',
      'gemini-2.0-flash-lite',
      'gemini-2.0-flash'
    ];
    this.imageModelCandidates = [
      // Prefer known-working image-generation models first.
      'gemini-2.5-flash-image',
      'gemini-2.0-flash-exp-image-generation',
      'gemini-2.0-flash'
    ];
  }
  get capabilities() {
    return { supportsImages: true, maxPromptLength: 8192, rateLimitBehavior: 'strict', costTag: 'limited' };
  }
  async getApiKey() {
    const { apiKeys } = await chrome.storage.local.get('apiKeys');
    return apiKeys?.gemini;
  }
  async generateStoryboard(text, options) {
    const apiKey = await this.getApiKey();
    if (!apiKey) throw new Error('Gemini API key not configured');
    
    const prompt = this.buildStoryboardPrompt(text, options);
    let lastError = null;
    for (const model of orderedCandidates(options && options.textModel, this.textModelCandidates)) {
      const response = await fetchWithTimeout(this.baseUrl + '/models/' + model + ':generateContent?key=' + apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
        })
      }, STORYBOARD_TIMEOUT_MS, 'Gemini storyboard');

      if (!response.ok) {
        let message = 'Failed to generate storyboard';
        try {
          const error = await response.json();
          message = error.error?.message || message;
        } catch (_) {}
        lastError = new Error(message);
        // If the model is unavailable/unsupported, try the next free-tier candidate.
        if (/not found|not supported|no longer available/i.test(message)) {
          continue;
        }
        throw lastError;
      }

      const data = await response.json();
      const storyboardText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!storyboardText) {
        lastError = new Error('Invalid response from Gemini');
        continue;
      }
      return this.parseStoryboardResponse(storyboardText, {
        ...options,
        textModel: model
      });
    }

    throw (lastError || new Error('Failed to generate storyboard'));
  }
  
  buildStoryboardPrompt(text, options) {
    const panelCount = options.panelCount || 6;
    var styleSpec = getStyleSpec(options);
    var objectiveSpec = getObjectiveSpec(options);
    var languageSpec = getOutputLanguageSpec(options);
    if (options && options.storyboardTemplate) {
      var renderedTemplate = renderPromptTemplate(options.storyboardTemplate, {
        source_title: options.sourceTitle || '',
        source_url: options.sourceUrl || '',
        panel_count: panelCount,
        detail_level: options.detailLevel || 'medium',
        objective: objectiveSpec.id,
        objective_label: objectiveSpec.label,
        objective_guidance: objectiveSpec.guidance,
        output_language: languageSpec.id,
        output_language_label: languageSpec.label,
        output_language_instruction: languageSpec.captionInstruction,
        style_prompt: styleSpec.directive,
        content: String(text || '').substring(0, 4000)
      });
        if (renderedTemplate && renderedTemplate.trim()) {
        renderedTemplate += '\nObjective: ' + objectiveSpec.label + '\nObjective guidance: ' + objectiveSpec.guidance;
        renderedTemplate += '\nOutput language: ' + languageSpec.label;
        renderedTemplate = appendLanguageInstruction(renderedTemplate, languageSpec.captionInstruction);
        if (options && options.panelCountRetry) {
          renderedTemplate += '\n\nREMINDER: Return exactly ' + panelCount + ' panels in the top-level "panels" array.';
        }
        if (options && options.malformedRetry) {
          return renderedTemplate + '\n\nIMPORTANT RETRY: ' + STORYBOARD_RETRY_JSON_ONLY_PROMPT;
        }
        return renderedTemplate;
      }
    }

    var prompt = 'Create a ' + panelCount + '-panel comic storyboard.\n' +
      'JSON only, no markdown.\n' +
      'Schema: {"panels":[{"caption":string,"image_prompt":string}]}\n' +
      STORYBOARD_CAPTION_IMAGE_PROMPT_RULE + '\n' +
      STORYBOARD_CONTENT_GROUNDING_RULE + '\n' +
      renderPromptTemplate(STORYBOARD_OBJECTIVE_RULE, {
        objective_label: objectiveSpec.label,
        objective_guidance: objectiveSpec.guidance
      }) + '\n' +
      'Output language: ' + languageSpec.label + '\n' +
      'Language requirement: ' + languageSpec.captionInstruction + '\n' +
      IMAGE_PROMPT_GROUNDING_RULE + '\n' +
      'Source title: ' + (options.sourceTitle || '') + '\n' +
      'Source URL: ' + (options.sourceUrl || '') + '\n' +
      'Objective: ' + objectiveSpec.label + '\n' +
      'Visual style requirement: ' + styleSpec.directive + '\n' +
      'Keep the style consistent across all panels.\n' +
      'Text: ' + text.substring(0, 4000);
    if (options && options.parseFailureSummary) {
      prompt += '\n\n' + String(options.parseFailureSummary).substring(0, 320);
    }
    if (options && options.malformedRetry) {
      prompt += '\n\nIMPORTANT RETRY: ' + STORYBOARD_RETRY_JSON_ONLY_PROMPT;
    }
    if (options && options.panelCountRetry) {
      prompt += '\n\nREMINDER: Return exactly ' + panelCount + ' panels in the top-level "panels" array.';
    }
    return prompt;
  }
  
  parseStoryboardResponse(responseText, options) {
    return parseStoryboardResponseShared(responseText, options, {
      providerTextId: 'gemini-free',
      providerImageId: 'gemini-free'
    });
  }
  
  async generateImage(prompt, options) {
    var self = this;
    return new Promise(async function(resolve, reject) {
      var apiKey = await self.getApiKey();
      if (!apiKey) { reject(new Error('Gemini API key not configured')); return; }
      
      var styleSpec = getStyleSpec(options);
      var languageSpec = getOutputLanguageSpec(options);
      var enhancedPrompt = prompt + ', ' + styleSpec.image + ', consistent comic panel style';
      if (options && options.imageTemplate) {
        var renderedImageTemplate = renderPromptTemplate(options.imageTemplate, {
          panel_index: options.panelIndex != null ? (options.panelIndex + 1) : '',
          panel_count: options.panelCount || '',
          panel_caption: options.panelCaption || '',
          panel_summary: options.panelSummary || '',
          output_language: languageSpec.id,
          output_language_label: languageSpec.label,
          output_language_instruction: languageSpec.imageInstruction,
          style_prompt: styleSpec.image
        });
        if (renderedImageTemplate && renderedImageTemplate.trim()) {
          enhancedPrompt = renderedImageTemplate;
        }
      }
      enhancedPrompt = appendLanguageInstruction(enhancedPrompt, languageSpec.imageInstruction);
      
      try {
        async function generateWithModel(modelName) {
          var response = await fetchWithTimeout(self.baseUrl + '/models/' + modelName + ':generateContent?key=' + apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: enhancedPrompt }] }],
              generationConfig: { temperature: 0.8, maxOutputTokens: 4096, responseModalities: ['image', 'text'] }
            })
          }, IMAGE_TIMEOUT_MS, 'Gemini image');

          if (!response.ok) {
            var errMessage = 'Failed to generate image';
            try {
              var err = await response.json();
              errMessage = err.error?.message || errMessage;
            } catch (_) {}
            throw new Error(errMessage);
          }

          var data = await response.json();
          var imageData = data.candidates?.[0]?.content?.parts?.find(function(p) { return p.inlineData?.data; });
          if (!imageData) throw new Error('No image in response');

          return {
            imageData: 'data:image/png;base64,' + imageData.inlineData.data,
            providerMetadata: { model: modelName }
          };
        }

        var lastError = null;
        var imageCandidates = orderedCandidates(options && options.imageModel, self.imageModelCandidates);
        for (var i = 0; i < imageCandidates.length; i++) {
          try {
            var result = await generateWithModel(imageCandidates[i]);
            resolve(result);
            return;
          } catch (modelError) {
            lastError = modelError;
          }
        }

        if (lastError && /not available|quota|free tier/i.test(String(lastError.message || lastError))) {
          reject(new Error('Gemini image generation is unavailable for this key/project (likely free-tier limit). Use another image provider or paid Gemini quota.'));
          return;
        }
        reject(lastError || new Error('Failed to generate image'));
      } catch (e) {
        reject(e);
      }
    });
  }
}

class OpenAIProvider {
  constructor() {
    this.baseUrl = 'https://api.openai.com/v1';
    this.textModel = 'gpt-4o-mini';
    this.imageModel = 'dall-e-3';
  }
  sanitizeImagePrompt(prompt) {
    var base = String(prompt || '');
    var sanitized = base
      .replace(/\b(Trump|Biden|Putin|Netanyahu|Hamas|police|riot|shooting|killed?|bomb|war)\b/gi, 'public figure')
      .replace(/\b(CNN|Fox News|BBC|MSNBC)\b/gi, 'news outlet');
    return 'Comic-style editorial illustration, non-graphic, neutral, no real-person likenesses, no logos. ' +
      'Depict a general news scene safely. Prompt concept: ' + sanitized;
  }
  get capabilities() {
    return { supportsImages: true, maxPromptLength: 128000, rateLimitBehavior: 'strict', costTag: 'paid' };
  }
  async getApiKey() {
    var result = await chrome.storage.local.get('apiKeys');
    return result.apiKeys?.openai;
  }
  async generateStoryboard(text, options) {
    var self = this;
    return new Promise(async function(resolve, reject) {
      var apiKey = await self.getApiKey();
      if (!apiKey) { reject(new Error('OpenAI API key not configured')); return; }
      var styleSpec = getStyleSpec(options);
      var objectiveSpec = getObjectiveSpec(options);
      var languageSpec = getOutputLanguageSpec(options);
      var textModel = (options && options.textModel) || self.textModel;
      var userPrompt =
        'Create a ' + (options.panelCount || 6) + '-panel comic storyboard. ' +
        'JSON only, no markdown. ' +
        'Schema: {"panels":[{"caption":string,"image_prompt":string}]}. ' +
        STORYBOARD_CAPTION_IMAGE_PROMPT_RULE + ' ' +
        STORYBOARD_CONTENT_GROUNDING_RULE + ' ' +
        renderPromptTemplate(STORYBOARD_OBJECTIVE_RULE, {
          objective_label: objectiveSpec.label,
          objective_guidance: objectiveSpec.guidance
        }) + ' ' +
        'Output language: ' + languageSpec.label + '. ' +
        languageSpec.captionInstruction + ' ' +
        IMAGE_PROMPT_GROUNDING_RULE + ' ' +
        'Source title: ' + (options.sourceTitle || '') + '. ' +
        'Source URL: ' + (options.sourceUrl || '') + '. ' +
        'Objective: ' + objectiveSpec.label + '. ' +
        'Style requirement: ' + styleSpec.directive + '. ' +
        'Content: ' + text.substring(0, 8000);
      if (options && options.storyboardTemplate) {
        var renderedTemplate = renderPromptTemplate(options.storyboardTemplate, {
          source_title: options.sourceTitle || '',
          source_url: options.sourceUrl || '',
          panel_count: options.panelCount || 6,
          detail_level: options.detailLevel || 'medium',
          objective: objectiveSpec.id,
          objective_label: objectiveSpec.label,
          objective_guidance: objectiveSpec.guidance,
          output_language: languageSpec.id,
          output_language_label: languageSpec.label,
          output_language_instruction: languageSpec.captionInstruction,
          style_prompt: styleSpec.directive,
          content: String(text || '').substring(0, 8000)
        });
        if (renderedTemplate && renderedTemplate.trim()) {
          renderedTemplate += '\nObjective: ' + objectiveSpec.label + '\nObjective guidance: ' + objectiveSpec.guidance;
          renderedTemplate += '\nOutput language: ' + languageSpec.label;
          renderedTemplate = appendLanguageInstruction(renderedTemplate, languageSpec.captionInstruction);
          userPrompt = renderedTemplate;
        }
      }
      if (options && options.malformedRetry) {
        userPrompt += '\n\nIMPORTANT RETRY: ' + STORYBOARD_RETRY_JSON_ONLY_PROMPT;
      }
      if (options && options.parseFailureSummary) {
        userPrompt += '\n\n' + String(options.parseFailureSummary).substring(0, 320);
      }
      if (options && options.panelCountRetry) {
        userPrompt += '\n\nREMINDER: Return exactly ' + (options.panelCount || 6) + ' panels in the top-level "panels" array.';
      }
      
      var response = await fetchWithTimeout(self.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: textModel,
          messages: [
            {
              role: 'system',
              content:
                'You are a comic storyboard generator. Respond with JSON only, no markdown fences. ' +
                'Schema: {"panels":[{"caption":string,"image_prompt":string}]}. ' +
                STORYBOARD_CAPTION_IMAGE_PROMPT_RULE + ' ' +
                STORYBOARD_CONTENT_GROUNDING_RULE + ' ' +
                IMAGE_PROMPT_GROUNDING_RULE + ' ' +
                languageSpec.captionInstruction + ' ' +
                'Include the requested art style in each panel image_prompt.'
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          response_format: { type: 'json_object' }
        })
      }, STORYBOARD_TIMEOUT_MS, 'OpenAI storyboard');
      
      if (!response.ok) {
        var err = await response.json();
        reject(new Error(err.error?.message || 'Failed to generate storyboard'));
        return;
      }
      
      var data = await response.json();
      var storyboardText = data.choices?.[0]?.message?.content;
      if (!storyboardText) { reject(new Error('Invalid response from OpenAI')); return; }
      
      try {
        resolve(self.parseStoryboardResponse(storyboardText, options));
      } catch (parseError) {
        reject(parseError);
      }
    });
  }
  
  parseStoryboardResponse(responseText, options) {
    return parseStoryboardResponseShared(responseText, options, {
      providerTextId: 'openai',
      providerImageId: 'openai',
      defaultTextModel: this.textModel,
      defaultImageModel: this.imageModel
    });
  }
  
  async generateImage(prompt, options) {
    var self = this;
    return new Promise(async function(resolve, reject) {
      var apiKey = await self.getApiKey();
      if (!apiKey) { reject(new Error('OpenAI API key not configured')); return; }
      
      try {
        var styleSpec = getStyleSpec(options);
        var languageSpec = getOutputLanguageSpec(options);
        var imageConfig = self.normalizeImageRequestOptions(options);
        var styledPrompt = prompt + '. Style direction: ' + styleSpec.directive + '. Keep consistent comic panel aesthetics.';
        if (options && options.imageTemplate) {
          var renderedImageTemplate = renderPromptTemplate(options.imageTemplate, {
            panel_index: options.panelIndex != null ? (options.panelIndex + 1) : '',
            panel_count: options.panelCount || '',
            panel_caption: options.panelCaption || '',
            panel_summary: options.panelSummary || '',
            output_language: languageSpec.id,
            output_language_label: languageSpec.label,
            output_language_instruction: languageSpec.imageInstruction,
            style_prompt: styleSpec.directive
          });
          if (renderedImageTemplate && renderedImageTemplate.trim()) {
            styledPrompt = renderedImageTemplate;
          }
        }
        styledPrompt = appendLanguageInstruction(styledPrompt, languageSpec.imageInstruction);
        async function requestImage(imagePrompt, requestConfig) {
          var activeConfig = requestConfig || imageConfig;
          var payload = {
            model: activeConfig.model,
            prompt: imagePrompt,
            n: 1,
            size: activeConfig.size
          };
          if (activeConfig.quality) {
            payload.quality = activeConfig.quality;
          }
          var response = await fetchWithTimeout(self.baseUrl + '/images/generations', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }, IMAGE_TIMEOUT_MS, 'OpenAI image');

          if (!response.ok) {
            var err = await response.json();
            var errorMessage = err.error?.message || 'Failed to generate image';
            var noModelAccess = /does not have access to model/i.test(errorMessage);
            if (noModelAccess) {
              var fallbackConfig = self.getFallbackImageRequestOptions(activeConfig);
              if (fallbackConfig) {
                return requestImage(imagePrompt, fallbackConfig);
              }
            }
            throw new Error(errorMessage);
          }

          var json = await response.json();
          json.__requestConfig = activeConfig;
          return json;
        }

        var data = await requestImage(styledPrompt);
        var finalRequestConfig = data.__requestConfig || imageConfig;
        var imageUrl = data.data?.[0]?.url;
        if (!imageUrl) { reject(new Error('No image in response')); return; }
        
        var imgResponse = await fetchWithTimeout(imageUrl, undefined, IMAGE_TIMEOUT_MS, 'OpenAI image download');
        var blob = await imgResponse.blob();
        var reader = new FileReader();
        
        reader.onload = function() {
          resolve({
            imageData: reader.result,
            providerMetadata: {
              model: finalRequestConfig.model,
              size: finalRequestConfig.size,
              quality: finalRequestConfig.quality || 'standard'
            }
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      } catch (e) {
        reject(e);
      }
    });
  }

  normalizeImageRequestOptions(options) {
    var model = ((options && options.imageModel) || this.imageModel || 'dall-e-2');
    var requestedSize = ((options && options.imageSize) || '').trim();
    var requestedQuality = ((options && options.imageQuality) || '').trim();

    if (model === 'dall-e-2') {
      var de2Allowed = ['256x256', '512x512', '1024x1024'];
      return {
        model: 'dall-e-2',
        size: de2Allowed.indexOf(requestedSize) >= 0 ? requestedSize : '256x256',
        quality: null
      };
    }

    var de3Allowed = ['1024x1024', '1024x1792', '1792x1024'];
    return {
      model: 'dall-e-3',
      size: de3Allowed.indexOf(requestedSize) >= 0 ? requestedSize : '1024x1024',
      quality: requestedQuality === 'hd' ? 'hd' : 'standard'
    };
  }

  getFallbackImageRequestOptions(imageConfig) {
    var cfg = imageConfig || {};
    if (cfg.model === 'dall-e-2') {
      // Common project entitlement gap: no DALL-E 2 access. Fall back to DALL-E 3 with valid defaults.
      return {
        model: 'dall-e-3',
        size: '1024x1024',
        quality: 'standard'
      };
    }
    return null;
  }
}

class OpenRouterProvider {
  constructor() {
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.modelCandidates = [
      'openai/gpt-oss-20b:free',
      'google/gemma-3-4b-it:free',
      'openrouter/auto'
    ];
    this.imageModelCandidates = [
      'google/gemini-2.5-flash-image-preview',
      'google/gemini-2.5-flash-image',
      'openai/gpt-image-1'
    ];
  }
  get capabilities() {
    return { supportsImages: true, maxPromptLength: 64000, rateLimitBehavior: 'strict', costTag: 'free/paid-router' };
  }
  async getApiKey() {
    var result = await chrome.storage.local.get('apiKeys');
    return result.apiKeys?.openrouter;
  }
  buildStoryboardPrompt(text, options) {
    var panelCount = options.panelCount || 6;
    var styleSpec = getStyleSpec(options);
    var objectiveSpec = getObjectiveSpec(options);
    var languageSpec = getOutputLanguageSpec(options);
    var prompt = [
      'Create a comic storyboard from the content below.',
      'JSON only, no markdown.',
      'Schema: {"panels":[{"caption":string,"image_prompt":string}]}',
      STORYBOARD_CAPTION_IMAGE_PROMPT_RULE,
      STORYBOARD_CONTENT_GROUNDING_RULE,
      renderPromptTemplate(STORYBOARD_OBJECTIVE_RULE, {
        objective_label: objectiveSpec.label,
        objective_guidance: objectiveSpec.guidance
      }),
      IMAGE_PROMPT_GROUNDING_RULE,
      'Panel count: ' + panelCount,
      'Source title: ' + (options.sourceTitle || ''),
      'Source URL: ' + (options.sourceUrl || ''),
      'Objective: ' + objectiveSpec.label,
      'Output language: ' + languageSpec.label,
      'Language requirement: ' + languageSpec.captionInstruction,
      'Style requirement: ' + styleSpec.directive,
      'Keep the style consistent across all panels.',
      'Content:',
      String(text || '').substring(0, 3500)
    ].join('\n');
    if (options && options.malformedRetry) {
      prompt += '\nIMPORTANT RETRY: ' + STORYBOARD_RETRY_JSON_ONLY_PROMPT;
    }
    if (options && options.parseFailureSummary) {
      prompt += '\n' + String(options.parseFailureSummary).substring(0, 320);
    }
    if (options && options.panelCountRetry) {
      prompt += '\nREMINDER: Return exactly ' + panelCount + ' panels in the top-level "panels" array.';
    }
    return prompt;
  }
  parseStoryboardResponse(responseText, options) {
    return parseStoryboardResponseShared(responseText, options, {
      providerTextId: 'openrouter',
      providerImageId: (options && options.providerImage) || 'openrouter'
    });
  }
  async generateStoryboard(text, options) {
    var apiKey = await this.getApiKey();
    if (!apiKey) throw new Error('OpenRouter API key not configured');

    var prompt = this.buildStoryboardPrompt(text, options || {});
    var lastError = null;
    var openRouterCandidates = orderedCandidates(options && options.textModel, this.modelCandidates);
    for (var i = 0; i < openRouterCandidates.length; i++) {
      var model = openRouterCandidates[i];
      var response = await fetchWithTimeout(this.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://web2comics.local',
          'X-Title': 'Web2Comics'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'user', content: prompt }
          ],
          max_tokens: 2048
        })
      }, STORYBOARD_TIMEOUT_MS, 'OpenRouter storyboard');

      if (!response.ok) {
        var errMessage = 'OpenRouter request failed';
        try {
          var err = await response.json();
          errMessage =
            err.error?.message ||
            err.message ||
            err.error?.metadata?.raw ||
            (Array.isArray(err.errors) ? err.errors.map(function(e) { return e.message || JSON.stringify(e); }).join('; ') : '') ||
            JSON.stringify(err);
        } catch (_) {}
        lastError = new Error(errMessage);
        if (/not found|unsupported|model.*not available|no endpoints found|provider returned error|overloaded|temporar/i.test(errMessage)) {
          continue;
        }
        throw lastError;
      }

      var data = await response.json();
      var content =
        data.choices?.[0]?.message?.content ||
        data.choices?.[0]?.message?.reasoning ||
        '';
      if (!content) {
        lastError = new Error('Invalid response from OpenRouter');
        continue;
      }
      try {
        var storyboard = this.parseStoryboardResponse(content, { ...options, textModel: model });
        if (storyboard && storyboard.settings) {
          storyboard.settings.provider_text = 'openrouter';
        }
        return storyboard;
      } catch (parseError) {
        var parseMsg = String((parseError && parseError.message) || parseError || '').toLowerCase();
        var canRepairRetry = !options?.malformedRetry && /failed to parse storyboard|no json object found|no panels found|malformed/i.test(parseMsg);
        if (canRepairRetry) {
          try {
            var retryPrompt = this.buildStoryboardPrompt(text, { ...(options || {}), malformedRetry: true });
            var retryResponse = await fetchWithTimeout(this.baseUrl + '/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://web2comics.local',
                'X-Title': 'Web2Comics'
              },
              body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: retryPrompt }],
                max_tokens: 2048
              })
            }, STORYBOARD_TIMEOUT_MS, 'OpenRouter storyboard retry');
            if (retryResponse.ok) {
              var retryData = await retryResponse.json();
              var retryContent = retryData.choices?.[0]?.message?.content || retryData.choices?.[0]?.message?.reasoning || '';
              if (retryContent) {
                var repairedStoryboard = this.parseStoryboardResponse(retryContent, { ...(options || {}), textModel: model, malformedRetry: true });
                if (repairedStoryboard && repairedStoryboard.settings) repairedStoryboard.settings.provider_text = 'openrouter';
                try { chrome.storage.local.get('debugLogs').then(function(r){ var logs = Array.isArray(r.debugLogs)?r.debugLogs:[]; logs.push({ ts: new Date().toISOString(), event: 'storyboard.parse_retry', data: { provider: 'openrouter' } }); return chrome.storage.local.set({ debugLogs: logs.slice(-500) }); }); } catch (_) {}
                return repairedStoryboard;
              }
            }
          } catch (_) {}
        }
        lastError = parseError;
      }
    }
    throw (lastError || new Error('Failed to generate storyboard with OpenRouter'));
  }
  extractImageFromOpenRouterMessage(message) {
    var msg = message || {};
    var images = Array.isArray(msg.images) ? msg.images : [];
    for (var i = 0; i < images.length; i++) {
      var entry = images[i] || {};
      var b64 = entry.b64_json || entry.image_base64 || '';
      if (b64) return { type: 'b64', data: b64 };
      var url = entry.image_url?.url || entry.url || '';
      if (url) return { type: 'url', data: url };
    }

    var content = msg.content;
    if (Array.isArray(content)) {
      for (var j = 0; j < content.length; j++) {
        var part = content[j] || {};
        var partB64 = part.b64_json || part.image_base64 || '';
        if (partB64) return { type: 'b64', data: partB64 };
        var partUrl = part.image_url?.url || part.image_url || '';
        if (partUrl) return { type: 'url', data: partUrl };
      }
    }
    return null;
  }

  async urlToDataUrl(url) {
    var response = await fetchWithTimeout(url, undefined, IMAGE_TIMEOUT_MS, 'OpenRouter image download');
    if (!response.ok) {
      throw new Error('Failed to download OpenRouter image');
    }
    var blob = await response.blob();
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async generateImage(prompt, options) {
    var apiKey = await this.getApiKey();
    if (!apiKey) throw new Error('OpenRouter API key not configured');

    var styleSpec = getStyleSpec(options);
    var languageSpec = getOutputLanguageSpec(options);
    var styledPrompt = String(prompt || '') + '. Style direction: ' + styleSpec.directive + '. Keep consistent comic panel aesthetics.';
    if (options && options.imageTemplate) {
      var renderedImageTemplate = renderPromptTemplate(options.imageTemplate, {
        panel_index: options.panelIndex != null ? (options.panelIndex + 1) : '',
        panel_count: options.panelCount || '',
        panel_caption: options.panelCaption || '',
        panel_summary: options.panelSummary || '',
        output_language: languageSpec.id,
        output_language_label: languageSpec.label,
        output_language_instruction: languageSpec.imageInstruction,
        style_prompt: styleSpec.directive
      });
      if (renderedImageTemplate && renderedImageTemplate.trim()) {
        styledPrompt = renderedImageTemplate;
      }
    }
    styledPrompt = appendLanguageInstruction(styledPrompt, languageSpec.imageInstruction);

    var requestedImageSize = String((options && options.imageSize) || '1K').trim();
    var openRouterImageSize = ['1K', '1.5K', '2K'].indexOf(requestedImageSize) >= 0 ? requestedImageSize : '1K';
    var imageCandidates = orderedCandidates(options && options.imageModel, this.imageModelCandidates);
    var lastError = null;
    for (var i = 0; i < imageCandidates.length; i++) {
      var model = imageCandidates[i];
      try {
        var response = await fetchWithTimeout(this.baseUrl + '/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://web2comics.local',
            'X-Title': 'Web2Comics'
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: styledPrompt }],
            modalities: ['image', 'text'],
            image_config: {
              aspect_ratio: '1:1',
              image_size: openRouterImageSize
            },
            max_tokens: 256
          })
        }, IMAGE_TIMEOUT_MS, 'OpenRouter image');

        if (!response.ok) {
          var errMessage = 'OpenRouter image request failed';
          try {
            var err = await response.json();
            errMessage =
              err.error?.message ||
              err.message ||
              err.error?.metadata?.raw ||
              (Array.isArray(err.errors) ? err.errors.map(function(e) { return e.message || JSON.stringify(e); }).join('; ') : '') ||
              JSON.stringify(err);
          } catch (_) {}
          lastError = new Error(errMessage);
          if (/not found|unsupported|model.*not available|no endpoints found|provider returned error|overloaded|temporar|payment required|402/i.test(errMessage)) {
            continue;
          }
          throw lastError;
        }

        var data = await response.json();
        var message = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message : {};
        var imageResult = this.extractImageFromOpenRouterMessage(message);
        if (!imageResult) {
          lastError = new Error('OpenRouter image response did not include image output');
          continue;
        }

        var imageData = '';
        if (imageResult.type === 'b64') {
          imageData = String(imageResult.data).startsWith('data:image/')
            ? imageResult.data
            : ('data:image/png;base64,' + imageResult.data);
        } else {
          imageData = await this.urlToDataUrl(imageResult.data);
        }
        return {
          imageData: imageData,
          providerMetadata: {
            model: model,
            endpoint: 'chat/completions',
            modalities: ['image', 'text'],
            image_transport: imageResult.type,
            size: openRouterImageSize
          }
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw (lastError || new Error('Failed to generate image with OpenRouter'));
  }
}

class HuggingFaceProvider {
  constructor() {
    this.baseUrl = 'https://router.huggingface.co/v1';
    this.imageBaseUrl = 'https://router.huggingface.co/hf-inference/models';
    this.modelCandidates = [
      'mistralai/Mistral-7B-Instruct-v0.2',
      'Qwen/Qwen2.5-7B-Instruct',
      'meta-llama/Llama-3.1-8B-Instruct',
      'meta-llama/Llama-3.3-70B-Instruct'
    ];
    this.imageModelCandidates = [
      'black-forest-labs/FLUX.1-schnell',
      'stabilityai/stable-diffusion-xl-base-1.0',
      'black-forest-labs/FLUX.1-dev'
    ];
  }
  get capabilities() {
    return { supportsImages: true, maxPromptLength: 12000, rateLimitBehavior: 'strict', costTag: 'free/paid' };
  }
  async getApiKey() {
    var result = await chrome.storage.local.get('apiKeys');
    return result.apiKeys?.huggingface;
  }
  buildStoryboardPrompt(text, options) {
    var panelCount = options.panelCount || 6;
    var styleSpec = getStyleSpec(options);
    var objectiveSpec = getObjectiveSpec(options);
    var languageSpec = getOutputLanguageSpec(options);
    var prompt = [
      'JSON only, no markdown.',
      'Schema: {"panels":[{"caption":string,"image_prompt":string}]}',
      STORYBOARD_CAPTION_IMAGE_PROMPT_RULE,
      STORYBOARD_CONTENT_GROUNDING_RULE,
      renderPromptTemplate(STORYBOARD_OBJECTIVE_RULE, {
        objective_label: objectiveSpec.label,
        objective_guidance: objectiveSpec.guidance
      }),
      IMAGE_PROMPT_GROUNDING_RULE,
      'Create a ' + panelCount + '-panel comic storyboard.',
      'Source title: ' + (options.sourceTitle || ''),
      'Source URL: ' + (options.sourceUrl || ''),
      'Objective: ' + objectiveSpec.label,
      'Output language: ' + languageSpec.label,
      'Language requirement: ' + languageSpec.captionInstruction,
      'Style requirement: ' + styleSpec.directive,
      'Content:',
      String(text || '').substring(0, 3500)
    ].join('\n');
    if (options && options.malformedRetry) {
      prompt += '\nIMPORTANT RETRY: ' + STORYBOARD_RETRY_JSON_ONLY_PROMPT;
    }
    if (options && options.parseFailureSummary) {
      prompt += '\n' + String(options.parseFailureSummary).substring(0, 320);
    }
    if (options && options.panelCountRetry) {
      prompt += '\nREMINDER: Return exactly ' + panelCount + ' panels in the top-level "panels" array.';
    }
    return prompt;
  }
  parseStoryboardResponse(responseText, options) {
    return parseStoryboardResponseShared(responseText, options, {
      providerTextId: 'huggingface',
      providerImageId: (options && options.providerImage) || 'huggingface'
    });
  }
  async generateStoryboard(text, options) {
    var apiKey = await this.getApiKey();
    if (!apiKey) throw new Error('Hugging Face API key not configured');

    var prompt = this.buildStoryboardPrompt(text, options || {});
    var lastError = null;

    var hfCandidates = orderedCandidates(options && options.textModel, this.modelCandidates);
    for (var i = 0; i < hfCandidates.length; i++) {
      var model = hfCandidates[i];
      try {
        var response = await fetchWithTimeout(this.baseUrl + '/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1200
          })
        }, STORYBOARD_TIMEOUT_MS, 'HuggingFace storyboard');

        if (!response.ok) {
          var errMessage = 'Hugging Face request failed';
          try {
            var err = await response.json();
            if (typeof err.error === 'string') errMessage = err.error;
            else if (err.error && typeof err.error === 'object') errMessage = JSON.stringify(err.error);
            else if (typeof err.message === 'string') errMessage = err.message;
            else errMessage = JSON.stringify(err);
          } catch (_) {}
          lastError = new Error(errMessage);
          if (/loading|too many requests|rate limit|not found|unsupported|not supported|provider returned error|temporar/i.test(errMessage)) {
            continue;
          }
          throw lastError;
        }

        var data = await response.json();
        var outputText = data?.choices?.[0]?.message?.content || '';

        if (!outputText) {
          lastError = new Error('Invalid response from Hugging Face Inference API');
          continue;
        }

        var storyboard;
        try {
          storyboard = this.parseStoryboardResponse(outputText, { ...options, textModel: model });
        } catch (parseError) {
          var parseMsg = String((parseError && parseError.message) || parseError || '').toLowerCase();
          var canRepairRetry = !options?.malformedRetry && /failed to parse storyboard|no json object found|no panels found|malformed/i.test(parseMsg);
          if (!canRepairRetry) throw parseError;
          var retryPrompt = this.buildStoryboardPrompt(text, { ...(options || {}), malformedRetry: true });
          var retryResponse = await fetchWithTimeout(this.baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + apiKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: 'user', content: retryPrompt }],
              max_tokens: 1200
            })
          }, STORYBOARD_TIMEOUT_MS, 'HuggingFace storyboard retry');
          if (!retryResponse.ok) throw parseError;
          var retryData = await retryResponse.json();
          var retryText = retryData?.choices?.[0]?.message?.content || '';
          if (!retryText) throw parseError;
          storyboard = this.parseStoryboardResponse(retryText, { ...(options || {}), textModel: model, malformedRetry: true });
          try { chrome.storage.local.get('debugLogs').then(function(r){ var logs = Array.isArray(r.debugLogs)?r.debugLogs:[]; logs.push({ ts: new Date().toISOString(), event: 'storyboard.parse_retry', data: { provider: 'huggingface' } }); return chrome.storage.local.set({ debugLogs: logs.slice(-500) }); }); } catch (_) {}
        }
        if (storyboard && storyboard.settings) {
          storyboard.settings.provider_text = 'huggingface';
          storyboard.settings.provider_image = (options && options.providerImage) || storyboard.settings.provider_image;
        }
        return storyboard;
      } catch (error) {
        lastError = error instanceof Error
          ? error
          : new Error(typeof error === 'string' ? error : JSON.stringify(error));
      }
    }

    throw (lastError || new Error('Failed to generate storyboard with Hugging Face Inference API'));
  }
  async generateImage(prompt, options) {
    var apiKey = await this.getApiKey();
    if (!apiKey) throw new Error('Hugging Face API key not configured');

    var styleSpec = getStyleSpec(options);
    var languageSpec = getOutputLanguageSpec(options);
    var styledPrompt = String(prompt || '') + '. Style direction: ' + styleSpec.directive + '. Keep consistent comic panel aesthetics.';
    if (options && options.imageTemplate) {
      var renderedImageTemplate = renderPromptTemplate(options.imageTemplate, {
        panel_index: options.panelIndex != null ? (options.panelIndex + 1) : '',
        panel_count: options.panelCount || '',
        panel_caption: options.panelCaption || '',
        panel_summary: options.panelSummary || '',
        output_language: languageSpec.id,
        output_language_label: languageSpec.label,
        output_language_instruction: languageSpec.imageInstruction,
        style_prompt: styleSpec.directive
      });
      if (renderedImageTemplate && renderedImageTemplate.trim()) {
        styledPrompt = renderedImageTemplate;
      }
    }
    styledPrompt = appendLanguageInstruction(styledPrompt, languageSpec.imageInstruction);

    var requestedSize = String((options && options.imageSize) || '512x512').trim();
    var hfSize = ['512x512', '768x768', '1024x1024'].indexOf(requestedSize) >= 0 ? requestedSize : '512x512';
    var dims = hfSize.split('x');
    var width = parseInt(dims[0], 10) || 512;
    var height = parseInt(dims[1], 10) || 512;
    var qualityMode = String((options && options.imageQuality) || 'fastest').trim().toLowerCase();
    var stepsByQuality = { fastest: 4, faster: 6, balanced: 10, high: 16 };
    var inferenceSteps = stepsByQuality[qualityMode] || 4;
    var hfImageCandidates = orderedCandidates(options && options.imageModel, this.imageModelCandidates);
    var lastError = null;
    for (var i = 0; i < hfImageCandidates.length; i++) {
      var model = hfImageCandidates[i];
      try {
        var response = await fetchWithTimeout(this.imageBaseUrl + '/' + encodeURIComponent(model), {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            inputs: styledPrompt,
            parameters: {
              width: width,
              height: height,
              num_inference_steps: inferenceSteps
            }
          })
        }, IMAGE_TIMEOUT_MS, 'HuggingFace image');

        if (!response.ok) {
          var errMessage = 'Hugging Face image request failed';
          try {
            var errText = await response.text();
            try {
              var errJson = errText ? JSON.parse(errText) : null;
              if (typeof errJson?.error === 'string') errMessage = errJson.error;
              else if (typeof errJson?.message === 'string') errMessage = errJson.message;
              else errMessage = JSON.stringify(errJson || {});
            } catch (_) {
              errMessage = errText || errMessage;
            }
          } catch (_) {}
          lastError = new Error(errMessage);
          if (/deprecated|unsupported|not supported|not found|provider returned error|temporar|loading|rate limit|too many requests/i.test(errMessage)) {
            continue;
          }
          throw lastError;
        }

        var contentType = response.headers.get('content-type') || '';
        if (/^image\//i.test(contentType)) {
          var blob = await response.blob();
          var imageData = await new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function() { resolve(reader.result); };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          return {
            imageData: imageData,
            providerMetadata: {
              model: model,
              endpoint: 'hf-inference',
              contentType: contentType,
              size: hfSize,
              quality: qualityMode,
              steps: inferenceSteps
            }
          };
        }

        var payload = null;
        try {
          payload = await response.json();
        } catch (_) {
          payload = null;
        }
        var base64Image = payload && (payload.image || (Array.isArray(payload.images) ? payload.images[0] : null));
        if (base64Image) {
          return {
            imageData: String(base64Image).startsWith('data:image/')
              ? base64Image
              : ('data:image/png;base64,' + base64Image),
            providerMetadata: {
              model: model,
              endpoint: 'hf-inference',
              contentType: contentType || 'application/json',
              size: hfSize,
              quality: qualityMode,
              steps: inferenceSteps
            }
          };
        }

        lastError = new Error('Invalid response from Hugging Face image endpoint');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw (lastError || new Error('Failed to generate image with Hugging Face Inference API'));
  }
}

class CloudflareProvider {
  constructor() {
    this.baseUrl = 'https://api.cloudflare.com/client/v4';
    this.textModelCandidates = [
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/meta/llama-3.1-8b-instruct-fast'
    ];
    this.imageModelCandidates = [
      '@cf/black-forest-labs/flux-1-schnell',
      '@cf/bytedance/stable-diffusion-xl-lightning'
    ];
    this.capabilities = { supportsImages: true, maxPromptLength: 12000, rateLimitBehavior: 'graceful', costTag: 'free-ish' };
  }
  async getAuthConfig() {
    var result = await chrome.storage.local.get(['cloudflareConfig', 'apiKeys', 'cloudflare']);
    var cfg = result.cloudflareConfig || result.cloudflare || {};
    var apiKeys = result.apiKeys || {};
    return {
      accountId: cfg.accountId || cfg.account_id || '',
      apiToken: cfg.apiToken || cfg.api_token || apiKeys.cloudflare || '',
      email: cfg.email || '',
      apiKey: cfg.apiKey || cfg.api_key || ''
    };
  }
  buildHeaders(auth) {
    var headers = { 'Content-Type': 'application/json' };
    if (auth.apiToken) {
      headers.Authorization = 'Bearer ' + auth.apiToken;
      return headers;
    }
    if (auth.email && auth.apiKey) {
      headers['X-Auth-Email'] = auth.email;
      headers['X-Auth-Key'] = auth.apiKey;
      return headers;
    }
    throw new Error('Cloudflare Workers AI credentials not configured (need account ID + token, or email + global key)');
  }
  async callModel(model, body) {
    var auth = await this.getAuthConfig();
    if (!auth.accountId) {
      throw new Error('Cloudflare account ID not configured');
    }
    var response = null;
    var lastFetchError = null;
    for (var attempt = 1; attempt <= 2; attempt++) {
      try {
        response = await fetchWithTimeout(this.baseUrl + '/accounts/' + auth.accountId + '/ai/run/' + model, {
          method: 'POST',
          headers: this.buildHeaders(auth),
          body: JSON.stringify(body)
        }, IMAGE_TIMEOUT_MS, 'Cloudflare AI ' + model);
        lastFetchError = null;
        break;
      } catch (fetchError) {
        lastFetchError = fetchError;
        if (attempt >= 2 || !isTransientProviderErrorMessage((fetchError && fetchError.message) || fetchError)) {
          throw fetchError;
        }
        await new Promise(function(resolve) { setTimeout(resolve, 400 * attempt); });
      }
    }
    if (!response && lastFetchError) throw lastFetchError;
    var data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = null;
    }
    if (!response.ok || (data && data.success === false)) {
      var errText = 'Cloudflare Workers AI request failed';
      if (data && data.errors && data.errors.length) {
        errText = data.errors.map(function(e) { return e.message || JSON.stringify(e); }).join('; ');
      } else if (data && data.result && data.result.error) {
        errText = String(data.result.error);
      }
      throw new Error(errText);
    }
    return data || {};
  }
  buildStoryboardPrompt(text, options) {
    var panelCount = options.panelCount || 6;
    var styleSpec = getStyleSpec(options);
    var objectiveSpec = getObjectiveSpec(options);
    var languageSpec = getOutputLanguageSpec(options);
    var prompt = [
      'Create a comic storyboard from the content below.',
      'JSON only, no markdown.',
      'Schema: {"panels":[{"caption":string,"image_prompt":string}]}',
      STORYBOARD_CAPTION_IMAGE_PROMPT_RULE,
      STORYBOARD_CONTENT_GROUNDING_RULE,
      renderPromptTemplate(STORYBOARD_OBJECTIVE_RULE, {
        objective_label: objectiveSpec.label,
        objective_guidance: objectiveSpec.guidance
      }),
      IMAGE_PROMPT_GROUNDING_RULE,
      'Panel count: ' + panelCount,
      'Source title: ' + (options.sourceTitle || ''),
      'Source URL: ' + (options.sourceUrl || ''),
      'Objective: ' + objectiveSpec.label,
      'Output language: ' + languageSpec.label,
      'Language requirement: ' + languageSpec.captionInstruction,
      'Style requirement: ' + styleSpec.directive,
      'Keep image prompts concise but descriptive and safe for image generation.',
      'Content:',
      String(text || '').substring(0, 7000)
    ].join('\n');
    if (options && options.malformedRetry) {
      prompt += '\nIMPORTANT RETRY: ' + STORYBOARD_RETRY_JSON_ONLY_PROMPT;
    }
    if (options && options.parseFailureSummary) {
      prompt += '\n' + String(options.parseFailureSummary).substring(0, 320);
    }
    if (options && options.panelCountRetry) {
      prompt += '\nREMINDER: Return exactly ' + panelCount + ' panels in the top-level "panels" array.';
    }
    return prompt;
  }
  parseStoryboardResponse(responseText, options) {
    return parseStoryboardResponseShared(responseText, options, {
      providerTextId: 'cloudflare-free',
      providerImageId: 'cloudflare-free'
    });
  }
  async generateStoryboard(text, options) {
    var prompt = this.buildStoryboardPrompt(text, options || {});
    var lastError = null;
    var cfTextCandidates = orderedCandidates(options && options.textModel, this.textModelCandidates);
    for (var i = 0; i < cfTextCandidates.length; i++) {
      var model = cfTextCandidates[i];
      try {
        var data = await this.callModel(model, {
          messages: [
            { role: 'system', content: 'You generate comic storyboards as strict JSON only.' },
            { role: 'system', content: STORYBOARD_CAPTION_IMAGE_PROMPT_RULE },
            { role: 'system', content: STORYBOARD_CONTENT_GROUNDING_RULE },
            { role: 'system', content: IMAGE_PROMPT_GROUNDING_RULE },
            { role: 'user', content: prompt }
          ],
          max_tokens: 2048,
          temperature: 0.6
        });
        var textOutput =
          (data.result && (data.result.response || data.result.output_text)) ||
          (Array.isArray(data.result) ? data.result.join('\n') : '') ||
          '';
        if (!textOutput) {
          throw new Error('No text returned by Cloudflare Workers AI');
        }
        var storyboard = this.parseStoryboardResponse(textOutput, {
          ...options,
          textModel: model
        });
        return storyboard;
      } catch (error) {
        lastError = error;
        if (/not found|unsupported|unknown model/i.test(String(error.message || error))) {
          continue;
        }
      }
    }
    throw (lastError || new Error('Failed to generate storyboard with Cloudflare Workers AI'));
  }
  async generateImage(prompt, options) {
    var styleSpec = getStyleSpec(options);
    var languageSpec = getOutputLanguageSpec(options);
    var basePrompt = String(prompt || '').replace(/\s+/g, ' ').trim();
    var enhancedPrompt = [
      basePrompt,
      'Style direction: ' + styleSpec.directive,
      'single comic panel illustration',
      'high readability composition'
    ].join('. ').replace(/\s+/g, ' ').trim();
    var primaryPrompt = enhancedPrompt.substring(0, 800);
    var fallbackPrompt = (
      'Comic panel illustration. ' +
      (basePrompt ? ('Scene: ' + basePrompt.substring(0, 220) + '. ') : '') +
      'Readable characters, safe editorial depiction, no logos, no text-heavy elements. ' +
      styleSpec.image
    ).replace(/\s+/g, ' ').trim().substring(0, 420);
    primaryPrompt = appendLanguageInstruction(primaryPrompt, languageSpec.imageInstruction);
    fallbackPrompt = appendLanguageInstruction(fallbackPrompt, languageSpec.imageInstruction);
    var lastError = null;
    var cfImageCandidates = orderedCandidates(options && options.imageModel, this.imageModelCandidates);
    for (var i = 0; i < cfImageCandidates.length; i++) {
      var model = cfImageCandidates[i];
      try {
        var data;
        try {
          data = await this.callModel(model, { prompt: primaryPrompt });
        } catch (firstError) {
          if (/prompt|input|too long|safety|content/i.test(String(firstError.message || firstError))) {
            data = await this.callModel(model, { prompt: fallbackPrompt });
          } else {
            throw firstError;
          }
        }
        var imageBase64 =
          (data.result && (data.result.image || data.result.b64_json || data.result.output)) ||
          '';
        if (!imageBase64) {
          throw new Error('No image returned by Cloudflare Workers AI');
        }
        return {
          imageData: 'data:image/png;base64,' + imageBase64,
          providerMetadata: { model: model }
        };
      } catch (error) {
        lastError = error;
        if (/not found|unsupported|unknown model/i.test(String(error.message || error))) {
          continue;
        }
      }
    }
    throw (lastError || new Error('Failed to generate image with Cloudflare Workers AI'));
  }
}

class ChromeSummarizerProvider {
  constructor() { 
    this.capabilities = { supportsImages: false, maxPromptLength: 10000, rateLimitBehavior: 'none', costTag: 'free' }; 
  }
  async generateStoryboard(text, options) {
    var panelCount = options.panelCount || 6;
    var panels = [];
    for (var i = 0; i < panelCount; i++) {
      panels.push({
        panel_id: 'panel_' + (i+1),
        beat_summary: 'Panel ' + (i+1) + ' summary',
        caption: 'Scene ' + (i+1),
        image_prompt: 'Comic panel showing key content'
      });
    }
    return { schema_version: '1.0', settings: { panel_count: panelCount, provider_text: 'chrome-summarizer' }, panels: panels };
  }
  async generateImage() { throw new Error('Chrome Summarizer does not support images'); }
}

// ============ PROVIDER REGISTRY ============

var TEXT_PROVIDERS = {
  'gemini-free': GeminiProvider,
  'cloudflare-free': CloudflareProvider,
  'chrome-summarizer': ChromeSummarizerProvider,
  'openai': OpenAIProvider,
  'openrouter': OpenRouterProvider,
  'huggingface': HuggingFaceProvider
};

var IMAGE_PROVIDERS = {
  'gemini-free': GeminiProvider,
  'cloudflare-free': CloudflareProvider,
  'openai': OpenAIProvider,
  'openrouter': OpenRouterProvider,
  'huggingface': HuggingFaceProvider
};

// ============ SERVICE WORKER ============

var ServiceWorker = function() {
  var self = this;
  this.SELECTION_CONTEXT_MENU_ID = 'web2comics-create-from-selection';
  this.SELECTION_CONTEXT_MENU_OPEN_PANEL_ID = 'web2comics-open-from-selection';
  
  this.currentJob = null;
  this.isProcessing = false;
  this.messageHandlers = {};
  
  this.init = function() {
    self.setupMessageHandlers();
    self.setupLifecycleHandlers();
    self.setupSelectionContextMenu();
  };

  this.appendDebugLog = function(event, data) {
    try {
      var debugEnabled = Boolean(self.currentJob && self.currentJob.settings && self.currentJob.settings.debug_flag);
      var verboseTestLogs = Boolean(globalThis && globalThis.__WEB2COMICS_TEST_LOGS__);
      if (!debugEnabled && !verboseTestLogs) return Promise.resolve();
      if (verboseTestLogs) {
        try { console.info('[Web2Comics:test][service-worker]', event, data || null); } catch (_) {}
      }

      return chrome.storage.local.get('debugLogs')
        .then(function(result) {
          var logs = Array.isArray(result.debugLogs) ? result.debugLogs : [];
          logs.push({
            ts: new Date().toISOString(),
            scope: 'service-worker',
            event: event,
            jobId: self.currentJob ? self.currentJob.id : null,
            data: data || null
          });
          if (logs.length > 500) logs.splice(0, logs.length - 500);
          return chrome.storage.local.set({ debugLogs: logs });
        })
        .catch(function() {});
    } catch (e) {
      return Promise.resolve();
    }
  };

  this.truncateForDebug = function(value, maxLen) {
    var str = String(value == null ? '' : value);
    var limit = maxLen || 240;
    return str.length > limit ? (str.substring(0, limit) + '...') : str;
  };

  this.getImageRefusalPolicy = function(settings) {
    var s = settings || {};
    return {
      mode: s.image_refusal_handling || 'rewrite_and_retry',
      showRewrittenBadge: s.show_rewritten_badge !== false,
      logRewrittenPrompts: !!s.log_rewritten_prompts,
      debugFlag: !!s.debug_flag
    };
  };

  this.isImageRefusalError = function(error) {
    var message = String((error && error.message) || error || '');
    return /content (policy|filter|safety)|moderation|policy violation|blocked|refused|safety system|not allowed/i.test(message);
  };

  this.escapeHtml = function(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  this.buildBlockedPanelPlaceholderDataUrl = function(text) {
    var label = self.escapeHtml(text || 'Panel blocked by image provider policy');
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#f8fafc"/><stop offset="100%" stop-color="#e2e8f0"/></linearGradient></defs>' +
      '<rect width="1024" height="768" fill="url(#g)"/>' +
      '<rect x="48" y="48" width="928" height="672" rx="28" fill="#ffffff" stroke="#cbd5e1" stroke-width="4"/>' +
      '<circle cx="128" cy="128" r="28" fill="#ef4444" opacity="0.9"/>' +
      '<path d="M112 112l32 32M144 112l-32 32" stroke="#fff" stroke-width="8" stroke-linecap="round"/>' +
      '<text x="96" y="210" fill="#0f172a" font-size="34" font-family="Segoe UI, Arial, sans-serif" font-weight="700">Blocked panel</text>' +
      '<text x="96" y="258" fill="#475569" font-size="24" font-family="Segoe UI, Arial, sans-serif">Panel blocked by image provider policy</text>' +
      '<foreignObject x="96" y="298" width="832" height="280">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Segoe UI,Arial,sans-serif;color:#334155;font-size:22px;line-height:1.4;">' +
      label +
      '</div></foreignObject>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };

  this.sanitizeTriggerTerms = function(prompt) {
    var out = String(prompt || '');
    var replacements = [
      [/\b(Trump|Biden|Putin|Zelenskyy|Netanyahu|Xi Jinping|Musk|Elon Musk|Kamala Harris|Obama|Clinton)\b/gi, 'a well-known public figure'],
      [/\barrest(ed|s|ing)?\b/gi, 'legal setting'],
      [/\bcorrupt(ion)?\b/gi, 'controversy'],
      [/\brigged election\b/gi, 'election dispute'],
      [/\bfraud\b/gi, 'dispute'],
      [/\bcriminal\b/gi, 'public figure'],
      [/\bguilty\b/gi, 'in a legal context'],
      [/\bscandal\b/gi, 'public controversy']
    ];
    replacements.forEach(function(entry) {
      out = out.replace(entry[0], entry[1]);
    });
    return out.replace(/\s+/g, ' ').trim();
  };

  this.rewriteImagePromptEditorial = function(prompt) {
    var out = String(prompt || '').replace(/\s+/g, ' ').trim();
    out = out
      .replace(/\b(exact likeness|deepfake|photorealistic clone|identical face)\b/gi, 'editorial portrait depiction')
      .replace(/\b(shocking|evil|corrupt|criminal|disgraced)\b/gi, 'notable')
      .replace(/\b(arrest|handcuffs?|jail cell)\b/gi, 'legal setting')
      .replace(/\bsmear\b/gi, 'editorial framing');
    if (!/editorial|journalistic|documentary|historical/i.test(out)) {
      out += '. Neutral editorial illustration in a journalistic context';
    }
    if (!/avoid text|no text/i.test(out)) {
      out += '. No text overlays';
    }
    return out;
  };

  this.buildBlockedPlaceholderImageResult = function(panel, panelIndex, refusalInfo) {
    var placeholderText = 'Panel blocked by image provider policy';
    return {
      imageData: self.buildBlockedPanelPlaceholderDataUrl(placeholderText),
      providerMetadata: {
        blocked_placeholder: true,
        refusal_handling: refusalInfo || {
          mode: 'show_blocked',
          blockedPlaceholder: true
        }
      }
    };
  };

  this.generateImageWithRefusalHandling = function(imageProvider, panel, panelIndex, totalPanels, job, imagePromptTemplate) {
    var settings = (job && job.settings) || {};
    var policy = self.getImageRefusalPolicy(settings);
    var prompt = panel.image_prompt || '';
    var baseOptions = {
      negativePrompt: panel.negative_prompt,
      style: settings.style_id,
      imageModel: settings.image_model,
      imageQuality: settings.image_quality,
      imageSize: settings.image_size,
      outputLanguage: settings.output_language || 'en',
      customStyleTheme: settings.custom_style_theme,
      customStyleName: settings.custom_style_name,
      panelIndex: panelIndex,
      panelCount: totalPanels,
      panelCaption: panel.caption || '',
      panelSummary: panel.beat_summary || '',
      sourceTitle: job.sourceTitle,
      sourceUrl: job.sourceUrl,
      imageTemplate: imagePromptTemplate
    };

    function attachRefusalMetadata(result, refusalMeta) {
      var enriched = result || {};
      enriched.providerMetadata = {
        ...(enriched.providerMetadata || {}),
        refusal_handling: refusalMeta || null
      };
      if (policy.logRewrittenPrompts || policy.debugFlag) {
        enriched.refusalDebug = {
          originalPrompt: prompt,
          effectivePrompt: refusalMeta && refusalMeta.rewrittenPrompt ? refusalMeta.rewrittenPrompt : prompt
        };
      }
      return enriched;
    }

    function generateImageAttempt(promptToUse, label) {
      var selectedProviderId = settings.provider_image;
      var providerIds = [selectedProviderId].concat(self.getBudgetFallbackImageProviderOrder(selectedProviderId));

      function attemptProvider(idx, previousError) {
        if (idx >= providerIds.length) throw (previousError || new Error('Image generation failed'));
        if (idx > 0 && !self.isBudgetProviderError(previousError)) throw previousError;
        var providerId = providerIds[idx];
        var providerInstance = idx === 0 ? imageProvider : self.getImageProvider(providerId);
        if (idx > 0) {
          self.pushProgressEvent('provider.fallback', 'Switching image provider after budget/quota error', 'Panel ' + (panelIndex + 1) + ': ' + selectedProviderId + ' -> ' + providerId);
          self.appendDebugLog('provider.image.fallback', {
            panelIndex: panelIndex,
            from: selectedProviderId,
            to: providerId,
            reason: (previousError && previousError.message) || String(previousError || '')
          });
        }
        return withTimeout(
          providerInstance.generateImage(promptToUse, baseOptions),
          IMAGE_TIMEOUT_MS,
          label || ('Image generation panel ' + (panelIndex + 1))
        ).then(function(result) {
          var enriched = result || {};
          enriched.providerMetadata = {
            ...(enriched.providerMetadata || {}),
            provider_id: providerId
          };
          if (providerId !== selectedProviderId) {
            enriched.providerMetadata.fallback_from_provider = selectedProviderId;
            settings.provider_image_effective = providerId;
          }
          return enriched;
        }).catch(function(error) {
          return attemptProvider(idx + 1, error);
        });
      }

      return attemptProvider(0, null);
    }

    function setRetryState(state) {
      if (!job) return;
      if (state) {
        job.retryState = {
          panelIndex: panelIndex,
          panelId: panel && panel.panel_id ? panel.panel_id : ('panel_' + (panelIndex + 1)),
          provider: (state.provider || settings.provider_image || ''),
          type: state.type || 'retry',
          attempt: state.attempt || 1,
          delayMs: state.delayMs || 0,
          retryAt: state.retryAt || new Date(Date.now() + (state.delayMs || 0)).toISOString(),
          message: state.message || ''
        };
      } else {
        delete job.retryState;
      }
      job.updatedAt = new Date().toISOString();
      self.saveJob();
      self.notifyProgress();
    }

    return generateImageAttempt(prompt, 'Image generation panel ' + (panelIndex + 1)).then(function(result) {
      setRetryState(null);
      return attachRefusalMetadata(result, {
        mode: policy.mode,
        retried: false,
        blockedPlaceholder: false
      });
    }).catch(function(error) {
      var errMsg = (error && error.message) || String(error);
      if (isTransientProviderErrorMessage(errMsg)) {
        var isRateLimited = isRateLimitProviderErrorMessage(errMsg);
        var retryDelayMs = isRateLimited ? 6000 : 1500;
        self.pushProgressEvent(
          'panel.retry',
          (isRateLimited ? 'Rate limited, retrying panel ' : 'Retrying panel ') + (panelIndex + 1),
          errMsg
        );
        self.appendDebugLog('panel.image.retry_transient', {
          panelIndex: panelIndex,
          panelId: panel.panel_id || null,
          message: errMsg,
          rateLimited: isRateLimited,
          delayMs: retryDelayMs
        });
        if (isRateLimited) {
          setRetryState({
            provider: settings.provider_image,
            type: 'rate_limit',
            attempt: 1,
            delayMs: retryDelayMs,
            message: errMsg
          });
        } else {
          setRetryState({
            provider: settings.provider_image,
            type: 'transient',
            attempt: 1,
            delayMs: retryDelayMs,
            message: errMsg
          });
        }
        return waitMs(retryDelayMs).then(function() {
          setRetryState(null);
          return generateImageAttempt(prompt, 'Image generation retry panel ' + (panelIndex + 1));
        }).then(function(result) {
          return attachRefusalMetadata(result, {
            mode: policy.mode,
            retried: true,
            transient_retry: true,
            blockedPlaceholder: false
          });
        }).catch(function(secondError) {
          var secondMsg = (secondError && secondError.message) || String(secondError);
          if (isRateLimitProviderErrorMessage(secondMsg)) {
            var secondDelayMs = 12000;
            self.pushProgressEvent('panel.retry', 'Rate limited again, retrying panel ' + (panelIndex + 1), secondMsg);
            self.appendDebugLog('panel.image.retry_rate_limit_again', {
              panelIndex: panelIndex,
              panelId: panel.panel_id || null,
              message: secondMsg,
              delayMs: secondDelayMs
            });
            setRetryState({
              provider: settings.provider_image,
              type: 'rate_limit',
              attempt: 2,
              delayMs: secondDelayMs,
              message: secondMsg
            });
            return waitMs(secondDelayMs).then(function() {
              setRetryState(null);
              return generateImageAttempt(prompt, 'Image generation second retry panel ' + (panelIndex + 1));
            }).then(function(result2) {
              return attachRefusalMetadata(result2, {
                mode: policy.mode,
                retried: true,
                transient_retry: true,
                blockedPlaceholder: false
              });
            });
          }
          throw secondError;
        });
      }
      setRetryState(null);
      if (!self.isImageRefusalError(error)) {
        throw error;
      }

      var refusalMessage = (error && error.message) || String(error);
      self.pushProgressEvent('panel.refused', 'Panel ' + (panelIndex + 1) + ' blocked by image provider policy', refusalMessage);
      self.appendDebugLog('panel.image.refused', {
        panelIndex: panelIndex,
        panelId: panel.panel_id || null,
        mode: policy.mode,
        message: refusalMessage
      });

      if (policy.mode === 'show_blocked') {
        return attachRefusalMetadata(
          self.buildBlockedPlaceholderImageResult(panel, panelIndex, {
            mode: policy.mode,
            retried: false,
            blockedPlaceholder: true,
            refusalMessage: refusalMessage
          }),
          {
            mode: policy.mode,
            retried: false,
            blockedPlaceholder: true,
            refusalMessage: refusalMessage
          }
        );
      }

      var rewrittenPrompt = policy.mode === 'replace_people_and_triggers'
        ? self.sanitizeTriggerTerms(prompt)
        : self.rewriteImagePromptEditorial(prompt);

      if (!rewrittenPrompt || rewrittenPrompt === prompt) {
        rewrittenPrompt = self.rewriteImagePromptEditorial(prompt);
      }

      self.pushProgressEvent('panel.retry', 'Retrying panel ' + (panelIndex + 1) + ' with safer prompt', policy.mode);
      if (policy.logRewrittenPrompts) {
        self.appendDebugLog('panel.image.retry_prompt', {
          panelIndex: panelIndex,
          mode: policy.mode,
          originalPrompt: prompt,
          rewrittenPrompt: rewrittenPrompt
        });
      }

      return generateImageAttempt(rewrittenPrompt, 'Image generation rewritten retry panel ' + (panelIndex + 1)).then(function(result) {
        return attachRefusalMetadata(result, {
          mode: policy.mode,
          retried: true,
          rewritten: true,
          blockedPlaceholder: false,
          showRewrittenBadge: policy.showRewrittenBadge,
          originalPrompt: (policy.logRewrittenPrompts || policy.debugFlag) ? prompt : undefined,
          rewrittenPrompt: (policy.logRewrittenPrompts || policy.debugFlag) ? rewrittenPrompt : undefined
        });
      }).catch(function(retryError) {
        self.appendDebugLog('panel.image.retry_failed', {
          panelIndex: panelIndex,
          mode: policy.mode,
          message: (retryError && retryError.message) || String(retryError)
        });
        return attachRefusalMetadata(
          self.buildBlockedPlaceholderImageResult(panel, panelIndex, {
            mode: policy.mode,
            retried: true,
            rewritten: true,
            blockedPlaceholder: true,
            refusalMessage: (retryError && retryError.message) || String(retryError),
            showRewrittenBadge: policy.showRewrittenBadge,
            originalPrompt: (policy.logRewrittenPrompts || policy.debugFlag) ? prompt : undefined,
            rewrittenPrompt: (policy.logRewrittenPrompts || policy.debugFlag) ? rewrittenPrompt : undefined
          }),
          {
            mode: policy.mode,
            retried: true,
            rewritten: true,
            blockedPlaceholder: true,
            refusalMessage: (retryError && retryError.message) || String(retryError),
            showRewrittenBadge: policy.showRewrittenBadge,
            originalPrompt: (policy.logRewrittenPrompts || policy.debugFlag) ? prompt : undefined,
            rewrittenPrompt: (policy.logRewrittenPrompts || policy.debugFlag) ? rewrittenPrompt : undefined
          }
        );
      });
    });
  };

  this.pushProgressEvent = function(type, message, detail) {
    if (!self.currentJob) return;
    var events = Array.isArray(self.currentJob.progressEvents) ? self.currentJob.progressEvents : [];
    events.push({
      ts: new Date().toISOString(),
      type: type,
      message: message,
      detail: detail ? self.truncateForDebug(detail, 600) : ''
    });
    if (events.length > 50) {
      events.splice(0, events.length - 50);
    }
    self.currentJob.progressEvents = events;
  };

  this.trackMetric = function(eventName, payload) {
    var safeEvent = String(eventName || '').trim();
    if (!safeEvent) return Promise.resolve();
    var data = payload && typeof payload === 'object' ? payload : {};
    return chrome.storage.local.get('growthMetrics')
      .then(function(result) {
        var metrics = result && result.growthMetrics && typeof result.growthMetrics === 'object'
          ? result.growthMetrics
          : { events: [], counters: {} };
        if (!Array.isArray(metrics.events)) metrics.events = [];
        if (!metrics.counters || typeof metrics.counters !== 'object') metrics.counters = {};
        metrics.events.push({
          ts: new Date().toISOString(),
          event: safeEvent,
          data: data
        });
        if (metrics.events.length > 1000) metrics.events = metrics.events.slice(-1000);
        metrics.counters[safeEvent] = Number(metrics.counters[safeEvent] || 0) + 1;
        return chrome.storage.local.set({ growthMetrics: metrics });
      })
      .catch(function() {});
  };

  this.extractPanelFacts = function(panel, sourceText) {
    var caption = String((panel && (panel.caption || panel.beat_summary || panel.summary || panel.title || panel.text)) || '').trim();
    var text = String(sourceText || '');
    var sentencePool = text
      .split(/[.!?]\s+/)
      .map(function(s) { return s.trim(); })
      .filter(Boolean)
      .slice(0, 220);
    var fallbackSnippet = sentencePool[0] || '';
    var captionTerms = caption.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || [];
    var snippet = '';
    if (captionTerms.length) {
      for (var i = 0; i < sentencePool.length; i++) {
        var s = sentencePool[i];
        var lower = s.toLowerCase();
        var hits = 0;
        for (var j = 0; j < captionTerms.length; j++) {
          if (lower.indexOf(captionTerms[j]) >= 0) hits += 1;
          if (hits >= 2) break;
        }
        if (hits >= 2) {
          snippet = s;
          break;
        }
      }
    }
    if (!snippet) snippet = fallbackSnippet;
    var entityMatches = (snippet.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || []).slice(0, 6);
    var dateMatches = (snippet.match(/\b(?:\d{4}|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|[A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/g) || []).slice(0, 4);
    var numberMatches = (snippet.match(/\b\d[\d,]*(?:\.\d+)?%?\b/g) || []).slice(0, 5);
    return {
      entities: entityMatches,
      dates: dateMatches,
      numbers: numberMatches,
      source_snippet: String(snippet || '').slice(0, 300)
    };
  };

  this.enrichStoryboardFacts = function(storyboard, sourceText) {
    if (!storyboard || !Array.isArray(storyboard.panels)) return storyboard;
    storyboard.panels = storyboard.panels.map(function(panel) {
      var next = panel && typeof panel === 'object' ? panel : {};
      next.facts_used = self.extractPanelFacts(next, sourceText);
      return next;
    });
    return storyboard;
  };

  this.transformPanelCaption = function(panel, action) {
    var p = panel && typeof panel === 'object' ? panel : {};
    var currentCaption = normalizeLooseTextValue(
      p.caption || p.beat_summary || p.summary || p.title || p.text || p.narration || p.description || p.dialogue
    ) || 'Key moment from the source';
    var facts = p.facts_used || {};
    var entity = Array.isArray(facts.entities) && facts.entities.length ? facts.entities[0] : '';
    var number = Array.isArray(facts.numbers) && facts.numbers.length ? facts.numbers[0] : '';
    var date = Array.isArray(facts.dates) && facts.dates.length ? facts.dates[0] : '';
    var snippet = normalizeLooseTextValue(facts.source_snippet || '');

    if (action === 'make-simpler') {
      return currentCaption
        .replace(/\s+/g, ' ')
        .split(/[;:,.]/)[0]
        .slice(0, 130)
        .trim();
    }

    if (action === 'make-factual') {
      var factual = [entity, date, number].filter(Boolean).join(' ');
      if (factual) return ('Fact check: ' + factual + '.').slice(0, 180);
      if (snippet) return ('Fact check: ' + snippet).slice(0, 180);
      return ('Fact check: ' + currentCaption).slice(0, 180);
    }

    if (action === 'regenerate-caption') {
      if (snippet) return snippet.slice(0, 180);
      return ('Updated: ' + currentCaption).slice(0, 180);
    }

    return currentCaption;
  };

  this.handleEditPanel = function(message) {
    var payload = message && message.payload ? message.payload : {};
    var panelIndex = Number(payload.panelIndex);
    var action = String(payload.action || '').trim();
    if (!Number.isInteger(panelIndex) || panelIndex < 0) {
      throw new Error('panelIndex is required');
    }
    if (!action) {
      throw new Error('action is required');
    }
    if (!self.currentJob || !self.currentJob.storyboard || !Array.isArray(self.currentJob.storyboard.panels)) {
      throw new Error('No active comic available');
    }
    var panels = self.currentJob.storyboard.panels;
    if (panelIndex >= panels.length) throw new Error('Invalid panel index');
    var panel = panels[panelIndex] || {};

    if (action === 'regenerate-image') {
      var provider = self.getImageProvider(self.currentJob.settings.provider_image);
      panel.runtime_status = 'rendering';
      self.currentJob.updatedAt = new Date().toISOString();
      self.saveJob();
      self.notifyProgress();
      return self.generateImageWithRefusalHandling(
        provider,
        panel,
        panelIndex,
        panels.length,
        self.currentJob,
        null
      ).then(function(imageResult) {
        if (!imageResult || !imageResult.imageData) throw new Error('Provider returned no image data');
        panel.artifacts = {
          image_blob_ref: imageResult.imageData,
          provider_metadata: imageResult.providerMetadata || null
        };
        panel.runtime_status = 'completed';
        self.currentJob.updatedAt = new Date().toISOString();
        self.saveJob();
        self.notifyProgress();
        self.trackMetric('panel_edit_regenerate_image', {
          panel_index: panelIndex,
          domain: (() => { try { return new URL(String(self.currentJob.sourceUrl || '')).hostname; } catch (_) { return ''; } })()
        });
        return self.addCompletedJobToHistory(self.currentJob).then(function() {
          return { job: self.currentJob };
        });
      });
    }

    panel.caption = self.transformPanelCaption(panel, action);
    panel.facts_used = self.extractPanelFacts(panel, self.currentJob.extractedText || '');
    self.currentJob.updatedAt = new Date().toISOString();
    self.saveJob();
    self.notifyProgress();
    self.trackMetric('panel_edit_caption', { action: action, panel_index: panelIndex });
    return self.addCompletedJobToHistory(self.currentJob).then(function() {
      return { job: self.currentJob };
    });
  };

  this.handleTrackMetric = function(message) {
    var payload = message && message.payload ? message.payload : {};
    return self.trackMetric(payload.event, payload).then(function() { return { tracked: true }; });
  };
  
  this.setupMessageHandlers = function() {
    self.messageHandlers['START_GENERATION'] = function(msg) { return self.handleStartGeneration(msg); };
    self.messageHandlers['CANCEL_GENERATION'] = function(msg) { return self.handleCancelGeneration(msg); };
    self.messageHandlers['GET_STATUS'] = function(msg) { return self.handleGetStatus(msg); };
    self.messageHandlers['TRACK_METRIC'] = function(msg) { return self.handleTrackMetric(msg); };
    self.messageHandlers['EDIT_PANEL'] = function(msg) { return self.handleEditPanel(msg); };
    self.messageHandlers['TEST_PROVIDER_MODEL'] = function(msg) { return self.handleTestProviderModel(msg); };
    self.messageHandlers['VALIDATE_PROVIDER_REMOTE'] = function(msg) { return self.handleValidateProviderRemote(msg); };
    self.messageHandlers['GOOGLE_DRIVE_GET_STATUS'] = function(msg) { return self.handleGoogleDriveGetStatus(msg); };
    self.messageHandlers['GOOGLE_DRIVE_CONNECT'] = function(msg) { return self.handleGoogleDriveConnect(msg); };
    self.messageHandlers['GOOGLE_DRIVE_DISCONNECT'] = function(msg) { return self.handleGoogleDriveDisconnect(msg); };
    self.messageHandlers['FACEBOOK_GET_STATUS'] = function(msg) { return self.handleFacebookGetStatus(msg); };
    self.messageHandlers['FACEBOOK_CONNECT'] = function(msg) { return self.handleFacebookConnect(msg); };
    self.messageHandlers['FACEBOOK_DISCONNECT'] = function(msg) { return self.handleFacebookDisconnect(msg); };
    self.messageHandlers['X_GET_STATUS'] = function(msg) { return self.handleXGetStatus(msg); };
    self.messageHandlers['X_CONNECT'] = function(msg) { return self.handleXConnect(msg); };
    self.messageHandlers['X_DISCONNECT'] = function(msg) { return self.handleXDisconnect(msg); };
  };
  
  this.setupLifecycleHandlers = function() {
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
      var handler = self.messageHandlers[message.type];
      if (globalThis && globalThis.__WEB2COMICS_TEST_LOGS__) {
        try {
          console.info('[Web2Comics:test][service-worker] message.received', {
            type: message && message.type,
            hasHandler: !!handler
          });
        } catch (_) {}
      }
      if (handler) {
        Promise.resolve(handler(message))
          .then(function(result) { sendResponse({ success: true, ...result }); })
          .catch(function(error) { sendResponse({ success: false, error: error.message }); });
      }
      return true;
    });

    // Guard alarms API so the worker can still register if permission/API is unavailable.
    if (chrome.alarms && chrome.alarms.create && chrome.alarms.onAlarm) {
      chrome.alarms.create('cleanup', { periodInMinutes: 5 });
      chrome.alarms.onAlarm.addListener(function(alarm) {
        if (alarm.name === 'cleanup') self.cleanupOldJobs();
      });
    } else {
      console.warn('chrome.alarms API unavailable; periodic cleanup disabled');
    }
  };

  this.setupSelectionContextMenu = function() {
    if (!chrome.contextMenus || !chrome.contextMenus.create || !chrome.contextMenus.onClicked) {
      return;
    }

    function createMenu() {
      try {
        chrome.contextMenus.create({
          id: self.SELECTION_CONTEXT_MENU_ID,
          title: 'Generate comic from selected text (Default)',
          contexts: ['selection']
        }, function() {
          var err = chrome.runtime && chrome.runtime.lastError;
          if (err && !/duplicate id/i.test(String(err.message || ''))) {
            console.warn('Failed to create selection context menu:', err.message || err);
          }
        });
        chrome.contextMenus.create({
          id: self.SELECTION_CONTEXT_MENU_OPEN_PANEL_ID,
          title: 'Open Create Comic with selected text',
          contexts: ['selection']
        }, function() {
          var err = chrome.runtime && chrome.runtime.lastError;
          if (err && !/duplicate id/i.test(String(err.message || ''))) {
            console.warn('Failed to create selection context menu:', err.message || err);
          }
        });
      } catch (error) {
        console.warn('Failed to create selection context menu:', error);
      }
    }

    try {
      if (chrome.contextMenus.removeAll) {
        chrome.contextMenus.removeAll(function() {
          createMenu();
        });
      } else {
        createMenu();
      }
    } catch (error) {
      console.warn('Failed to reset selection context menu:', error);
      createMenu();
    }

    chrome.contextMenus.onClicked.addListener(function(info, tab) {
      if (!info) return;
      if (info.menuItemId === self.SELECTION_CONTEXT_MENU_ID) {
        self.handleSelectionContextMenuGenerateClick(info, tab)
          .catch(function(error) {
            console.error('Selection context menu generation failed:', error);
          });
        return;
      }
      if (info.menuItemId === self.SELECTION_CONTEXT_MENU_OPEN_PANEL_ID) {
        self.handleSelectionContextMenuOpenComposerClick(info, tab)
          .catch(function(error) {
            console.error('Selection context menu composer open failed:', error);
          });
      }
    });
  };

  this.getContextMenuGenerationSettings = function(userSettings) {
    var settings = userSettings || {};
    var providerText = settings.activeTextProvider || 'gemini-free';
    var providerImage = settings.activeImageProvider || 'gemini-free';
    var textModel = settings.textModel || '';
    var imageModel = settings.imageModel || '';
    var imageQuality = '';
    var imageSize = '';

    if (providerText === 'gemini-free') textModel = settings.geminiTextModel || 'gemini-2.5-flash';
    if (providerText === 'cloudflare-free') textModel = settings.cloudflareTextModel || '@cf/meta/llama-3.1-8b-instruct';
    if (providerText === 'openrouter') textModel = settings.openrouterTextModel || 'openai/gpt-oss-20b:free';
    if (providerText === 'huggingface') textModel = settings.huggingfaceTextModel || 'mistralai/Mistral-7B-Instruct-v0.2';
    if (providerText === 'openai') textModel = settings.textModel || 'gpt-4o-mini';

    if (providerImage === 'gemini-free') imageModel = settings.geminiImageModel || 'gemini-2.0-flash-exp-image-generation';
    if (providerImage === 'cloudflare-free') imageModel = settings.cloudflareImageModel || '@cf/black-forest-labs/flux-1-schnell';
    if (providerImage === 'openrouter') {
      imageModel = settings.openrouterImageModel || 'google/gemini-2.5-flash-image-preview';
      imageSize = settings.openrouterImageSize || '1K';
    }
    if (providerImage === 'huggingface') {
      imageModel = settings.huggingfaceImageModel || 'black-forest-labs/FLUX.1-schnell';
      imageSize = settings.huggingfaceImageSize || '512x512';
      imageQuality = settings.huggingfaceImageQuality || 'fastest';
    }
    if (providerImage === 'openai') {
      imageModel = settings.imageModel || 'dall-e-2';
      imageSize = settings.openaiImageSize || '256x256';
      imageQuality = settings.openaiImageQuality || 'standard';
    }

    return {
      panel_count: settings.panelCount || 3,
      objective: settings.objective || 'summarize',
      output_language: settings.outputLanguage || 'en',
      detail_level: settings.detailLevel || 'low',
      style_id: settings.styleId || 'default',
      caption_len: settings.captionLength || 'short',
      provider_text: providerText,
      provider_image: providerImage,
      text_model: textModel,
      image_model: imageModel,
      image_quality: imageQuality,
      image_size: imageSize,
      custom_style_theme: settings.customStyleTheme || '',
      custom_style_name: settings.customStyleName || '',
      character_consistency: !!settings.characterConsistency,
      debug_flag: !!settings.debugFlag,
      image_refusal_handling: settings.imageRefusalHandling || 'rewrite_and_retry',
      show_rewritten_badge: settings.showRewrittenBadge !== false,
      log_rewritten_prompts: !!settings.logRewrittenPrompts
    };
  };

  this.getSelectionContextPayload = function(info, tab) {
    var selectedText = String((info && info.selectionText) || '').trim();
    if (!selectedText) {
      return null;
    }
    return {
      selectedText: selectedText,
      sourceUrl: (tab && tab.url) || '',
      sourceTitle: (tab && tab.title) || 'Selected text'
    };
  };

  this.handleSelectionContextMenuGenerateClick = function(info, tab) {
    var payload = self.getSelectionContextPayload(info, tab);
    if (!payload) {
      return Promise.resolve({ started: false, reason: 'empty-selection' });
    }
    return Promise.resolve()
      .then(function() {
        return chrome.storage.local.get('settings');
      })
      .then(function(result) {
        var savedSettings = result && result.settings ? result.settings : {};
        return self.getContextMenuGenerationSettings(savedSettings);
      })
      .catch(function() {
        return self.getContextMenuGenerationSettings({});
      })
      .then(function(generationSettings) {
        return Promise.resolve()
      .then(function() {
        return self.handleStartGeneration({
          payload: {
            text: payload.selectedText,
            url: payload.sourceUrl,
            title: payload.sourceTitle,
            settings: generationSettings
          }
        });
      })
      .then(function(startResult) {
        if (!startResult || !startResult.started) return startResult;
        var openViewer = Promise.resolve();
        if (chrome.sidePanel && chrome.sidePanel.open && tab && tab.windowId != null) {
          openViewer = Promise.resolve(chrome.sidePanel.open({ windowId: tab.windowId })).catch(function() {});
        }
        return openViewer.then(function() {
          if (chrome.action && chrome.action.openPopup) {
            return Promise.resolve(chrome.action.openPopup()).catch(function() {});
          }
        }).then(function() {
          return startResult;
        });
      });
      });
  };

  this.handleSelectionContextMenuOpenComposerClick = function(info, tab, options) {
    var payload = self.getSelectionContextPayload(info, tab);
    if (!payload) {
      return Promise.resolve({ opened: false, reason: 'empty-selection' });
    }
    return chrome.storage.local.set({
      pendingComposerPrefill: {
        text: payload.selectedText,
        sourceUrl: payload.sourceUrl,
        sourceTitle: payload.sourceTitle,
        createdAt: new Date().toISOString(),
        source: 'context-menu-selection'
      }
    }).then(function() {
      var skipOpenPopup = !!(options && options.skipOpenPopup);
      if (!skipOpenPopup && chrome.action && chrome.action.openPopup) {
        return Promise.resolve(chrome.action.openPopup()).catch(function() {});
      }
    }).then(function() {
      return { opened: true };
    });
  };
  
  this.handleSelectionContextMenuClick = function(info, tab) {
    return self.handleSelectionContextMenuGenerateClick(info, tab);
  };
  
  this.getTextProvider = function(providerId) {
    var ProviderClass = TEXT_PROVIDERS[providerId];
    if (!ProviderClass) throw new Error('Unknown text provider: ' + providerId);
    return new ProviderClass();
  };
  
  this.getImageProvider = function(providerId) {
    var ProviderClass = IMAGE_PROVIDERS[providerId];
    if (!ProviderClass) throw new Error('Unknown image provider: ' + providerId + '. Image generation not supported.');
    return new ProviderClass();
  };

  this.isBudgetProviderError = function(error) {
    return isBudgetProviderErrorMessage((error && error.message) || error);
  };

  this.getBudgetFallbackTextProviderOrder = function(currentProviderId) {
    var preferred = ['gemini-free', 'cloudflare-free', 'openrouter', 'huggingface', 'openai'];
    return preferred.filter(function(id, index, arr) {
      return id !== currentProviderId && arr.indexOf(id) === index;
    });
  };

  this.getBudgetFallbackImageProviderOrder = function(currentProviderId) {
    var preferred = ['gemini-free', 'cloudflare-free', 'huggingface', 'openrouter', 'openai'];
    return preferred.filter(function(id, index, arr) {
      return id !== currentProviderId && arr.indexOf(id) === index;
    });
  };

  this.generateStoryboardWithBudgetFallback = function(job, resolvedPromptTemplates) {
    var settings = job.settings || {};
    var providerIds = [settings.provider_text].concat(self.getBudgetFallbackTextProviderOrder(settings.provider_text));
    var attempted = [];

    function buildTextOptions(extra) {
      var overrides = extra && typeof extra === 'object' ? extra : {};
      return {
        panelCount: settings.panel_count,
        objective: settings.objective || 'summarize',
        outputLanguage: settings.output_language || 'en',
        detailLevel: settings.detail_level,
        styleId: settings.style_id,
        captionLength: settings.caption_len,
        textModel: settings.text_model,
        characterConsistency: settings.character_consistency,
        customStyleTheme: settings.custom_style_theme,
        customStyleName: settings.custom_style_name,
        sourceTitle: job.sourceTitle,
        sourceUrl: job.sourceUrl,
        storyboardTemplate: resolvedPromptTemplates.text && resolvedPromptTemplates.text.storyboard,
        providerImage: settings.provider_image,
        malformedRetry: !!overrides.malformedRetry,
        parseFailureSummary: overrides.parseFailureSummary || '',
        panelCountRetry: !!overrides.panelCountRetry
      };
    }

    function isMalformedStoryboardError(error) {
      var msg = String((error && error.message) || error || '').toLowerCase();
      return /failed to parse storyboard|no panels found|no json object found|malformed/i.test(msg);
    }

    function isTooFewPanels(storyboard) {
      var requested = Number(settings.panel_count || 0);
      var actual = storyboard && Array.isArray(storyboard.panels) ? storyboard.panels.length : 0;
      if (requested <= 1) return false;
      return actual > 0 && actual < requested;
    }

    function validateStoryboardBeforeImages(storyboard, providerId) {
      var validated = validateStoryboardContract(storyboard, settings.panel_count);
      var s = validated.storyboard;
      if (!s.panels.length) {
        var emptyErr = new Error('Storyboard has no panels after validation');
        emptyErr.malformedStoryboard = true;
        emptyErr.providerId = providerId;
        throw emptyErr;
      }
      return s;
    }

    function generateWithMalformedRetry(provider, providerId) {
      return withTimeout(provider.generateStoryboard(job.extractedText, buildTextOptions()), STORYBOARD_TIMEOUT_MS, 'Storyboard generation')
        .catch(function(error) {
          if (!isMalformedStoryboardError(error)) throw error;
          self.pushProgressEvent('storyboard.retry', 'Retrying malformed storyboard response', 'Provider: ' + providerId);
          self.appendDebugLog('storyboard.parse_retry', {
            provider: providerId,
            message: (error && error.message) || String(error || ''),
            rawSummary: summarizeRawOutputForRetry(error)
          });
          return withTimeout(provider.generateStoryboard(job.extractedText, buildTextOptions({
            malformedRetry: true,
            parseFailureSummary: summarizeRawOutputForRetry(error)
          })), STORYBOARD_TIMEOUT_MS, 'Storyboard generation retry');
        })
        .then(function(storyboard) {
          var validated = validateStoryboardBeforeImages(storyboard, providerId);
          if (!isTooFewPanels(validated)) return validated;
          self.pushProgressEvent('storyboard.retry', 'Retrying with panel count reminder', 'Provider: ' + providerId + '; expected ' + settings.panel_count + ', got ' + validated.panels.length);
          self.appendDebugLog('storyboard.panel_count_retry', {
            provider: providerId,
            expected: settings.panel_count,
            actual: validated.panels.length
          });
          return withTimeout(provider.generateStoryboard(job.extractedText, buildTextOptions({
            malformedRetry: true,
            panelCountRetry: true
          })), STORYBOARD_TIMEOUT_MS, 'Storyboard panel-count retry')
            .then(function(retriedStoryboard) {
              return validateStoryboardBeforeImages(retriedStoryboard, providerId);
            });
        })
        .then(function(finalStoryboard) {
          if (isTooFewPanels(finalStoryboard)) {
            var tooFew = new Error('Storyboard returned too few panels (' + finalStoryboard.panels.length + '/' + settings.panel_count + ')');
            tooFew.malformedStoryboard = true;
            tooFew.providerId = providerId;
            throw tooFew;
          }
          return finalStoryboard;
        });
    }

    function attempt(idx, previousError) {
      if (idx >= providerIds.length) throw (previousError || new Error('Storyboard generation failed'));
      var allowMalformedFallback = !!(previousError && previousError.malformedStoryboard);
      if (idx > 0 && !self.isBudgetProviderError(previousError) && !allowMalformedFallback) throw previousError;
      var providerId = providerIds[idx];
      if (idx > 0) {
        var fallbackReasonLabel = self.isBudgetProviderError(previousError) ? 'budget/quota error' : 'malformed storyboard output';
        self.pushProgressEvent('provider.fallback', 'Switching text provider after ' + fallbackReasonLabel, (settings.provider_text || '') + ' -> ' + providerId);
        self.appendDebugLog('provider.text.fallback', {
          from: settings.provider_text,
          to: providerId,
          reason: (previousError && previousError.message) || String(previousError || ''),
          malformed: !!allowMalformedFallback
        });
      }
      attempted.push(providerId);
      var provider = self.getTextProvider(providerId);
      return generateWithMalformedRetry(provider, providerId)
        .catch(function(error) { return attempt(idx + 1, error); });
    }

    return attempt(0, null).then(function(storyboard) {
      var actualProviderId = attempted[attempted.length - 1] || settings.provider_text;
      if (storyboard && storyboard.settings) {
        storyboard.settings.provider_text = actualProviderId;
      }
      if (actualProviderId !== settings.provider_text) {
        settings.provider_text_effective = actualProviderId;
      }
      return storyboard;
    });
  };
  
  this.handleStartGeneration = function(message) {
    var payload = message.payload;
    var text = payload.text;
    var url = payload.url;
    var title = payload.title;
    var settings = payload.settings || {};
    if (!settings.objective) settings.objective = 'summarize';
    if (!settings.output_language && settings.outputLanguage) {
      settings.output_language = settings.outputLanguage;
    }
    if (!settings.output_language) settings.output_language = 'en';
    
    if (self.isProcessing) {
      return { success: false, error: 'Generation already in progress' };
    }

    var jobId = 'job_' + Date.now();
    self.currentJob = {
      id: jobId,
      status: 'pending',
      sourceUrl: url,
      sourceTitle: title,
      extractedText: text,
      settings: settings,
      storyboard: null,
      currentPanelIndex: 0,
      completedPanels: 0,
      panelErrors: [],
      progressEvents: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    self.isProcessing = true;
    self.pushProgressEvent('job.created', 'Job created', 'Preparing generation request');
    self.saveJob();
    self.notifyProgress();
    self.appendDebugLog('job.created', {
      providerText: settings.provider_text,
      providerImage: settings.provider_image,
      panelCount: settings.panel_count
    });
    self.trackMetric('generation_created', {
      domain: (() => { try { return new URL(String(url || '')).hostname; } catch (_) { return ''; } })(),
      objective: settings.objective || 'summarize',
      provider_text: settings.provider_text,
      provider_image: settings.provider_image,
      panel_count: settings.panel_count
    });

    // Start generation asynchronously so popup can immediately begin polling and render progress.
    self.executeGeneration()
      .catch(function(error) {
        if (self.currentJob) {
          var errorMessage = error && error.message ? error.message : String(error);
          if (/parse storyboard|parsed but no panels|json/i.test(String(errorMessage || '').toLowerCase())) {
            self.appendDebugLog('unexpected_output.storyboard.parse_failed', {
              message: errorMessage,
              sourceUrl: self.currentJob.sourceUrl || null
            });
          } else {
            self.appendDebugLog('job.failed', { message: errorMessage });
          }
          self.currentJob.status = 'failed';
          self.currentJob.error = errorMessage;
          if (self.currentJob.settings && self.currentJob.settings.debug_flag) {
            self.currentJob.errorDetails = error && error.stack ? error.stack : String(error);
          }
          self.currentJob.updatedAt = new Date().toISOString();
          self.saveJob();
          self.notifyProgress();
          self.trackMetric('generation_failed', {
            domain: (() => { try { return new URL(String(self.currentJob.sourceUrl || '')).hostname; } catch (_) { return ''; } })(),
            objective: self.currentJob.settings && self.currentJob.settings.objective ? self.currentJob.settings.objective : 'summarize'
          });
        }
      })
      .finally(function() { self.isProcessing = false; });

    return { jobId: jobId, started: true };
  };
  
  this.executeGeneration = function() {
    var job = self.currentJob;
    var settings = job.settings;

    job.status = 'generating_text';
    job.updatedAt = new Date().toISOString();
    self.pushProgressEvent(
      'storyboard.prompt',
      'Sending storyboard prompt',
      'Provider: ' + settings.provider_text + '; text chars: ' + (job.extractedText ? job.extractedText.length : 0)
    );
    self.saveJob();
    self.notifyProgress();
    self.appendDebugLog('job.generating_text');

    var imageProvider = self.getImageProvider(settings.provider_image);

    return chrome.storage.local.get('promptTemplates')
    .then(function(result) {
      var resolvedPromptTemplates = resolvePromptTemplatesForProviders(
        result && result.promptTemplates,
        settings.provider_text,
        settings.provider_image
      );
      return self.generateStoryboardWithBudgetFallback(job, resolvedPromptTemplates)
      .then(function(storyboard) {
        return { storyboard: storyboard, resolvedPromptTemplates: resolvedPromptTemplates };
      });
    })
    .then(function(result) {
      var storyboard = result.storyboard;
      var imagePromptTemplate = result.resolvedPromptTemplates && result.resolvedPromptTemplates.image && result.resolvedPromptTemplates.image.image;
      self.pushProgressEvent(
        'storyboard.response',
        'Received storyboard response',
        'Panels: ' + ((storyboard && storyboard.panels && storyboard.panels.length) || 0) +
          '; source title: ' + self.truncateForDebug(job.sourceTitle || '', 120)
      );
      var contract = validateStoryboardContract(storyboard, settings.panel_count);
      storyboard = contract.storyboard;
      if (!contract.meta.hasPanelsArray || contract.meta.panelCount === 0) {
        self.appendDebugLog('unexpected_output.storyboard.no_panels', {
          hasStoryboard: !!storyboard,
          panelsType: storyboard && typeof storyboard.panels,
          sourceUrl: job.sourceUrl || null
        });
        self.pushProgressEvent('unexpected_output', 'Storyboard returned no panels', 'Provider returned an empty storyboard');
        var noPanelsErr = new Error('Storyboard returned no panels');
        noPanelsErr.malformedStoryboard = true;
        noPanelsErr.providerId = (storyboard && storyboard.settings && storyboard.settings.provider_text) || settings.provider_text;
        throw noPanelsErr;
      }
      if (contract.meta.promptLikeCaptionRepairs > 0) {
        self.appendDebugLog('unexpected_output.storyboard.prompt_like_captions_repaired', {
          count: contract.meta.promptLikeCaptionRepairs,
          sourceUrl: job.sourceUrl || null,
          provider: (storyboard && storyboard.settings && storyboard.settings.provider_text) || settings.provider_text
        });
      }
      job.captionQuality = {
        ...(contract.meta.captionQuality || {}),
        promptLikeCaptionRepairs: contract.meta.promptLikeCaptionRepairs || 0
      };
      self.appendDebugLog('caption_quality.score', {
        provider: (storyboard && storyboard.settings && storyboard.settings.provider_text) || settings.provider_text,
        sourceUrl: job.sourceUrl || null,
        score: job.captionQuality || null
      });
      storyboard.source = { url: job.sourceUrl, title: job.sourceTitle, extracted_at: new Date().toISOString() };
      storyboard.panels = (Array.isArray(storyboard.panels) ? storyboard.panels : []).map(function(panel, idx) {
        var p = panel || {};
        p.runtime_status = 'pending';
        if (!p.panel_id) p.panel_id = 'panel_' + (idx + 1);
        return p;
      });
      storyboard = self.enrichStoryboardFacts(storyboard, job.extractedText || '');
      storyboard.settings = {
        ...(storyboard.settings || {}),
        debug_flag: !!settings.debug_flag,
        image_refusal_handling: settings.image_refusal_handling || 'rewrite_and_retry',
        show_rewritten_badge: settings.show_rewritten_badge !== false,
        log_rewritten_prompts: !!settings.log_rewritten_prompts
      };
      storyboard.caption_quality = job.captionQuality || null;
      job.storyboard = storyboard;
      job.status = 'generating_images';
      job.currentPanelIndex = 0;
      job.completedPanels = 0;
      job.updatedAt = new Date().toISOString();
      self.saveJob();
      self.notifyProgress();
      self.appendDebugLog('job.storyboard_ready', { panels: storyboard.panels ? storyboard.panels.length : 0 });
      if (Array.isArray(storyboard.panels) && storyboard.panels.length) {
        if (contract.meta.missingCaptionBeforeSynthesis > 0) {
          self.appendDebugLog('unexpected_output.storyboard.missing_panel_text', {
            missingPanels: contract.meta.missingCaptionBeforeSynthesis,
            totalPanels: storyboard.panels.length
          });
        }
        if (contract.meta.missingImagePromptBeforeSynthesis > 0) {
          self.appendDebugLog('unexpected_output.storyboard.missing_image_prompts', {
            missingPanels: contract.meta.missingImagePromptBeforeSynthesis,
            totalPanels: storyboard.panels.length
          });
        }
      }

      // Generate images sequentially so UI can show panel-by-panel progress reliably.
      var chain = Promise.resolve();
      for (var i = 0; i < storyboard.panels.length; i++) {
        (function(panelIndex) {
          chain = chain.then(function() {
            if (job.status === 'canceled') return;

            var panel = storyboard.panels[panelIndex];
            job.currentPanelIndex = panelIndex;
            panel.runtime_status = 'sent';
            job.updatedAt = new Date().toISOString();
            self.pushProgressEvent(
              'panel.prompt',
              'Sending image prompt for panel ' + (panelIndex + 1),
              panel.image_prompt || ''
            );
            self.saveJob();
            self.notifyProgress();
            self.appendDebugLog('panel.image.start', { panelIndex: panelIndex, panelId: panel.panel_id || null });

            return withTimeout(self.generateImageWithRefusalHandling(
              imageProvider,
              panel,
              panelIndex,
              storyboard.panels.length,
              job,
              imagePromptTemplate
            ), IMAGE_TIMEOUT_MS + 30000, 'Panel ' + (panelIndex + 1) + ' image generation')
            .then(function(imageResult) {
              if (!imageResult || !imageResult.imageData) {
                self.appendDebugLog('unexpected_output.panel.no_image_data', {
                  panelIndex: panelIndex,
                  panelId: panel.panel_id || null,
                  providerMetadata: imageResult && imageResult.providerMetadata ? imageResult.providerMetadata : null
                });
                self.pushProgressEvent(
                  'unexpected_output',
                  'Panel ' + (panelIndex + 1) + ' returned no image data',
                  'Provider response was missing image data'
                );
                throw new Error('Provider returned no image data');
              }
              panel.runtime_status = 'receiving';
              job.updatedAt = new Date().toISOString();
              self.saveJob();
              self.notifyProgress();

              panel.runtime_status = 'rendering';
              panel.artifacts = { image_blob_ref: imageResult.imageData, provider_metadata: imageResult.providerMetadata };
              if (imageResult && imageResult.refusalDebug) {
                panel.artifacts.refusal_debug = imageResult.refusalDebug;
              }
              panel.runtime_status = 'completed';
              self.pushProgressEvent(
                'panel.response',
                'Received image response for panel ' + (panelIndex + 1),
                'Metadata: ' + self.truncateForDebug(JSON.stringify(imageResult.providerMetadata || {}), 240)
              );
              self.appendDebugLog('panel.image.success', { panelIndex: panelIndex, panelId: panel.panel_id || null });
              if (Number(job.completedPanels || 0) === 0) {
                var firstPanelMs = Math.max(0, Date.now() - new Date(job.createdAt).getTime());
                self.trackMetric('time_to_first_panel', {
                  ms: firstPanelMs,
                  domain: (() => { try { return new URL(String(job.sourceUrl || '')).hostname; } catch (_) { return ''; } })(),
                  objective: job.settings && job.settings.objective ? job.settings.objective : 'summarize'
                });
              }
            })
            .catch(function(error) {
              console.error('Failed panel ' + (panel.panel_id || panelIndex + 1) + ':', error);
              panel.runtime_status = 'error';
              panel.artifacts = { error: error.message };
              job.panelErrors = job.panelErrors || [];
              job.panelErrors.push({
                panelIndex: panelIndex,
                panelId: panel.panel_id || ('panel_' + (panelIndex + 1)),
                message: error.message
              });
              self.appendDebugLog('panel.image.error', {
                panelIndex: panelIndex,
                panelId: panel.panel_id || null,
                message: error.message
              });
              self.pushProgressEvent(
                'panel.error',
                'Panel ' + (panelIndex + 1) + ' render failed',
                error.message
              );
            })
            .finally(function() {
              job.completedPanels = panelIndex + 1;
              job.updatedAt = new Date().toISOString();
              self.pushProgressEvent(
                'panel.progress',
                'Panel progress updated',
                'Completed ' + job.completedPanels + ' / ' + (storyboard.panels ? storyboard.panels.length : '?')
              );
              self.saveJob();
              self.notifyProgress();
            });
          });
        })(i);
      }

      return chain;
    })
    .then(function() {
      if (job.status !== 'canceled') {
        if (job.storyboard && Array.isArray(job.storyboard.panels)) {
          var totalPanels = job.storyboard.panels.length;
          var panelsWithImages = 0;
          var panelsWithText = 0;
          (job.storyboard.panels || []).forEach(function(panel) {
            var p = panel || {};
            var hasImage = !!(p.artifacts && p.artifacts.image_blob_ref);
            var hasText = !!(p.caption || p.beat_summary || p.summary || p.title || p.text || p.narration || p.description || p.text_content || p.caption_text || p.dialogue);
            if (hasImage) panelsWithImages += 1;
            if (hasText) panelsWithText += 1;
          });
          if (totalPanels > 0 && panelsWithImages === 0) {
            self.appendDebugLog('unexpected_output.images.none', {
              totalPanels: totalPanels,
              panelErrors: (job.panelErrors || []).length
            });
          } else if (panelsWithImages < totalPanels) {
            self.appendDebugLog('unexpected_output.images.partial', {
              totalPanels: totalPanels,
              panelsWithImages: panelsWithImages,
              panelErrors: (job.panelErrors || []).length
            });
          }
          if (totalPanels > 0 && panelsWithText === 0) {
            self.appendDebugLog('unexpected_output.text.none', {
              totalPanels: totalPanels
            });
          } else if (panelsWithText < totalPanels) {
            self.appendDebugLog('unexpected_output.text.partial', {
              totalPanels: totalPanels,
              panelsWithText: panelsWithText
            });
          }
        }
        job.status = 'completed';
        if (job.storyboard && job.storyboard.panels) {
          job.completedPanels = job.storyboard.panels.length;
          job.currentPanelIndex = job.storyboard.panels.length;
        }
        job.updatedAt = new Date().toISOString();
        self.pushProgressEvent(
          'job.completed',
          'Comic generation completed',
          'Panels: ' + (job.storyboard && job.storyboard.panels ? job.storyboard.panels.length : 0) +
            '; panel errors: ' + ((job.panelErrors && job.panelErrors.length) || 0)
        );
        self.saveJob();
        self.notifyProgress();
        self.appendDebugLog('job.completed', {
          panels: job.storyboard && job.storyboard.panels ? job.storyboard.panels.length : 0,
          panelErrors: job.panelErrors ? job.panelErrors.length : 0
        });
        self.trackMetric('generation_completed', {
          domain: (() => { try { return new URL(String(job.sourceUrl || '')).hostname; } catch (_) { return ''; } })(),
          objective: job.settings && job.settings.objective ? job.settings.objective : 'summarize',
          panel_errors: (job.panelErrors && job.panelErrors.length) || 0
        });
        return self.addCompletedJobToHistory(job);
      }
    });
  };
  
  this.handleCancelGeneration = function() {
    if (self.currentJob && self.isProcessing) {
      self.currentJob.status = 'canceled';
      self.currentJob.updatedAt = new Date().toISOString();
      self.saveJob();
      self.notifyProgress();
      self.appendDebugLog('job.canceled');
      self.isProcessing = false;
      return { success: true };
    }
    self.appendDebugLog('job.canceled.no_active_job');
    return { success: false, error: 'No job to cancel' };
  };
  
  this.handleGetStatus = function() {
    return { job: self.currentJob, isProcessing: self.isProcessing };
  };

  this.handleTestProviderModel = function(message) {
    var payload = message && message.payload ? message.payload : {};
    var providerId = payload.providerId;
    var mode = payload.mode === 'image' ? 'image' : 'text';
    var model = String(payload.model || '').trim();
    if (!providerId) {
      throw new Error('providerId is required');
    }
    if (!model) {
      throw new Error('model is required');
    }
    if (self.isProcessing) {
      throw new Error('Cannot test model while generation is in progress');
    }

    if (mode === 'text') {
      var textProvider = self.getTextProvider(providerId);
      return withTimeout(textProvider.generateStoryboard(
        'Web2Comics provider model self-test. Generate a single panel storyboard. This is a short non-sensitive test prompt.',
        {
          panelCount: 1,
          detailLevel: 'low',
          styleId: 'default',
          captionLength: 'short',
          textModel: model,
          sourceTitle: 'Web2Comics provider test',
          sourceUrl: 'https://web2comics.local/test'
        }
      ), STORYBOARD_TIMEOUT_MS, 'Provider text model test').then(function(storyboard) {
        var panels = Array.isArray(storyboard && storyboard.panels) ? storyboard.panels.length : 0;
        return {
          result: {
            ok: true,
            summary: 'Text model responded with storyboard (' + panels + ' panel' + (panels === 1 ? '' : 's') + ')',
            panels: panels,
            providerSettings: storyboard && storyboard.settings ? storyboard.settings : null
          }
        };
      });
    }

    var imageProvider = self.getImageProvider(providerId);
    return withTimeout(imageProvider.generateImage(
      'Tiny comic-style icon of a smiling robot face, simple shapes, no text',
      {
        styleId: 'default',
        panelIndex: 0,
        panelCount: 1,
        panelCaption: 'Provider test panel',
        panelSummary: 'Tiny comic icon test',
        imageModel: model,
        imageQuality: providerId === 'openai' ? 'standard' : '',
        imageSize: providerId === 'openai' ? '1024x1024' : '',
        sourceTitle: 'Web2Comics provider test',
        sourceUrl: 'https://web2comics.local/test'
      }
    ), IMAGE_TIMEOUT_MS, 'Provider image model test').then(function(imageResult) {
      var hasImageData = !!(imageResult && imageResult.imageData);
      return {
        result: {
          ok: true,
          summary: hasImageData ? 'Image model returned image data' : 'Image model returned no image data',
          hasImageData: hasImageData,
          providerMetadata: imageResult && imageResult.providerMetadata ? imageResult.providerMetadata : null
        }
      };
    });
  };

  this.handleValidateProviderRemote = async function(message) {
    var payload = message && message.payload ? message.payload : {};
    var providerId = String(payload.providerId || '').trim();
    if (!providerId) {
      throw new Error('providerId is required');
    }

    if (providerId !== 'openai') {
      return { result: { ok: true, summary: 'No remote validation implemented for this provider' } };
    }

    var apiKey = String(payload.apiKey || '').trim();
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    var textModel = String(payload.textModel || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
    var response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: textModel,
        messages: [
          { role: 'user', content: 'Reply with OK' }
        ],
        max_tokens: 5
      })
    }, 15000, 'OpenAI remote validation');

    if (!response.ok) {
      var errorMessage = 'OpenAI validation failed';
      try {
        var errorJson = await response.json();
        errorMessage = (errorJson && errorJson.error && errorJson.error.message) || errorMessage;
      } catch (_) {
        try {
          var errorText = await response.text();
          if (errorText) errorMessage = errorText;
        } catch (_) {}
      }
      throw new Error(errorMessage + ' (HTTP ' + response.status + ')');
    }

    return {
      result: {
        ok: true,
        summary: 'OpenAI key can make model requests',
        providerMetadata: { model: textModel }
      }
    };
  };

  this.getGoogleDriveSettings = async function() {
    var stored = await chrome.storage.local.get('settings');
    var settings = stored && stored.settings ? stored.settings : {};
    return {
      autoSave: !!settings.googleDriveAutoSave,
      clientId: String(settings.googleDriveClientId || '').trim()
    };
  };

  this.getGoogleDriveAuth = async function() {
    var stored = await chrome.storage.local.get('googleDriveAuth');
    var auth = stored && stored.googleDriveAuth ? stored.googleDriveAuth : null;
    if (!auth || typeof auth !== 'object') return null;
    return auth;
  };

  this.isGoogleDriveAuthValid = function(auth) {
    if (!auth || typeof auth !== 'object') return false;
    if (!auth.accessToken) return false;
    var expiresAt = Number(auth.expiresAt || 0);
    return expiresAt > (Date.now() + 60 * 1000);
  };

  this.launchGoogleWebAuthFlow = function(url, interactive) {
    return new Promise(function(resolve, reject) {
      if (!chrome.identity || !chrome.identity.launchWebAuthFlow) {
        reject(new Error('Chrome identity API is not available'));
        return;
      }
      chrome.identity.launchWebAuthFlow({ url: url, interactive: !!interactive }, function(redirectUrl) {
        var lastError = chrome.runtime && chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message || 'Authentication failed'));
          return;
        }
        if (!redirectUrl) {
          reject(new Error('Authentication canceled or failed'));
          return;
        }
        resolve(redirectUrl);
      });
    });
  };

  this.parseGoogleOAuthTokenFromRedirect = function(redirectUrl) {
    var hash = '';
    try {
      var idx = String(redirectUrl || '').indexOf('#');
      hash = idx >= 0 ? String(redirectUrl).slice(idx + 1) : '';
    } catch (_) {
      hash = '';
    }
    if (!hash) throw new Error('Missing OAuth token response');
    var params = new URLSearchParams(hash);
    var token = params.get('access_token');
    var expiresInSec = Number(params.get('expires_in') || 0);
    if (!token) throw new Error('Google OAuth did not return access token');
    return {
      accessToken: token,
      expiresAt: Date.now() + Math.max(300, expiresInSec) * 1000
    };
  };

  this.getGoogleDriveConnectionStatus = async function() {
    var settings = await self.getGoogleDriveSettings();
    var auth = await self.getGoogleDriveAuth();
    var connected = self.isGoogleDriveAuthValid(auth);
    return {
      connected: connected,
      autoSave: settings.autoSave,
      hasClientId: !!settings.clientId,
      expiresAt: auth && auth.expiresAt ? auth.expiresAt : 0
    };
  };

  this.handleGoogleDriveGetStatus = async function() {
    return { status: await self.getGoogleDriveConnectionStatus() };
  };

  this.handleGoogleDriveConnect = async function(message) {
    var payload = message && message.payload ? message.payload : {};
    var currentSettings = await self.getGoogleDriveSettings();
    var clientId = String(payload.clientId || currentSettings.clientId || '').trim();
    if (!clientId) {
      throw new Error('Google OAuth Client ID is required');
    }
    var redirectUri = chrome.identity && chrome.identity.getRedirectURL
      ? chrome.identity.getRedirectURL('google-oauth2')
      : '';
    if (!redirectUri) {
      throw new Error('Unable to resolve OAuth redirect URL');
    }
    var scopes = 'https://www.googleapis.com/auth/drive.file';
    var authUrl =
      'https://accounts.google.com/o/oauth2/v2/auth' +
      '?client_id=' + encodeURIComponent(clientId) +
      '&response_type=token' +
      '&redirect_uri=' + encodeURIComponent(redirectUri) +
      '&scope=' + encodeURIComponent(scopes) +
      '&include_granted_scopes=true' +
      '&prompt=consent';
    var redirectResult = await self.launchGoogleWebAuthFlow(authUrl, true);
    var tokenResult = self.parseGoogleOAuthTokenFromRedirect(redirectResult);
    await chrome.storage.local.set({
      googleDriveAuth: {
        accessToken: tokenResult.accessToken,
        expiresAt: tokenResult.expiresAt,
        connectedAt: new Date().toISOString(),
        clientId: clientId
      }
    });
    self.appendDebugLog('drive.connect.success', {
      expiresAt: tokenResult.expiresAt
    });
    return { status: await self.getGoogleDriveConnectionStatus() };
  };

  this.handleGoogleDriveDisconnect = async function() {
    await chrome.storage.local.remove('googleDriveAuth');
    self.appendDebugLog('drive.disconnect');
    return { status: await self.getGoogleDriveConnectionStatus() };
  };

  this.getFacebookSettings = async function() {
    var stored = await chrome.storage.local.get('settings');
    var settings = stored && stored.settings ? stored.settings : {};
    return {
      appId: String(settings.facebookAppId || '').trim()
    };
  };

  this.getFacebookAuth = async function() {
    var stored = await chrome.storage.local.get('facebookAuth');
    var auth = stored && stored.facebookAuth ? stored.facebookAuth : null;
    if (!auth || typeof auth !== 'object') return null;
    return auth;
  };

  this.isFacebookAuthValid = function(auth) {
    if (!auth || typeof auth !== 'object') return false;
    if (!auth.accessToken) return false;
    var expiresAt = Number(auth.expiresAt || 0);
    return expiresAt > (Date.now() + 60 * 1000);
  };

  this.parseFacebookOAuthTokenFromRedirect = function(redirectUrl) {
    var text = String(redirectUrl || '');
    var queryPart = '';
    var hashPart = '';
    try {
      var qIdx = text.indexOf('?');
      queryPart = qIdx >= 0 ? text.slice(qIdx + 1).split('#')[0] : '';
      var hIdx = text.indexOf('#');
      hashPart = hIdx >= 0 ? text.slice(hIdx + 1) : '';
    } catch (_) {}

    var queryParams = new URLSearchParams(queryPart);
    if (queryParams.get('error')) {
      throw new Error(queryParams.get('error_description') || queryParams.get('error') || 'Facebook OAuth error');
    }
    var hashParams = new URLSearchParams(hashPart);
    if (hashParams.get('error')) {
      throw new Error(hashParams.get('error_description') || hashParams.get('error') || 'Facebook OAuth error');
    }
    var token = hashParams.get('access_token') || queryParams.get('access_token');
    var expiresInSec = Number(hashParams.get('expires_in') || queryParams.get('expires_in') || 0);
    if (!token) throw new Error('Facebook OAuth did not return access token');
    return {
      accessToken: token,
      expiresAt: Date.now() + Math.max(300, expiresInSec) * 1000
    };
  };

  this.getFacebookConnectionStatus = async function() {
    var settings = await self.getFacebookSettings();
    var auth = await self.getFacebookAuth();
    var connected = self.isFacebookAuthValid(auth);
    return {
      connected: connected,
      hasAppId: !!settings.appId,
      expiresAt: auth && auth.expiresAt ? auth.expiresAt : 0
    };
  };

  this.handleFacebookGetStatus = async function() {
    return { status: await self.getFacebookConnectionStatus() };
  };

  this.handleFacebookConnect = async function(message) {
    var payload = message && message.payload ? message.payload : {};
    var currentSettings = await self.getFacebookSettings();
    var appId = String(payload.appId || currentSettings.appId || '').trim();
    if (!appId) {
      throw new Error('Facebook App ID is required');
    }
    var redirectUri = chrome.identity && chrome.identity.getRedirectURL
      ? chrome.identity.getRedirectURL('facebook-oauth2')
      : '';
    if (!redirectUri) {
      throw new Error('Unable to resolve OAuth redirect URL');
    }
    var authUrl =
      'https://www.facebook.com/v19.0/dialog/oauth' +
      '?client_id=' + encodeURIComponent(appId) +
      '&redirect_uri=' + encodeURIComponent(redirectUri) +
      '&response_type=token' +
      '&scope=' + encodeURIComponent('public_profile');
    var redirectResult = await self.launchGoogleWebAuthFlow(authUrl, true);
    var tokenResult = self.parseFacebookOAuthTokenFromRedirect(redirectResult);
    await chrome.storage.local.set({
      facebookAuth: {
        accessToken: tokenResult.accessToken,
        expiresAt: tokenResult.expiresAt,
        connectedAt: new Date().toISOString(),
        appId: appId
      }
    });
    self.appendDebugLog('facebook.connect.success', {
      expiresAt: tokenResult.expiresAt
    });
    return { status: await self.getFacebookConnectionStatus() };
  };

  this.handleFacebookDisconnect = async function() {
    await chrome.storage.local.remove('facebookAuth');
    self.appendDebugLog('facebook.disconnect');
    return { status: await self.getFacebookConnectionStatus() };
  };

  this.getXSettings = async function() {
    var stored = await chrome.storage.local.get('settings');
    var settings = stored && stored.settings ? stored.settings : {};
    return {
      clientId: String(settings.xClientId || '').trim()
    };
  };

  this.getXAuth = async function() {
    var stored = await chrome.storage.local.get('xAuth');
    var auth = stored && stored.xAuth ? stored.xAuth : null;
    if (!auth || typeof auth !== 'object') return null;
    return auth;
  };

  this.isXAuthValid = function(auth) {
    if (!auth || typeof auth !== 'object') return false;
    if (!auth.accessToken) return false;
    var expiresAt = Number(auth.expiresAt || 0);
    return expiresAt > (Date.now() + 60 * 1000);
  };

  this.base64UrlEncode = function(input) {
    var bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };

  this.randomUrlSafeString = function(length) {
    var n = Math.max(16, Number(length) || 32);
    var bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    return self.base64UrlEncode(bytes).slice(0, n);
  };

  this.createXPkcePair = async function() {
    var verifier = self.randomUrlSafeString(64);
    var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    var challenge = self.base64UrlEncode(new Uint8Array(digest));
    return { verifier: verifier, challenge: challenge };
  };

  this.parseXOAuthCodeFromRedirect = function(redirectUrl) {
    var text = String(redirectUrl || '');
    var queryPart = '';
    try {
      var qIdx = text.indexOf('?');
      queryPart = qIdx >= 0 ? text.slice(qIdx + 1).split('#')[0] : '';
    } catch (_) {}
    var params = new URLSearchParams(queryPart);
    if (params.get('error')) {
      throw new Error(params.get('error_description') || params.get('error') || 'X OAuth error');
    }
    var code = params.get('code');
    var state = params.get('state');
    if (!code) throw new Error('X OAuth did not return authorization code');
    return { code: code, state: state };
  };

  this.exchangeXAuthorizationCode = async function(clientId, code, codeVerifier, redirectUri) {
    var body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code: code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    });
    var response = await fetchWithTimeout('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    }, 20000, 'X OAuth token exchange');
    if (!response.ok) {
      var message = 'X token exchange failed';
      try {
        var json = await response.json();
        message = (json && (json.error_description || json.error)) || message;
      } catch (_) {}
      throw new Error(message + ' (HTTP ' + response.status + ')');
    }
    var tokenJson = await response.json();
    if (!tokenJson || !tokenJson.access_token) {
      throw new Error('X token exchange returned no access token');
    }
    var expiresIn = Number(tokenJson.expires_in || 0);
    return {
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token || '',
      expiresAt: Date.now() + Math.max(300, expiresIn) * 1000
    };
  };

  this.getXConnectionStatus = async function() {
    var settings = await self.getXSettings();
    var auth = await self.getXAuth();
    var connected = self.isXAuthValid(auth);
    return {
      connected: connected,
      hasClientId: !!settings.clientId,
      expiresAt: auth && auth.expiresAt ? auth.expiresAt : 0
    };
  };

  this.handleXGetStatus = async function() {
    return { status: await self.getXConnectionStatus() };
  };

  this.handleXConnect = async function(message) {
    var payload = message && message.payload ? message.payload : {};
    var currentSettings = await self.getXSettings();
    var clientId = String(payload.clientId || currentSettings.clientId || '').trim();
    if (!clientId) {
      throw new Error('X OAuth Client ID is required');
    }
    var redirectUri = chrome.identity && chrome.identity.getRedirectURL
      ? chrome.identity.getRedirectURL('x-oauth2')
      : '';
    if (!redirectUri) {
      throw new Error('Unable to resolve OAuth redirect URL');
    }

    var state = self.randomUrlSafeString(24);
    var pkce = await self.createXPkcePair();
    var scope = 'tweet.read users.read tweet.write offline.access';
    var authUrl =
      'https://twitter.com/i/oauth2/authorize' +
      '?response_type=code' +
      '&client_id=' + encodeURIComponent(clientId) +
      '&redirect_uri=' + encodeURIComponent(redirectUri) +
      '&scope=' + encodeURIComponent(scope) +
      '&state=' + encodeURIComponent(state) +
      '&code_challenge=' + encodeURIComponent(pkce.challenge) +
      '&code_challenge_method=S256';
    var redirectResult = await self.launchGoogleWebAuthFlow(authUrl, true);
    var parsed = self.parseXOAuthCodeFromRedirect(redirectResult);
    if (!parsed || parsed.state !== state) {
      throw new Error('X OAuth state mismatch');
    }

    var tokenResult = await self.exchangeXAuthorizationCode(clientId, parsed.code, pkce.verifier, redirectUri);
    await chrome.storage.local.set({
      xAuth: {
        accessToken: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken,
        expiresAt: tokenResult.expiresAt,
        connectedAt: new Date().toISOString(),
        clientId: clientId
      }
    });
    self.appendDebugLog('x.connect.success', { expiresAt: tokenResult.expiresAt });
    return { status: await self.getXConnectionStatus() };
  };

  this.handleXDisconnect = async function() {
    await chrome.storage.local.remove('xAuth');
    self.appendDebugLog('x.disconnect');
    return { status: await self.getXConnectionStatus() };
  };

  this.ensureGoogleDriveFolder = async function(accessToken, folderName) {
    var name = String(folderName || 'Web2Comics');
    var query = "mimeType='application/vnd.google-apps.folder' and trashed=false and name='" +
      name.replace(/'/g, "\\'") + "'";
    var listUrl = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(query) +
      '&spaces=drive&fields=files(id,name)&pageSize=1';
    var listResponse = await fetchWithTimeout(listUrl, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + accessToken }
    }, 20000, 'Drive folder list');
    if (!listResponse.ok) {
      throw new Error('Failed to query Drive folder (HTTP ' + listResponse.status + ')');
    }
    var listJson = await listResponse.json();
    var existing = listJson && Array.isArray(listJson.files) && listJson.files[0] ? listJson.files[0] : null;
    if (existing && existing.id) return existing.id;

    var createResponse = await fetchWithTimeout('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: name,
        mimeType: 'application/vnd.google-apps.folder'
      })
    }, 20000, 'Drive folder create');
    if (!createResponse.ok) {
      throw new Error('Failed to create Drive folder (HTTP ' + createResponse.status + ')');
    }
    var createJson = await createResponse.json();
    if (!createJson || !createJson.id) {
      throw new Error('Drive folder creation returned no id');
    }
    return createJson.id;
  };

  this.sanitizeDriveFilename = function(name) {
    return String(name || 'web2comics')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .trim()
      .substring(0, 120) || 'web2comics';
  };

  this.buildInteractiveComicHtml = function(storyboard) {
    var payload = JSON.stringify(storyboard || {}).replace(/<\/script/gi, '<\\/script');
    return '<!doctype html>' +
      '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Web2Comics Export</title><style>' +
      'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f5f7fb;color:#0f172a}' +
      '.wrap{max-width:1160px;margin:0 auto;padding:18px}' +
      '.top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px}' +
      '.title{font-size:22px;font-weight:700;margin:0}' +
      '.source{font-size:13px;color:#334155}' +
      '.controls{display:flex;gap:8px;align-items:center}' +
      'select{padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff}' +
      '.panels{margin-top:14px;display:grid;gap:12px}' +
      '.panel{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px}' +
      '.panel img{width:100%;height:auto;border-radius:8px;background:#e2e8f0;object-fit:contain}' +
      '.caption{font-size:14px;line-height:1.4}' +
      '.num{font-size:12px;color:#64748b;font-weight:600}' +
      '.layout-strip{grid-template-columns:repeat(3,minmax(0,1fr))}' +
      '.layout-grid{grid-template-columns:repeat(2,minmax(0,1fr))}' +
      '.layout-single{grid-template-columns:1fr}' +
      '.layout-masonry{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}' +
      '@media (max-width:900px){.layout-strip,.layout-grid,.layout-masonry{grid-template-columns:1fr}}' +
      '</style></head><body><div class="wrap"><div class="top"><div>' +
      '<h1 class="title" id="comic-title"></h1><div class="source"><a id="comic-source" target="_blank" rel="noopener noreferrer"></a></div>' +
      '</div><div class="controls"><label for="layout">Layout</label><select id="layout">' +
      '<option value="strip">Strip</option><option value="grid">Grid</option><option value="single">Single column</option><option value="masonry">Masonry</option>' +
      '</select></div></div><div id="panels" class="panels layout-strip"></div></div>' +
      '<script>const storyboard=' + payload + ';' +
      'const panels=(storyboard&&Array.isArray(storyboard.panels))?storyboard.panels:[];' +
      'const source=(storyboard&&storyboard.source)?storyboard.source:{};' +
      'const titleEl=document.getElementById("comic-title");titleEl.textContent=source.title||storyboard.title||"Web2Comics";' +
      'const sourceEl=document.getElementById("comic-source");sourceEl.href=source.url||"#";sourceEl.textContent=source.url||"Source unavailable";' +
      'const panelsEl=document.getElementById("panels");' +
      'function captionFor(p,i){return String((p&& (p.caption||p.beat_summary||p.summary||p.title||p.text))||("Panel "+(i+1)));}' +
      'function render(){panelsEl.innerHTML=panels.map((p,i)=>{const src=(p&&p.artifacts&&p.artifacts.image_blob_ref)||"";const cap=captionFor(p,i);' +
      'return `<article class="panel"><div class="num">Panel ${i+1}</div>${src?`<img src="${src}" alt="Panel ${i+1}">`:`<div style="height:180px;background:#e2e8f0;border-radius:8px"></div>`}<div class="caption">${cap.replace(/</g,"&lt;")}</div></article>`;}).join("");}' +
      'render();const sel=document.getElementById("layout");' +
      'sel.addEventListener("change",()=>{panelsEl.className="panels layout-"+sel.value;});' +
      '</script></body></html>';
  };

  this.uploadStoryboardToGoogleDrive = async function(job, options) {
    var opts = options && typeof options === 'object' ? options : {};
    if (!job || !job.storyboard) return { skipped: true, reason: 'no_storyboard' };
    var settings = await self.getGoogleDriveSettings();
    if (!opts.force && !settings.autoSave) {
      return { skipped: true, reason: 'auto_save_disabled' };
    }
    var auth = await self.getGoogleDriveAuth();
    if (!self.isGoogleDriveAuthValid(auth)) {
      return { skipped: true, reason: 'not_connected_or_expired' };
    }
    var folderId = await self.ensureGoogleDriveFolder(auth.accessToken, 'Web2Comics');
    var sourceTitle = job.sourceTitle || (job.storyboard && job.storyboard.source && job.storyboard.source.title) || 'Web2Comics Comic';
    var fileName = self.sanitizeDriveFilename(sourceTitle) + '-' + new Date().toISOString().slice(0, 10) + '.html';
    var html = self.buildInteractiveComicHtml(job.storyboard);
    var boundary = 'web2comics_' + Date.now() + '_' + Math.random().toString(16).slice(2);
    var metadata = {
      name: fileName,
      parents: [folderId],
      mimeType: 'text/html',
      description: 'Interactive comic export generated by Web2Comics'
    };
    var multipartBody =
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: text/html; charset=UTF-8\r\n\r\n' +
      html + '\r\n' +
      '--' + boundary + '--';
    var uploadResponse = await fetchWithTimeout('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + auth.accessToken,
        'Content-Type': 'multipart/related; boundary=' + boundary
      },
      body: multipartBody
    }, 30000, 'Drive file upload');
    if (!uploadResponse.ok) {
      throw new Error('Drive upload failed (HTTP ' + uploadResponse.status + ')');
    }
    var uploadJson = await uploadResponse.json();
    self.appendDebugLog('drive.upload.success', {
      fileId: uploadJson && uploadJson.id ? uploadJson.id : '',
      fileName: fileName
    });
    return {
      skipped: false,
      fileId: uploadJson && uploadJson.id ? uploadJson.id : '',
      fileName: fileName,
      webViewLink: uploadJson && uploadJson.webViewLink ? uploadJson.webViewLink : ''
    };
  };

  this.queueGoogleDriveAutoSave = function(job) {
    self._driveUploadChain = (self._driveUploadChain || Promise.resolve())
      .catch(function() {})
      .then(function() {
        return self.uploadStoryboardToGoogleDrive(job, { force: false });
      })
      .then(function(result) {
        if (result && result.skipped && result.reason) {
          self.appendDebugLog('drive.upload.skipped', { reason: result.reason });
        }
      })
      .catch(function(error) {
        self.appendDebugLog('drive.upload.error', {
          message: error && error.message ? error.message : String(error)
        });
      });
    return self._driveUploadChain;
  };

  this.compactJobForStorage = function(job, level) {
    if (!job || typeof job !== 'object') return job;
    var compactionLevel = level || 1;
    var compact = JSON.parse(JSON.stringify(job));
    // Biggest fields first.
    if (typeof compact.extractedText === 'string') {
      var keepExtractLen = compactionLevel >= 3 ? 300 : (compactionLevel >= 2 ? 1000 : 2000);
      if (compact.extractedText.length > keepExtractLen) {
        compact.extractedText = compact.extractedText.substring(0, keepExtractLen) + '...';
      }
    }
    if (Array.isArray(compact.progressEvents)) {
      var keepEvents = compactionLevel >= 3 ? 5 : (compactionLevel >= 2 ? 10 : 15);
      if (compact.progressEvents.length > keepEvents) {
        compact.progressEvents = compact.progressEvents.slice(-keepEvents);
      }
    }
    if (Array.isArray(compact.panelErrors) && compactionLevel >= 2 && compact.panelErrors.length > 10) {
      compact.panelErrors = compact.panelErrors.slice(-10);
    }
    if (compact.storyboard && Array.isArray(compact.storyboard.panels)) {
      compact.storyboard.panels = compact.storyboard.panels.map(function(panel) {
        var p = panel && typeof panel === 'object' ? JSON.parse(JSON.stringify(panel)) : panel;
        if (p && p.artifacts && p.artifacts.image_blob_ref) {
          // If quota is exceeded, preserve status metadata but drop the large base64 payload.
          p.artifacts.image_omitted_due_to_quota = true;
          delete p.artifacts.image_blob_ref;
        }
        if (compactionLevel >= 2 && p && typeof p.image_prompt === 'string' && p.image_prompt.length > 240) {
          p.image_prompt = p.image_prompt.substring(0, 240) + '...';
        }
        if (compactionLevel >= 3 && p && typeof p.beat_summary === 'string' && p.beat_summary.length > 160) {
          p.beat_summary = p.beat_summary.substring(0, 160) + '...';
        }
        return p;
      });
      if (compactionLevel >= 3 && compact.storyboard.panels.length > 20) {
        compact.storyboard.panels = compact.storyboard.panels.slice(0, 20);
        compact.storyboard.panels_truncated_for_quota = true;
      }
    }
    if (compactionLevel >= 3 && compact.errorDetails) {
      compact.errorDetails = self.truncateForDebug(compact.errorDetails, 800);
    }
    return compact;
  };
  
  this.saveJob = function() {
    self._saveJobChain = (self._saveJobChain || Promise.resolve())
      .catch(function() {})
      .then(function() {
        return chrome.storage.local.set({ currentJob: self.currentJob })
          .catch(function(error) {
            var message = error && error.message ? error.message : String(error);
            if (!/quota/i.test(message)) {
              throw error;
            }
            console.warn('Storage quota exceeded while saving currentJob; retrying with compact payload');
            var compact1 = self.compactJobForStorage(self.currentJob, 1);
            return chrome.storage.local.set({ currentJob: compact1 })
              .catch(function(error2) {
                var message2 = error2 && error2.message ? error2.message : String(error2);
                if (!/quota/i.test(message2)) throw error2;
                var compact2 = self.compactJobForStorage(self.currentJob, 2);
                return chrome.storage.local.set({ currentJob: compact2 })
                  .catch(function(error3) {
                    var message3 = error3 && error3.message ? error3.message : String(error3);
                    if (!/quota/i.test(message3)) throw error3;
                    var compact3 = self.compactJobForStorage(self.currentJob, 3);
                    compact3.storage_compacted_due_to_quota = true;
                    return chrome.storage.local.set({ currentJob: compact3 });
                  });
              });
          });
      })
      .catch(function(finalError) {
        console.error('Failed to save currentJob:', finalError);
        self.appendDebugLog('storage.currentJob.save.error', {
          message: finalError && finalError.message ? finalError.message : String(finalError)
        });
      });
    return self._saveJobChain;
  };
  
  this.notifyProgress = function() {
    try {
      var views = chrome.extension && chrome.extension.getViews
        ? chrome.extension.getViews({ type: 'popup' })
        : [];
      if (!Array.isArray(views)) {
        views = [];
      }
      views.forEach(function(view) {
        view.postMessage && view.postMessage({ type: 'JOB_PROGRESS', job: self.currentJob });
      });
    } catch (e) {
      self.appendDebugLog('notify.popup_views.error', {
        message: e && e.message ? e.message : String(e)
      });
    }
    try {
      var maybePromise = chrome.runtime && chrome.runtime.sendMessage
        ? chrome.runtime.sendMessage({ type: 'JOB_PROGRESS_BROADCAST', job: self.currentJob })
        : null;
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(function(err) {
          self.appendDebugLog('notify.broadcast.error', {
            message: err && err.message ? err.message : String(err)
          });
        });
      }
    } catch (e2) {
      self.appendDebugLog('notify.broadcast.throw', {
        message: e2 && e2.message ? e2.message : String(e2)
      });
    }
  };
  
  this.cleanupOldJobs = function() {
    chrome.storage.local.get('history', function(result) {
      var history = result.history;
      if (!history || history.length === 0) return;

      var thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      var filtered = history.filter(function(item) {
        var ts = new Date(item && item.generated_at).getTime();
        return Number.isFinite(ts) && ts > thirtyDaysAgo;
      });

      if (filtered.length !== history.length) {
        var maybeSetPromise = chrome.storage.local.set({ history: filtered });
        if (maybeSetPromise && typeof maybeSetPromise.catch === 'function') {
          maybeSetPromise.catch(function(error) {
            self.appendDebugLog('history.cleanup.persist.error', {
              message: error && error.message ? error.message : String(error)
            });
          });
        }
      }
    });
  };

  this.addCompletedJobToHistory = function(job) {
    if (!job || !job.storyboard) return Promise.resolve();

    return chrome.storage.local.get('history')
      .then(function(result) {
        var history = Array.isArray(result.history) ? result.history : [];
        var entry = {
          id: job.id,
          source: {
            url: job.sourceUrl,
            title: job.sourceTitle
          },
          generated_at: new Date().toISOString(),
          settings_snapshot: job.storyboard.settings,
          storyboard: job.storyboard,
          thumbnail: job.storyboard.panels && job.storyboard.panels[0] && job.storyboard.panels[0].artifacts
            ? job.storyboard.panels[0].artifacts.image_blob_ref
            : undefined
        };

        history = history.filter(function(item) { return item && item.id !== entry.id; });
        history.unshift(entry);
        if (history.length > 50) {
          history = history.slice(0, 50);
        }
        return chrome.storage.local.set({ history: history })
          .catch(function(error) {
            var message = error && error.message ? error.message : String(error);
            if (!/quota/i.test(message)) throw error;

            console.warn('Storage quota exceeded while saving history; retrying with compact history entries');
            var compactHistory = history.map(function(item) {
              if (!item || !item.storyboard || !Array.isArray(item.storyboard.panels)) return item;
              var compactItem = JSON.parse(JSON.stringify(item));
              compactItem.storyboard.panels = compactItem.storyboard.panels.map(function(panel) {
                var p = panel && typeof panel === 'object' ? JSON.parse(JSON.stringify(panel)) : panel;
                if (p && p.artifacts && p.artifacts.image_blob_ref) {
                  p.artifacts.image_omitted_due_to_quota = true;
                  delete p.artifacts.image_blob_ref;
                }
                return p;
              });
              if (compactItem.thumbnail) {
                compactItem.thumbnail_omitted_due_to_quota = true;
                delete compactItem.thumbnail;
              }
              return compactItem;
            });
            return chrome.storage.local.set({ history: compactHistory })
              .catch(function(secondError) {
                var secondMessage = secondError && secondError.message ? secondError.message : String(secondError);
                if (!/quota/i.test(secondMessage)) throw secondError;

                var minimalHistory = compactHistory.slice(0, 10).map(function(item) {
                  if (!item) return item;
                  var minimal = {
                    id: item.id,
                    source: item.source,
                    generated_at: item.generated_at,
                    settings_snapshot: item.settings_snapshot,
                    storyboard_summary_only: true
                  };
                  if (item.storyboard && Array.isArray(item.storyboard.panels)) {
                    minimal.storyboard = {
                      title: item.storyboard.title,
                      settings: item.storyboard.settings,
                      panels: item.storyboard.panels.map(function(panel, idx) {
                        return {
                          panel_id: (panel && panel.panel_id) || ('panel_' + (idx + 1)),
                          caption: panel && panel.caption ? panel.caption : '',
                          beat_summary: panel && panel.beat_summary ? self.truncateForDebug(panel.beat_summary, 120) : '',
                          artifacts: { image_omitted_due_to_quota: true }
                        };
                      })
                    };
                  }
                  if (item.thumbnail) {
                    minimal.thumbnail_omitted_due_to_quota = true;
                  }
                  return minimal;
                });
                return chrome.storage.local.set({ history: minimalHistory });
              });
          })
          .then(function() {
            self.queueGoogleDriveAutoSave(job);
          });
      })
      .catch(function(error) {
        console.error('Failed to persist history in service worker:', error);
        self.appendDebugLog('history.persist.error', {
          message: error && error.message ? error.message : String(error)
        });
      });
  };
  
  this.init();
};

// Initialize service worker
var __web2comicsServiceWorker = new ServiceWorker();

// Playwright/E2E test hook: allows invoking context-menu handlers in the real extension runtime.
// This does not expose new user-facing behavior.
try {
  if (typeof globalThis !== 'undefined') {
    globalThis.__WEB2COMICS_E2E__ = globalThis.__WEB2COMICS_E2E__ || {};
    globalThis.__WEB2COMICS_E2E__.getServiceWorker = function() {
      return __web2comicsServiceWorker;
    };
    globalThis.__WEB2COMICS_E2E__.triggerSelectionMenuGenerate = function(info, tab) {
      return __web2comicsServiceWorker.handleSelectionContextMenuGenerateClick(info, tab);
    };
    globalThis.__WEB2COMICS_E2E__.triggerSelectionMenuOpenComposer = function(info, tab, options) {
      return __web2comicsServiceWorker.handleSelectionContextMenuOpenComposerClick(info, tab, options || null);
    };
  }
} catch (_) {}

// Open the Options page on fresh install to guide provider setup and first-run configuration.
try {
  if (chrome && chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(function(details) {
      if (!details || details.reason !== 'install') return;
      Promise.resolve()
        .then(function() {
          if (chrome.runtime.openOptionsPage) {
            return chrome.runtime.openOptionsPage();
          }
        })
        .catch(function(err) {
          console.warn('Failed to open options page after install:', err);
        });
    });
  }
} catch (e) {
  console.warn('Failed to register onInstalled handler:', e);
}
