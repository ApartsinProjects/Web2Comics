const path = require('path');
const { sanitizeFileToken, buildSnapshotPath } = require('../src/url-fetch');

describe('engine url snapshot helpers', () => {
  it('sanitizes url into file token', () => {
    const token = sanitizeFileToken('https://www.Example.com/News?id=123&x=1');
    expect(token).toContain('www-example-com-news-id-123-x-1');
  });

  it('builds snapshot path next to output file', () => {
    const out = buildSnapshotPath('https://example.com/a', 'engine/out/my-comic.png');
    expect(path.basename(out)).toContain('my-comic.snapshot.');
    expect(out.endsWith('.html')).toBe(true);
  });
});
