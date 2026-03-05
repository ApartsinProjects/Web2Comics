const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { validateCloudflareTokenRoles } = require('../scripts/predeploy-check');

describe('predeploy script portability', () => {
  it('uses shell execSync for cross-platform npm execution', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts/predeploy-check.js'), 'utf8');
    expect(source.includes("const { execSync } = require('child_process');")).toBe(true);
    expect(source.includes('shell: true')).toBe(true);
  });

  it('deploy script supports --help without executing deployment', () => {
    const script = path.resolve(__dirname, '../scripts/deploy-render-webhook.js');
    const out = execFileSync(process.execPath, [script, '--help'], {
      encoding: 'utf8',
      env: { ...process.env }
    });
    expect(String(out)).toContain('Usage: node telegram/scripts/deploy-render-webhook.js [options]');
    expect(String(out)).toContain('--skip-provider-auth-check');
  });

  it('deploy script rejects deprecated --cloudflare-api-token argument', () => {
    const script = path.resolve(__dirname, '../scripts/deploy-render-webhook.js');
    let error = null;
    try {
      execFileSync(process.execPath, [script, '--cloudflare-api-token', 'legacy'], {
        encoding: 'utf8',
        env: { ...process.env, BOT_SECRETS_ENV_ONLY: 'true' },
        stdio: 'pipe'
      });
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();
    const stderr = String(error && error.stderr ? error.stderr : '');
    expect(stderr).toContain('Deprecated --cloudflare-api-token is not supported');
  });

  it('fails token-role validation when cloudflare vars are mixed incorrectly', () => {
    const result = validateCloudflareTokenRoles({
      CLOUDFLARE_ACCOUNT_ID: 'acc',
      CLOUDFLARE_WORKERS_AI_TOKEN: 'workers-token',
      CLOUDFLARE_ACCOUNT_API_TOKEN: 'account-token',
      CLOUDFLARE_API_TOKEN: 'account-token'
    });
    expect(result.enabled).toBe(true);
    expect(result.issues.some((line) => line.includes('must represent Workers AI token only'))).toBe(true);
  });

  it('accepts valid token-role mapping with optional compatibility alias', () => {
    const result = validateCloudflareTokenRoles({
      CLOUDFLARE_ACCOUNT_ID: 'acc',
      CLOUDFLARE_WORKERS_AI_TOKEN: 'workers-token',
      CLOUDFLARE_ACCOUNT_API_TOKEN: 'account-token',
      CLOUDFLARE_API_TOKEN: 'workers-token'
    });
    expect(result.enabled).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
