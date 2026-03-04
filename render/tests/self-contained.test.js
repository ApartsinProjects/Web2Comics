const fs = require('fs');
const path = require('path');

describe('render runtime is self-contained', () => {
  it('does not import comicbot modules from render runtime files', () => {
    const srcDir = path.resolve(__dirname, '../src');
    const scriptsDir = path.resolve(__dirname, '../scripts');
    const files = []
      .concat(fs.readdirSync(srcDir).map((name) => path.join(srcDir, name)))
      .concat(fs.readdirSync(scriptsDir).map((name) => path.join(scriptsDir, name)))
      .filter((p) => p.endsWith('.js'));

    files.forEach((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      expect(source.includes("../../comicbot/")).toBe(false);
      expect(source.includes('../../comicbot/')).toBe(false);
    });
  });
});
