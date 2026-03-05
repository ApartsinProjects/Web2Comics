const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSecretValues } = require('../src/env');

describe('env secret loader', () => {
  it('loads from KEY_FILE when env key is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-secret-file-'));
    const secretPath = path.join(dir, 'gemini.txt');
    fs.writeFileSync(secretPath, 'TEST_GEMINI_FROM_FILE\n', 'utf8');

    delete process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY_FILE = secretPath;
    loadSecretValues(['GEMINI_API_KEY']);
    expect(process.env.GEMINI_API_KEY).toBe('TEST_GEMINI_FROM_FILE');

    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY_FILE;
  });

  it('loads from /run/secrets-like folder fallback', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-secret-dir-'));
    fs.writeFileSync(path.join(dir, 'telegram_bot_token'), 'BOT_TOKEN_FROM_SECRET\n', 'utf8');
    delete process.env.TELEGRAM_BOT_TOKEN;
    loadSecretValues(['TELEGRAM_BOT_TOKEN'], { baseDir: dir });
    expect(process.env.TELEGRAM_BOT_TOKEN).toBe('BOT_TOKEN_FROM_SECRET');
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('does not override existing env value', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-secret-existing-'));
    fs.writeFileSync(path.join(dir, 'openai_api_key'), 'FROM_SECRET_FILE\n', 'utf8');
    process.env.OPENAI_API_KEY = 'FROM_ENV';
    loadSecretValues(['OPENAI_API_KEY'], { baseDir: dir });
    expect(process.env.OPENAI_API_KEY).toBe('FROM_ENV');
    delete process.env.OPENAI_API_KEY;
  });
});
