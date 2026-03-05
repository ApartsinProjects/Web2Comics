const {
  isConsistencyEnabled,
  buildStyleReferencePrompt,
  buildPanelImagePrompt,
  generateConsistencyReferenceImage
} = require('../src');
const { supportsImageReferenceInput } = require('../src/providers');

describe('engine consistency flow helpers', () => {
  it('resolves consistency flag from config values', () => {
    expect(isConsistencyEnabled({ consistency: true })).toBe(true);
    expect(isConsistencyEnabled({ consistency: 'on' })).toBe(true);
    expect(isConsistencyEnabled({ consistency: 'off' })).toBe(false);
    expect(isConsistencyEnabled({})).toBe(false);
  });

  it('advertises provider support only where implemented', () => {
    expect(supportsImageReferenceInput({ provider: 'gemini', model: 'gemini-2.0-flash-exp-image-generation' })).toBe(true);
    expect(supportsImageReferenceInput({ provider: 'gemini', model: 'gemini-2.5-flash' })).toBe(false);
    expect(supportsImageReferenceInput({ provider: 'openai', supports_image_reference: true })).toBe(true);
    expect(supportsImageReferenceInput({ provider: 'gemini', model: 'gemini-2.0-flash-exp-image-generation', supports_image_reference: false })).toBe(false);
    expect(supportsImageReferenceInput({ provider: 'openai' })).toBe(false);
  });

  it('adds style-reference instruction to panel prompt when enabled', () => {
    const prompt = buildPanelImagePrompt(
      { caption: 'Hero enters', image_prompt: 'door opens, rain outside' },
      0,
      3,
      { style_prompt: 'clean comic' },
      { title: 'T', description: 'D' },
      { hasStyleReferenceImage: true }
    );
    expect(prompt).toContain('Use the style of the provided summary reference image');
  });

  it('builds reference prompt from full generation settings', () => {
    const prompt = buildStyleReferencePrompt(
      { title: 'T', description: 'D short summary' },
      {
        objective: 'fun',
        style_prompt: 'clean comic',
        output_language: 'he',
        detail_level: 'high',
        objective_prompt_overrides: { fun: 'Keep playful tone.' },
        custom_story_prompt: 'Focus on surprising twists.',
        custom_panel_prompt: 'Use cinematic close-ups.'
      }
    );
    expect(prompt).toContain('Objective: fun');
    expect(prompt).toContain('Style: clean comic');
    expect(prompt).toContain('Output language: he');
    expect(prompt).toContain('Detail level: high');
    expect(prompt).toContain('Objective-specific guidance: Keep playful tone.');
    expect(prompt).toContain('Custom story guidance: Focus on surprising twists.');
    expect(prompt).toContain('Custom panel guidance: Use cinematic close-ups.');
  });

  it('skips reference generation when consistency is off', async () => {
    const storyboard = { title: 'Story', description: 'Summary' };
    const off = await generateConsistencyReferenceImage({
      generation: { consistency: false },
      providers: { image: { provider: 'gemini', model: 'gemini-2.0-flash-exp-image-generation' } },
      runtime: { retries: 0 }
    }, storyboard);
    expect(off.used).toBe(false);
    expect(off.reason).toBe('disabled');
  });

  it('throws when consistency is enabled but provider/model is unsupported', async () => {
    const storyboard = { title: 'Story', description: 'Summary' };
    await expect(generateConsistencyReferenceImage({
      generation: { consistency: true },
      providers: { image: { provider: 'openai', model: 'dall-e-2' } },
      runtime: { retries: 0 }
    }, storyboard)).rejects.toThrow('does not support reference images');
  });
});
