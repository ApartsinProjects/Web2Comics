const { classifyMessageInput, extractFirstUrl, inferLikelyWebUrlFromText } = require('../src/message-utils');

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
});
