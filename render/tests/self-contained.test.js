const fs = require('fs');
const path = require('path');

describe('render runtime is self-contained', () => {
  it('does not import comicbot modules from render runtime files', () => {
    const files = [
      path.resolve(__dirname, '../src/webhook-bot.js'),
      path.resolve(__dirname, '../src/set-webhook.js'),
      path.resolve(__dirname, '../scripts/deploy-render-webhook.js')
    ];

    files.forEach((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      expect(source.includes("../../comicbot/")).toBe(false);
      expect(source.includes('../../comicbot/')).toBe(false);
    });
  });
});
