const {
  classifyMessageInput,
  extractFirstUrl,
  inferLikelyWebUrlFromText,
  extractMessageInputText,
  extractFirstUrlLikeToken,
  isLikelyPdfUrl,
  extractFirstPdfUrlLikeToken,
  isLikelyAudioUrl,
  extractFirstAudioUrlLikeToken
} = require('../src/message-utils');

describe('message utils URL parsing', () => {
  it('detects plain URL', () => {
    const out = classifyMessageInput('https://example.com/path');
    expect(out.kind).toBe('url');
    expect(out.value).toBe('https://example.com/path');
  });

  it('extracts first URL from mixed text', () => {
    const out = classifyMessageInput('Read this: https://example.com/article now');
    expect(out.kind).toBe('url');
    expect(out.value).toBe('https://example.com/article');
  });

  it('treats long story text with URL as text (not URL source)', () => {
    const longStory = [
      'A curious kid finds an old map in a dusty library and decides to follow it after school.',
      'The map leads through the city park, across a noisy market, and into a quiet museum basement.',
      'Along the way, she writes notes about every clue and keeps asking why each symbol matters.',
      'At the end she learns the map was a lesson in observation and courage, not hidden treasure.',
      'Reference material: https://example.com/background'
    ].join(' ');
    const out = classifyMessageInput(longStory);
    expect(out.kind).toBe('text');
    expect(out.value).toContain('https://example.com/background');
  });

  it('treats mixed text+URL as URL when story text is below 200 chars', () => {
    const shortMixed = 'Quick context for this link only. https://example.com/article';
    const out = classifyMessageInput(shortMixed);
    expect(out.kind).toBe('url');
    expect(out.value).toBe('https://example.com/article');
  });

  it('uses 200-char threshold for mixed text+URL story override', () => {
    const base = 'a'.repeat(199);
    const below = `${base} https://example.com/a`;
    const belowOut = classifyMessageInput(below);
    expect(belowOut.kind).toBe('url');

    const atLeast = `${base}b https://example.com/a`;
    const atLeastOut = classifyMessageInput(atLeast);
    expect(atLeastOut.kind).toBe('text');
  });

  it('strips trailing punctuation from URL', () => {
    const extracted = extractFirstUrl('Please use https://example.com/page).');
    expect(extracted).toBe('https://example.com/page');
  });

  it('infers URL without protocol from short host/path text', () => {
    expect(inferLikelyWebUrlFromText('example.com/news')).toBe('https://example.com/news');
    expect(inferLikelyWebUrlFromText('www.example.com')).toBe('https://www.example.com/');
  });

  it('classifies bare URL text without protocol as URL', () => {
    const out1 = classifyMessageInput('www.cnn.com');
    expect(out1.kind).toBe('url');
    expect(out1.value).toBe('https://www.cnn.com/');
    const out2 = classifyMessageInput('cnn.com/world');
    expect(out2.kind).toBe('url');
    expect(out2.value).toBe('https://cnn.com/world');
  });

  it('normalizes malformed protocol slashes and classifies as URL', () => {
    const out = classifyMessageInput('http:\\\\www.cnn.com');
    expect(out.kind).toBe('url');
    expect(out.value).toBe('http://www.cnn.com');
    const mixed = classifyMessageInput('see this http:\\\\example.com/news now');
    expect(mixed.kind).toBe('url');
    expect(mixed.value).toBe('http://example.com/news');
  });

  it('does not infer URL from plain short phrase', () => {
    expect(inferLikelyWebUrlFromText('Space cat')).toBe('');
  });

  it('detects URL-like host token inside short text', () => {
    expect(extractFirstUrlLikeToken('please open cnn.com now')).toBe('https://cnn.com/');
    const out = classifyMessageInput('please open cnn.com now');
    expect(out.kind).toBe('url');
    expect(out.value).toBe('https://cnn.com/');
  });

  it('detects URL-like token with malformed protocol inside short text', () => {
    const out = classifyMessageInput('go to https:\\\\cnn.com/world');
    expect(out.kind).toBe('url');
    expect(out.value).toBe('https://cnn.com/world');
  });

  it('detects PDF links with and without protocol', () => {
    expect(isLikelyPdfUrl('https://example.com/files/guide.pdf')).toBe(true);
    expect(isLikelyPdfUrl('https://example.com/download?file=guide.pdf')).toBe(true);
    expect(isLikelyPdfUrl('https://example.com/article')).toBe(false);
    expect(extractFirstPdfUrlLikeToken('please parse www.example.com/docs/file.pdf now')).toBe('https://www.example.com/docs/file.pdf');
  });

  it('detects audio links with and without protocol', () => {
    expect(isLikelyAudioUrl('https://example.com/audio/clip.mp3')).toBe(true);
    expect(isLikelyAudioUrl('https://example.com/audio/clip.ogg?x=1')).toBe(true);
    expect(isLikelyAudioUrl('https://example.com/article')).toBe(false);
    expect(extractFirstAudioUrlLikeToken('please use www.example.com/audio/clip.wav now')).toBe('https://www.example.com/audio/clip.wav');
  });

  it('extracts and merges multiple telegram text fields', () => {
    const merged = extractMessageInputText({
      caption: 'https://example.com/article',
      caption_entities: [{ type: 'url', offset: 0, length: 27 }],
      reply_to_message: {
        text: [
          'This is a long continuation from replied content that should count as part of current input.',
          'It contains story details, events, and context so combined input is above two hundred characters.',
          'Parser should treat this as text story and ignore URL source mode.'
        ].join(' ')
      }
    });
    expect(merged).toContain('https://example.com/article');
    expect(merged.length).toBeGreaterThan(200);
    const out = classifyMessageInput(merged);
    expect(out.kind).toBe('text');
  });

  it('extracts text_link entity URLs across fields', () => {
    const merged = extractMessageInputText({
      text: 'Check this out',
      entities: [{ type: 'text_link', offset: 0, length: 14, url: 'https://example.com/x' }],
      quote: {
        text: 'and this one',
        entities: [{ type: 'text_link', offset: 0, length: 12, url: 'https://example.com/y' }]
      }
    });
    expect(merged).toContain('https://example.com/x');
    expect(merged).toContain('https://example.com/y');
  });
});
