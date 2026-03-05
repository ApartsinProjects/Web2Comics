const path = require('path');
const fs = require('fs');
const os = require('os');
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

  it('prioritizes article text over cnn-like ad feedback boilerplate', () => {
    const html = `
      <html>
        <head><title>Breaking News | CNN</title></head>
        <body>
          <main>
            <div class="feedback">CNN values your feedback. How relevant is this ad to you? Did you encounter any technical issues? Ad never loaded.</div>
            <article class="article__content">
              <h1>Mission update</h1>
              <p>The rescue team reached the mountain village before dawn and restored power to the main clinic.</p>
              <p>Doctors treated dozens of residents while volunteers distributed food and warm clothing.</p>
              <p>Officials said the operation would continue through the weekend as roads reopen.</p>
            </article>
          </main>
        </body>
      </html>
    `;
    const out = extractFromHtml(html, {});
    expect(out.title).toContain('CNN');
    expect(out.text).toContain('The rescue team reached the mountain village before dawn');
    expect(out.text).toContain('Officials said the operation would continue through the weekend');
    expect(out.text).not.toMatch(/values your feedback/i);
    expect(out.text).not.toMatch(/how relevant is this ad/i);
    expect(out.text).not.toMatch(/did you encounter any technical issues/i);
  });

  it('uses meta description to improve short generic extraction', () => {
    const html = `
      <html>
        <head>
          <title>Example Site</title>
          <meta name="description" content="A short summary from metadata for this page." />
        </head>
        <body>
          <main><div>Login</div><div>Sign up</div></main>
        </body>
      </html>
    `;
    const out = extractFromHtml(html, {});
    expect(out.text).toContain('A short summary from metadata for this page.');
  });

  it('flags access-block pages and loadSource throws a clear error', () => {
    const html = `
      <html>
        <head><title>Just a moment...</title></head>
        <body><main>Verification successful. Waiting for chatgpt.com to respond.</main></body>
      </html>
    `;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w2c-input-block-'));
    const p = path.join(tmp, 'blocked.html');
    fs.writeFileSync(p, html, 'utf8');
    expect(() => loadSource(p, { format: 'html', max_chars: 10000 })).toThrow(/blocked or gated/i);
  });
});
