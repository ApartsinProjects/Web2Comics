import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('webhook startup version log', () => {
  it('logs bot version when server starts', () => {
    const file = path.resolve(process.cwd(), 'telegram/src/webhook-bot.js');
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toContain("[render-bot] version: ${BOT_VERSION}");
  });
});
