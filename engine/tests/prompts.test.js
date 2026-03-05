const {
  buildStoryboardPrompt,
  extractJsonCandidate,
  sanitizeJsonCandidate,
  parseStoryboardResponse
} = require('../src/prompts');

describe('storyboard prompt parsing', () => {
  it('always includes visual style line for every objective prompt', () => {
    const objectives = ['summarize', 'fun', 'explain-like-im-five', 'debate-map'];
    objectives.forEach((objective) => {
      const prompt = buildStoryboardPrompt({
        sourceTitle: 'T',
        sourceLabel: 'text',
        sourceText: 'Sample source',
        panelCount: 3,
        objective,
        stylePrompt: 'ink-heavy noir with dynamic framing',
        outputLanguage: 'en',
        objectivePromptOverride: objective === 'fun' ? 'Keep a playful rhythm.' : '',
        customStoryPrompt: ''
      });
      expect(prompt).toContain(`Objective: ${objective}`);
      expect(prompt).toContain('Visual style: ink-heavy noir with dynamic framing');
      expect(prompt).toContain('must avoid panel numbering');
      expect(prompt).toContain('must not ask for any text elements');
    });
  });

  it('extracts json object from fenced output', () => {
    const raw = [
      'Here is the storyboard:',
      '```json',
      '{"title":"T","description":"D","panels":[{"caption":"A","image_prompt":"B"}]}',
      '```'
    ].join('\n');
    const out = extractJsonCandidate(raw);
    expect(out.startsWith('{')).toBe(true);
    expect(out.endsWith('}')).toBe(true);
  });

  it('sanitizes trailing commas before parse', () => {
    const raw = '{"title":"T","description":"D","panels":[{"caption":"A","image_prompt":"B",},],}';
    const sanitized = sanitizeJsonCandidate(raw);
    expect(() => JSON.parse(sanitized)).not.toThrow();
    const parsed = parseStoryboardResponse(sanitized, 1);
    expect(parsed.panels.length).toBe(1);
    expect(parsed.panels[0].caption).toBe('A');
  });
});
