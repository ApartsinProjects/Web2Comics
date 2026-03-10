const { decideInputIntent } = require('../src/intent-routing');

describe('intent routing', () => {
  it('routes non-text sources to extraction', () => {
    const out = decideInputIntent({
      incomingKind: 'text',
      text: 'https://cnn.com',
      sourceType: 'html_url',
      shortPromptMaxChars: 120
    });
    expect(out.route).toBe('source_extraction');
    expect(out.reason).toContain('non_text_source');
  });

  it('routes short URL-like text to url path', () => {
    const out = decideInputIntent({
      incomingKind: 'text',
      text: 'www.cnn.com',
      sourceType: '',
      shortPromptMaxChars: 120
    });
    expect(out.route).toBe('url');
    expect(out.parsedKind).toBe('url');
  });

  it('routes short non-url text to invent path', () => {
    const out = decideInputIntent({
      incomingKind: 'text',
      text: 'Napoleon in space',
      sourceType: '',
      shortPromptMaxChars: 120
    });
    expect(out.route).toBe('invent');
    expect(out.reason).toBe('short_text_needs_story_expansion');
  });

  it('routes long story with URL to text path', () => {
    const longStory = [
      'A curious kid finds an old map in a dusty library and decides to follow it after school.',
      'The map leads through the city park, across a noisy market, and into a quiet museum basement.',
      'Along the way, she writes notes about every clue and keeps asking why each symbol matters.',
      'At the end she learns the map was a lesson in observation and courage, not hidden treasure.',
      'Reference material: https://example.com/background'
    ].join(' ');
    const out = decideInputIntent({
      incomingKind: 'text',
      text: longStory,
      sourceType: '',
      shortPromptMaxChars: 120
    });
    expect(out.route).toBe('text');
    expect(out.parsedKind).toBe('text');
  });
});

