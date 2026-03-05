const {
  extractJsonCandidate,
  sanitizeJsonCandidate,
  parseStoryboardResponse
} = require('../src/prompts');

describe('storyboard prompt parsing', () => {
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

