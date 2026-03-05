const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function waitForExit(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for process exit')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe('crash persistence integration', () => {
  it('persists startup failure log to persistent storage', async () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-crash-int-'));
    const crashDir = path.join(tmpDir, 'crash-logs');
    const latestPath = path.join(crashDir, 'latest.json');
    const env = {
      ...process.env,
      TELEGRAM_BOT_TOKEN: 'TEST_TOKEN',
      TELEGRAM_WEBHOOK_SECRET: '',
      RENDER_BOT_CRASH_LOG_DIR: crashDir,
      RENDER_BOT_CRASH_LOG_LATEST: latestPath,
      RENDER_BOT_STATE_FILE: path.join(tmpDir, 'runtime-state.json'),
      RENDER_BOT_FAKE_GENERATOR: 'true'
    };

    const child = spawn(process.execPath, ['render/src/webhook-bot.js'], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const logs = { stdout: '', stderr: '' };
    child.stdout.on('data', (d) => { logs.stdout += String(d); });
    child.stderr.on('data', (d) => { logs.stderr += String(d); });

    const result = await waitForExit(child, 15000);
    expect(result.code).toBe(1);
    expect(fs.existsSync(latestPath)).toBe(true);

    const pointer = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
    expect(fs.existsSync(pointer.path)).toBe(true);
    const latest = JSON.parse(fs.readFileSync(pointer.path, 'utf8'));
    expect(latest.event).toBe('startupFailure');
    expect(String(latest.error && latest.error.message || '')).toContain('Missing TELEGRAM_WEBHOOK_SECRET');
    expect(String(logs.stderr)).toContain('startup failed');
  });
});

