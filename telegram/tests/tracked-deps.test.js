const { execSync } = require('child_process');

function isTracked(relPath) {
  const out = execSync(`git ls-files -- "${relPath}"`, { encoding: 'utf8' }).trim();
  return out === relPath;
}

describe('render deployment dependencies are tracked in git', () => {
  it('tracks engine runtime files required by render', () => {
    const required = [
      'engine/src/index.js',
      'engine/src/config.js',
      'engine/src/url-fetch.js'
    ];
    required.forEach((p) => {
      expect(isTracked(p)).toBe(true);
    });
  });
});
