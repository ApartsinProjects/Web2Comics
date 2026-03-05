const { enforceNoTextImagePrompt } = require('../src/providers');

describe('provider-level no-text prompt guard', () => {
  it('appends strict no-text rule when missing', () => {
    const out = enforceNoTextImagePrompt('Draw a dramatic comic scene in rain');
    expect(out).toContain('STRICT NO-TEXT RULE');
    expect(out).toContain('speech bubbles');
    expect(out).toContain('text-free artwork');
  });

  it('does not duplicate no-text suffix when already present', () => {
    const inPrompt = 'Draw scene.\nSTRICT NO-TEXT RULE: do not render text.';
    const out = enforceNoTextImagePrompt(inPrompt);
    const count = (out.match(/STRICT NO-TEXT RULE/g) || []).length;
    expect(count).toBe(1);
  });
});

