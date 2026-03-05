const {
  classifyMessageInput,
  extractFirstUrl,
  inferLikelyWebUrlFromText,
  extractMessageInputText
} = require('../src/message-utils');

describe('message utils URL parsing', () => {
  it('detects plain URL', () => {
    const out = classifyMessageInput('https://example.com/path');
    expect(out.kind).toBe('url');
    expect(out.value).toBe('https://example.com/path');
  });

  it('extracts first URL from mixed text', () => {
    const out = classifyMessageInput('Read this: https://example.com/article now');
    expect(out.kind).toBe('url');
    expect(out.value).toBe('https://example.com/article');
  });

  it('treats long story text with URL as text (not URL source)', () => {
    const longStory = [
      'A curious kid finds an old map in a dusty library and decides to follow it after school.',
      'The map leads through the city park, across a noisy market, and into a quiet museum basement.',
      'Along the way, she writes notes about every clue and keeps asking why each symbol matters.',
      'At the end she learns the map was a lesson in observation and courage, not hidden treasure.',
      'Reference material: https://example.com/background'
    ].join(' ');
    const out = classifyMessageInput(longStory);
    expect(out.kind).toBe('text');
    expect(out.value).toContain('https://example.com/background');
  });

  it('treats mixed text+URL as URL when story text is below 200 chars', () => {
    const shortMixed = 'Quick context for this link only. https://example.com/article';
    const out = classifyMessageInput(shortMixed);
    expect(out.kind).toBe('url');
    expect(out.value).toBe('https://example.com/article');
  });

  it('uses 200-char threshold for mixed text+URL story override', () => {
    const base = 'a'.repeat(199);
    const below = `${base} https://example.com/a`;
    const belowOut = classifyMessageInput(below);
    expect(belowOut.kind).toBe('url');

    const atLeast = `${base}b https://example.com/a`;
    const atLeastOut = classifyMessageInput(atLeast);
    expect(atLeastOut.kind).toBe('text');
  });

  it('strips trailing punctuation from URL', () => {
    const extracted = extractFirstUrl('Please use https://example.com/page).');
    expect(extracted).toBe('https://example.com/page');
  });

  it('infers URL without protocol from short host/path text', () => {
    expect(inferLikelyWebUrlFromText('example.com/news')).toBe('https://example.com/news');
    expect(inferLikelyWebUrlFromText('www.example.com')).toBe('https://www.example.com/');
  });

  it('does not infer URL from plain short phrase', () => {
    expect(inferLikelyWebUrlFromText('Space cat')).toBe('');
  });

  it('extracts and merges multiple telegram text fields', () => {
    const merged = extractMessageInputText({
      caption: 'https://example.com/article',
      caption_entities: [{ type: 'url', offset: 0, length: 27 }],
      reply_to_message: {
        text: [
          'This is a long continuation from replied content that should count as part of current input.',
          'It contains story details, events, and context so combined input is above two hundred characters.',
          'Parser should treat this as text story and ignore URL source mode.'
        ].join(' ')
      }
    });
    expect(merged).toContain('https://example.com/article');
    expect(merged.length).toBeGreaterThan(200);
    const out = classifyMessageInput(merged);
    expect(out.kind).toBe('text');
  });

  it('extracts text_link entity URLs across fields', () => {
    const merged = extractMessageInputText({
      text: 'Check this out',
      entities: [{ type: 'text_link', offset: 0, length: 14, url: 'https://example.com/x' }],
      quote: {
        text: 'and this one',
        entities: [{ type: 'text_link', offset: 0, length: 12, url: 'https://example.com/y' }]
      }
    });
    expect(merged).toContain('https://example.com/x');
    expect(merged).toContain('https://example.com/y');
  });
});
