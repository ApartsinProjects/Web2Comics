#!/usr/bin/env node
const { execSync } = require('child_process');

function run(cmd, env) {
  execSync(cmd, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...(env || {}) }
  });
}

run('npm run test:render');

const runReal = String(process.env.RUN_RENDER_REAL_GEMINI || '') === '1';
if (runReal) {
  run('npm run test:render:gemini-real');
}

console.log('[predeploy] render test checks passed');
