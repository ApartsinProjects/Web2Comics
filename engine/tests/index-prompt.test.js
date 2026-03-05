const { buildPanelImagePrompt } = require('../src');

describe('engine panel prompt builder', () => {
  it('includes background and panel-specific image description fields', () => {
    const prompt = buildPanelImagePrompt(
      { caption: 'Hero enters the lab', image_prompt: 'Wide shot of hero opening lab door, neon lights' },
      0,
      4,
      { style_prompt: 'clean comic style' },
      { title: 'Lab Mystery', description: 'A rookie investigator follows clues through a high-tech lab at night.' }
    );

    expect(prompt).toContain('Background: A rookie investigator follows clues through a high-tech lab at night.');
    expect(prompt).toContain('Image description: Wide shot of hero opening lab door, neon lights');
    expect(prompt).toContain('Style: clean comic style');
    expect(prompt).not.toContain('Story title:');
    expect(prompt).not.toContain('Comic panel scene');
    expect(prompt).not.toContain('Panel caption:');
    expect(prompt).not.toMatch(/\b\d+\s*\/\s*\d+\b/);
    expect(prompt).toContain('STRICT NO-TEXT RULE');
    expect(prompt).toContain('speech bubbles');
  });

  it('uses fallback summary context when storyboard description is missing', () => {
    const prompt = buildPanelImagePrompt(
      { caption: 'Hero opens the hidden vault', image_prompt: 'Character at vault door, dramatic light' },
      1,
      3,
      { style_prompt: 'clean comic style' },
      {
        title: 'Vault Mystery',
        panels: [
          { caption: 'Hero finds a coded map' },
          { caption: 'Hero opens the hidden vault' },
          { caption: 'A drone escapes with the artifact' }
        ]
      }
    );

    expect(prompt).toContain('Background: Hero finds a coded map Hero opens the hidden vault A drone escapes with the artifact');
    expect(prompt).not.toContain('Story title:');
  });
});
