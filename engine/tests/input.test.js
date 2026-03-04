const path = require('path');
const { extractFromHtml, loadSource } = require('../src/input');

describe('engine input', () => {
  it('extracts readable text from html', () => {
    const html = '<html><head><title>X</title></head><body><main><p>Hello world story text.</p></main></body></html>';
    const out = extractFromHtml(html, { strip_selectors: ['script'] });
    expect(out.title).toBe('X');
    expect(out.text).toContain('Hello world story text');
  });

  it('loads source fixture html', () => {
    const fixture = path.resolve(__dirname, './fixtures/sample.html');
    const out = loadSource(fixture, { format: 'html', max_chars: 10000, strip_selectors: ['header', 'footer'] });
    expect(out.title).toContain('Space Launch');
    expect(out.text.length).toBeGreaterThan(60);
  });
});
