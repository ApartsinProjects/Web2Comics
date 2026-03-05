const { looksLikeUrl, classifyMessageInput, toSafeToken } = require('../src/message-utils');

describe('comicbot message utils', () => {
  it('detects url', () => {
    expect(looksLikeUrl('https://example.com')).toBe(true);
    expect(looksLikeUrl('http://example.com/a?b=1')).toBe(true);
    expect(looksLikeUrl('example.com')).toBe(false);
  });

  it('classifies text/url/empty', () => {
    expect(classifyMessageInput('')).toEqual({ kind: 'empty', value: '' });
    expect(classifyMessageInput('https://x.com')).toEqual({ kind: 'url', value: 'https://x.com' });
    expect(classifyMessageInput('hello story')).toEqual({ kind: 'text', value: 'hello story' });
  });

  it('creates safe token', () => {
    expect(toSafeToken('Hello World!!')).toBe('hello-world');
  });
});
