import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('webhook instrumentation coverage', () => {
  it('includes input/output/decision/error runtime events', () => {
    const file = path.resolve(process.cwd(), 'telegram/src/webhook-bot.js');
    const src = fs.readFileSync(file, 'utf8');
    const required = [
      "'input_received'",
      "'output_sent'",
      "'decision_route_selected'",
      "'generation_success'",
      "'generation_error'",
      "'queue_enqueued'",
      "'queue_job_completed'"
    ];
    required.forEach((token) => expect(src).toContain(token));
  });
});
