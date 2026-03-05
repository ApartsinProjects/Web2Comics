const { buildPanelImagePrompt } = require('../src');

describe('engine panel prompt builder', () => {
  it('includes story summary and panel-specific visual brief', () => {
    const prompt = buildPanelImagePrompt(
      { caption: 'Hero enters the lab', image_prompt: 'Wide shot of hero opening lab door, neon lights' },
      0,
      4,
      { style_prompt: 'clean comic style' },
      { title: 'Lab Mystery', description: 'A rookie investigator follows clues through a high-tech lab at night.' }
    );

    expect(prompt).toContain('Story title: Lab Mystery');
    expect(prompt).toContain('Story summary: A rookie investigator follows clues through a high-tech lab at night.');
    expect(prompt).toContain('Panel caption: Hero enters the lab');
    expect(prompt).toContain('Panel visual brief: Wide shot of hero opening lab door, neon lights');
  });
});
