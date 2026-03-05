function buildStoryboardPrompt({
  sourceTitle,
  sourceLabel,
  sourceText,
  panelCount,
  objective,
  stylePrompt,
  outputLanguage,
  objectivePromptOverride,
  customStoryPrompt
}) {
  const out = [
    'Create a comic storyboard as strict JSON only. No markdown fences.',
    'Schema: {"title":string,"description":string,"panels":[{"caption":string,"image_prompt":string}]}',
    `Panel count: ${panelCount}`,
    `Objective: ${objective || 'summarize'}`,
    `Output language: ${outputLanguage || 'en'}`,
    `Visual style: ${stylePrompt}`,
    'Rules:',
    '- Keep captions concise, factual, and sequential.',
    '- Keep each image_prompt visual and concrete for a single panel scene.',
    '- Do not invent facts not present in source text.',
  ];
  const objectiveOverride = String(objectivePromptOverride || '').trim();
  if (objectiveOverride) {
    out.push(`Objective-specific instructions: ${objectiveOverride}`);
  }
  const customStory = String(customStoryPrompt || '').trim();
  if (customStory) {
    out.push(`Custom user story prompt: ${customStory}`);
  }
  out.push(
    `Source title: ${sourceTitle}`,
    `Source label: ${sourceLabel}`,
    'Source text:',
    sourceText
  );
  return out.join('\n');
}

function extractJsonCandidate(rawText) {
  const raw = String(rawText || '');
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenceMatch && fenceMatch[1] ? fenceMatch[1] : raw;
  const start = source.indexOf('{');
  if (start < 0) return '';

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
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

function stripTrailingCommas(jsonText) {
  const src = String(jsonText || '');
  if (!src) return src;
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j += 1;
      if (j < src.length && (src[j] === '}' || src[j] === ']')) {
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function sanitizeJsonCandidate(candidate) {
  const trimmed = String(candidate || '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) return '';
  return stripTrailingCommas(trimmed);
}

function normalizeStoryboard(storyboard, panelCount) {
  const safeCount = Math.max(1, Number(panelCount || 3));
  const parsed = storyboard && typeof storyboard === 'object' ? storyboard : {};
  const panelsRaw = Array.isArray(parsed.panels) ? parsed.panels : [];
  const outPanels = [];
  for (let i = 0; i < safeCount; i += 1) {
    const p = panelsRaw[i] || {};
    const caption = String(p.caption || p.title || `Panel ${i + 1}`).trim();
    const imagePrompt = String(p.image_prompt || p.prompt || caption).trim();
    outPanels.push({
      panel_id: `panel_${i + 1}`,
      caption,
      image_prompt: imagePrompt
    });
  }
  return {
    title: String(parsed.title || 'Comic Summary').trim() || 'Comic Summary',
    description: String(parsed.description || '').trim(),
    panels: outPanels
  };
}

function parseStoryboardResponse(rawText, panelCount) {
  const candidate = extractJsonCandidate(rawText);
  if (!candidate) throw new Error('No JSON object found in storyboard response');
  const attempts = [candidate, sanitizeJsonCandidate(candidate)];
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      const parsed = JSON.parse(attempt);
      return normalizeStoryboard(parsed, panelCount);
    } catch (_) {
      // Try next parsing strategy.
    }
  }
  try {
    JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Failed to parse storyboard JSON: ${error.message}`);
  }
  throw new Error('Failed to parse storyboard JSON');
}

module.exports = {
  buildStoryboardPrompt,
  extractJsonCandidate,
  sanitizeJsonCandidate,
  stripTrailingCommas,
  parseStoryboardResponse,
  normalizeStoryboard
};
