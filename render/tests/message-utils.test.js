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
