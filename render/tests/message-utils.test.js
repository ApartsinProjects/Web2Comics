const { classifyMessageInput, extractFirstUrl } = require('../src/message-utils');

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
});

