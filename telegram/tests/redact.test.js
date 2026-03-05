const { redactSensitiveText } = require('../src/redact');

describe('redactSensitiveText', () => {
  it('redacts exact sensitive values', () => {
    const output = redactSensitiveText(
      'Token=abc123SECRET and db=postgres://user:pw@host/db',
      ['abc123SECRET', 'postgres://user:pw@host/db']
    );
    expect(output).toContain('Token=[REDACTED]');
    expect(output).toContain('db=[REDACTED]');
    expect(output).not.toContain('abc123SECRET');
  });

  it('ignores short values to reduce accidental masking', () => {
    const output = redactSensitiveText('value is abc', ['abc']);
    expect(output).toBe('value is abc');
  });
});
