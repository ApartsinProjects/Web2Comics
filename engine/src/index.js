const fs = require('fs');
const path = require('path');
const { loadLocalEnvFiles } = require('./env');
const { loadConfig } = require('./config');
const { loadSource } = require('./input');
const { buildStoryboardPrompt, parseStoryboardResponse } = require('./prompts');
const { generateTextWithProvider, generateImageWithProvider, supportsImageReferenceInput } = require('./providers');
const { composeComicSheet } = require('./compose');

function isConsistencyEnabled(settings) {
  const raw = settings && settings.consistency;
  if (raw == null) return false;
  if (typeof raw === 'boolean') return raw;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function buildStyleReferencePrompt(storyboard, settings) {
  const title = String(storyboard?.title || 'Comic Summary').trim();
  const summary = buildStorySummaryContext(storyboard);
  const objective = String(settings?.objective || 'summarize').trim();
  const style = String(settings?.style_prompt || '').trim();
  const language = String(settings?.output_language || 'en').trim();
  const detail = String(settings?.detail_level || 'low').trim();
  const objectiveOverride = String(settings?.objective_prompt_overrides?.[objective] || '').trim();
  const customStoryPrompt = String(settings?.custom_story_prompt || '').trim();
  const customPanelPrompt = String(settings?.custom_panel_prompt || '').trim();
  const out = [
    'Create one reference image that defines a consistent visual style for the full comic.',
    `Story title: ${title}`,
    `Story summary: ${summary || 'No summary provided.'}`,
    `Objective: ${objective}`,
    `Style: ${style}`,
    `Output language: ${language}`,
    `Detail level: ${detail}`,
    'Show key characters and setting mood in one scene.'
  ];
  if (objectiveOverride) {
    out.push(`Objective-specific guidance: ${objectiveOverride}`);
  }
  if (customStoryPrompt) {
    out.push(`Custom story guidance: ${customStoryPrompt}`);
  }
  if (customPanelPrompt) {
    out.push(`Custom panel guidance: ${customPanelPrompt}`);
  }
  out.push(
    'STRICT NO-TEXT RULE: no letters, words, numbers, symbols, labels, signs, logos, UI text, subtitles, speech bubbles, captions, or watermarks.'
  );
  return out.join('\n');
}

function buildPanelImagePrompt(panel, index, total, settings, storyboard, opts = {}) {
  const storyTitle = String(storyboard?.title || '').trim();
  const storySummary = buildStorySummaryContext(storyboard, panel);
  const shortSummary = storySummary.length > 280 ? `${storySummary.slice(0, 280)}...` : storySummary;
  const panelSpecificPrompt = String(panel?.image_prompt || '').trim();
  const out = [
    `Story title: ${storyTitle || 'Comic Summary'}`,
    `Story summary: ${shortSummary || 'No summary provided.'}`,
    `Panel visual brief: ${panelSpecificPrompt || panel.caption}`,
    `Style: ${settings.style_prompt}`,
    'Create one clear scene, no collage.',
    'STRICT NO-TEXT RULE: do not render any text in the image.',
    'No words, letters, numbers, symbols, subtitles, labels, signs, logos, UI text, speech bubbles, captions, or watermarks.',
    'If any text appears, regenerate mentally and output a text-free scene.'
  ];
  if (opts && opts.hasStyleReferenceImage) {
    out.push('Use the style of the provided summary reference image. Keep rendering style consistent with it.');
  }
  const customPanelPrompt = String(settings.custom_panel_prompt || '').trim();
  if (customPanelPrompt) {
    out.push(`Custom user panel prompt: ${customPanelPrompt}`);
  }
  return out.join('\n');
}

function buildStorySummaryContext(storyboard, panel = null) {
  const explicit = String(storyboard?.description || '').trim().replace(/\s+/g, ' ');
  if (explicit) return explicit;

  const panelCaptions = Array.isArray(storyboard?.panels)
    ? storyboard.panels
      .map((p) => String(p?.caption || '').trim())
      .filter(Boolean)
      .slice(0, 4)
    : [];
  if (panelCaptions.length) return panelCaptions.join(' ');

  const panelCaption = String(panel?.caption || '').trim();
  if (panelCaption) return panelCaption;

  return 'No summary provided.';
}

async function generateConsistencyReferenceImage(config, storyboard) {
  const consistencyOn = isConsistencyEnabled(config?.generation);
  if (!consistencyOn) return { enabled: false, used: false, reason: 'disabled' };
  if (!supportsImageReferenceInput(config?.providers?.image || {})) {
    const provider = String(config?.providers?.image?.provider || 'unknown').trim().toLowerCase();
    const model = String(config?.providers?.image?.model || 'unknown').trim();
    throw new Error(
      `Consistency is enabled, but image provider/model does not support reference images: ${provider}/${model}`
    );
  }

  const prompt = buildStyleReferencePrompt(storyboard, config.generation || {});
  const image = await withRetries(
    () => generateImageWithProvider(config.providers.image, prompt, config.runtime),
    config.runtime.retries,
    'Consistency summary image'
  );
  return { enabled: true, used: true, reason: 'ok', prompt, image };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const out = new Array(items.length);
  let idx = 0;
  let active = 0;
  return new Promise((resolve, reject) => {
    const launch = () => {
      if (idx >= items.length && active === 0) {
        resolve(out);
        return;
      }
      while (active < concurrency && idx < items.length) {
        const current = idx;
        idx += 1;
        active += 1;
        Promise.resolve(mapper(items[current], current))
          .then((result) => {
            out[current] = result;
            active -= 1;
            launch();
          })
          .catch((error) => reject(error));
      }
    };
    launch();
  });
}

async function withRetries(fn, retries, label) {
  let lastError = null;
  const attempts = Math.max(1, Number(retries || 0) + 1);
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn(i);
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        // Short backoff for throughput-oriented CLI.
        await new Promise((r) => setTimeout(r, 250 + (i * 200)));
      }
    }
  }
  throw new Error(`${label || 'Operation'} failed after ${attempts} attempts: ${lastError?.message || lastError}`);
}

async function generateStoryboardWithRetries(config, prompt, panelCount) {
  let lastRawText = '';
  const storyboard = await withRetries(
    async () => {
      const raw = await generateTextWithProvider(config.providers.text, prompt, config.runtime);
      lastRawText = String(raw || '');
      return parseStoryboardResponse(lastRawText, panelCount);
    },
    config.runtime.retries,
    'Storyboard generation'
  );
  return { storyboard, storyboardRawText: lastRawText };
}

async function runComicEngine(options) {
  const startedAt = Date.now();
  const rootDir = options.rootDir || process.cwd();
  loadLocalEnvFiles(rootDir);

  const loaded = loadConfig(options.configPath);
  const config = loaded.config;
  const source = loadSource(options.inputPath, config.input);

  const effectiveTitle = String(options.titleOverride || source.title || 'Comic Summary');
  const storyboardPrompt = buildStoryboardPrompt({
    sourceTitle: effectiveTitle,
    sourceLabel: source.sourceLabel,
    sourceText: source.text,
    panelCount: config.generation.panel_count,
    objective: config.generation.objective,
    stylePrompt: config.generation.style_prompt,
    outputLanguage: config.generation.output_language,
    objectivePromptOverride: config.generation?.objective_prompt_overrides?.[config.generation.objective],
    customStoryPrompt: config.generation.custom_story_prompt
  });

  const generatedStoryboard = await generateStoryboardWithRetries(
    config,
    storyboardPrompt,
    config.generation.panel_count
  );
  const storyboardRawText = generatedStoryboard.storyboardRawText;
  const storyboard = generatedStoryboard.storyboard;
  if (effectiveTitle) storyboard.title = effectiveTitle;
  const consistencyRef = await generateConsistencyReferenceImage(config, storyboard);

  const panelImages = await mapWithConcurrency(
    storyboard.panels,
    config.runtime.image_concurrency,
    async (panel, index) => withRetries(
      () => generateImageWithProvider(
        config.providers.image,
        buildPanelImagePrompt(panel, index, storyboard.panels.length, config.generation, storyboard, {
          hasStyleReferenceImage: Boolean(consistencyRef.used)
        }),
        config.runtime,
        consistencyRef.used ? { referenceImage: consistencyRef.image } : {}
      ),
      config.runtime.retries,
      `Panel image ${index + 1}`
    )
  );

  const composed = await composeComicSheet({
    storyboard,
    panelImages,
    source: source.sourceLabel,
    outputConfig: config.output,
    outputPath: options.outputPath
  });

  const result = {
    configPath: loaded.path,
    inputPath: source.inputPath,
    outputPath: composed.outputPath,
    storyboardTitle: storyboard.title,
    panelCount: storyboard.panels.length,
    imageBytes: composed.bytes,
    width: composed.width,
    height: composed.height,
    elapsedMs: Date.now() - startedAt,
    consistency: {
      enabled: Boolean(consistencyRef.enabled),
      used: Boolean(consistencyRef.used),
      reason: String(consistencyRef.reason || '')
    }
  };

  if (options.debugDir) {
    const debugDir = path.resolve(options.debugDir);
    fs.mkdirSync(debugDir, { recursive: true });
    fs.writeFileSync(path.join(debugDir, 'storyboard.raw.txt'), storyboardRawText, 'utf8');
    fs.writeFileSync(path.join(debugDir, 'storyboard.json'), JSON.stringify(storyboard, null, 2), 'utf8');
    fs.writeFileSync(path.join(debugDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  }

  return result;
}

async function runComicEnginePanels(options) {
  const startedAt = Date.now();
  const rootDir = options.rootDir || process.cwd();
  loadLocalEnvFiles(rootDir);

  const loaded = loadConfig(options.configPath);
  const config = loaded.config;
  const source = loadSource(options.inputPath, config.input);

  const effectiveTitle = String(options.titleOverride || source.title || 'Comic Summary');
  const storyboardPrompt = buildStoryboardPrompt({
    sourceTitle: effectiveTitle,
    sourceLabel: source.sourceLabel,
    sourceText: source.text,
    panelCount: config.generation.panel_count,
    objective: config.generation.objective,
    stylePrompt: config.generation.style_prompt,
    outputLanguage: config.generation.output_language,
    objectivePromptOverride: config.generation?.objective_prompt_overrides?.[config.generation.objective],
    customStoryPrompt: config.generation.custom_story_prompt
  });

  const generatedStoryboard = await generateStoryboardWithRetries(
    config,
    storyboardPrompt,
    config.generation.panel_count
  );
  const storyboardRawText = generatedStoryboard.storyboardRawText;
  const storyboard = generatedStoryboard.storyboard;
  if (effectiveTitle) storyboard.title = effectiveTitle;
  const consistencyRef = await generateConsistencyReferenceImage(config, storyboard);

  const panelImages = await mapWithConcurrency(
    storyboard.panels,
    config.runtime.image_concurrency,
    async (panel, index) => {
      const imagePrompt = buildPanelImagePrompt(panel, index, storyboard.panels.length, config.generation, storyboard, {
        hasStyleReferenceImage: Boolean(consistencyRef.used)
      });
      const image = await withRetries(
        () => generateImageWithProvider(
          config.providers.image,
          imagePrompt,
          config.runtime,
          consistencyRef.used ? { referenceImage: consistencyRef.image } : {}
        ),
        config.runtime.retries,
        `Panel image ${index + 1}`
      );
      if (typeof options.onPanelReady === 'function') {
        await options.onPanelReady({
          index,
          total: storyboard.panels.length,
          panel,
          imagePrompt,
          image
        });
      }
      return image;
    }
  );

  const result = {
    configPath: loaded.path,
    inputPath: source.inputPath,
    storyboardTitle: storyboard.title,
    panelCount: storyboard.panels.length,
    elapsedMs: Date.now() - startedAt,
    storyboard,
    panelImages,
    consistency: {
      enabled: Boolean(consistencyRef.enabled),
      used: Boolean(consistencyRef.used),
      reason: String(consistencyRef.reason || '')
    },
    consistencyReferenceImage: consistencyRef.used ? consistencyRef.image : null
  };

  if (options.debugDir) {
    const debugDir = path.resolve(options.debugDir);
    fs.mkdirSync(debugDir, { recursive: true });
    fs.writeFileSync(path.join(debugDir, 'storyboard.raw.txt'), storyboardRawText, 'utf8');
    fs.writeFileSync(path.join(debugDir, 'storyboard.json'), JSON.stringify(storyboard, null, 2), 'utf8');
    fs.writeFileSync(path.join(debugDir, 'result.panels.json'), JSON.stringify({
      configPath: result.configPath,
      inputPath: result.inputPath,
      panelCount: result.panelCount,
      elapsedMs: result.elapsedMs
    }, null, 2), 'utf8');
  }

  return result;
}

module.exports = {
  runComicEngine,
  runComicEnginePanels,
  isConsistencyEnabled,
  buildStyleReferencePrompt,
  buildStorySummaryContext,
  generateConsistencyReferenceImage,
  buildPanelImagePrompt,
  mapWithConcurrency,
  withRetries,
  generateStoryboardWithRetries
};
