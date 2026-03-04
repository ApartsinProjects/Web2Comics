const fs = require('fs');
const path = require('path');

describe('predeploy script portability', () => {
  it('uses shell execSync for cross-platform npm execution', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts/predeploy-check.js'), 'utf8');
    expect(source.includes("const { execSync } = require('child_process');")).toBe(true);
    expect(source.includes('shell: true')).toBe(true);
  });
});
