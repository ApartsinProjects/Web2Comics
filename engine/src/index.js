const fs = require('fs');
const path = require('path');
const { loadLocalEnvFiles } = require('./env');
const { loadConfig } = require('./config');
const { loadSource } = require('./input');
const { buildStoryboardPrompt, parseStoryboardResponse } = require('./prompts');
const { generateTextWithProvider, generateImageWithProvider } = require('./providers');
const { composeComicSheet } = require('./compose');

function buildPanelImagePrompt(panel, index, total, settings, storyboard) {
  const storyTitle = String(storyboard?.title || '').trim();
  const storySummary = String(storyboard?.description || '').trim().replace(/\s+/g, ' ');
  const shortSummary = storySummary.length > 280 ? `${storySummary.slice(0, 280)}...` : storySummary;
  const panelSpecificPrompt = String(panel?.image_prompt || '').trim();
  const out = [
    `Comic panel ${index + 1}/${total}`,
    `Story title: ${storyTitle || 'Comic Summary'}`,
    `Story summary: ${shortSummary || 'No summary provided.'}`,
    `Panel caption: ${panel.caption}`,
    `Panel visual brief: ${panelSpecificPrompt || panel.caption}`,
    `Style: ${settings.style_prompt}`,
    'Create one clear scene, no collage.',
    'Do not render caption text inside the image.',
    'No words, letters, subtitles, labels, or text overlays in the artwork.'
  ];
  const customPanelPrompt = String(settings.custom_panel_prompt || '').trim();
  if (customPanelPrompt) {
    out.push(`Custom user panel prompt: ${customPanelPrompt}`);
  }
  return out.join('\n');
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

  const storyboardRawText = await withRetries(
    () => generateTextWithProvider(config.providers.text, storyboardPrompt, config.runtime),
    config.runtime.retries,
    'Storyboard generation'
  );

  const storyboard = parseStoryboardResponse(storyboardRawText, config.generation.panel_count);
  if (effectiveTitle) storyboard.title = effectiveTitle;

  const panelImages = await mapWithConcurrency(
    storyboard.panels,
    config.runtime.image_concurrency,
    async (panel, index) => withRetries(
      () => generateImageWithProvider(
        config.providers.image,
        buildPanelImagePrompt(panel, index, storyboard.panels.length, config.generation, storyboard),
        config.runtime
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
    elapsedMs: Date.now() - startedAt
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

  const storyboardRawText = await withRetries(
    () => generateTextWithProvider(config.providers.text, storyboardPrompt, config.runtime),
    config.runtime.retries,
    'Storyboard generation'
  );

  const storyboard = parseStoryboardResponse(storyboardRawText, config.generation.panel_count);
  if (effectiveTitle) storyboard.title = effectiveTitle;

  const panelImages = await mapWithConcurrency(
    storyboard.panels,
    config.runtime.image_concurrency,
    async (panel, index) => {
      const image = await withRetries(
        () => generateImageWithProvider(
          config.providers.image,
          buildPanelImagePrompt(panel, index, storyboard.panels.length, config.generation, storyboard),
          config.runtime
        ),
        config.runtime.retries,
        `Panel image ${index + 1}`
      );
      if (typeof options.onPanelReady === 'function') {
        await options.onPanelReady({
          index,
          total: storyboard.panels.length,
          panel,
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
    panelImages
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
  buildPanelImagePrompt,
  mapWithConcurrency,
  withRetries
};
