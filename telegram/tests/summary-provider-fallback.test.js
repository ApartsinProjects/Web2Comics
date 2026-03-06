import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('summary provider fallback guard', () => {
  it('falls back to gemini when summary text provider is invalid or empty', () => {
    const file = path.resolve(process.cwd(), 'telegram/src/webhook-bot.js');
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toContain("const provider = PROVIDER_NAMES.includes(requestedProvider) ? requestedProvider : 'gemini';");
    expect(src).toContain("summary_text_provider_fallback");
  });
});
