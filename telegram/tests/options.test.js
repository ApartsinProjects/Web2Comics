const { parseUserValue, getOptions } = require('../src/options');

describe('render options', () => {
  it('parses numeric path values', () => {
    expect(parseUserValue('generation.panel_count', '6')).toBe(6);
    expect(parseUserValue('runtime.retries', '2')).toBe(2);
    expect(parseUserValue('generation.invent_temperature', '1.25')).toBe(1.25);
    expect(parseUserValue('generation.consistency', 'on')).toBe(true);
    expect(parseUserValue('generation.consistency', 'off')).toBe(false);
    expect(parseUserValue('generation.short_prompt_word_threshold', '12')).toBe(12);
    expect(parseUserValue('generation.auto_enrich_short_story_prompts', 'on')).toBe(true);
    expect(parseUserValue('generation.include_sources', 'off')).toBe(false);
  });

  it('returns options list', () => {
    const opts = getOptions('generation.objective');
    expect(Array.isArray(opts)).toBe(true);
    expect(opts.includes('summarize')).toBe(true);
    expect(opts.includes('meme')).toBe(true);
    expect(getOptions('generation.invent_temperature').includes('0.95')).toBe(true);
    expect(getOptions('generation.delivery_mode').includes('media_group')).toBe(true);
    expect(getOptions('generation.consistency').includes('on')).toBe(true);
    expect(getOptions('generation.url_extractor').includes('firecrawl')).toBe(true);
    expect(getOptions('generation.url_extractor').includes('jina')).toBe(true);
    expect(getOptions('generation.url_extractor').includes('diffbot')).toBe(true);
    expect(getOptions('generation.url_extractor').includes('driftbot')).toBe(true);
    expect(getOptions('generation.url_extractor_gemini_model').includes('gemini-2.5-flash')).toBe(true);
    expect(getOptions('generation.pdf_extractor').includes('llamaparse')).toBe(true);
    expect(getOptions('generation.pdf_extractor').includes('unstructured')).toBe(true);
    expect(getOptions('generation.pdf_extractor_unstructured_strategy').includes('hi_res')).toBe(true);
    expect(getOptions('generation.image_extractor').includes('gemini')).toBe(true);
    expect(getOptions('generation.image_extractor').includes('openai')).toBe(true);
    expect(getOptions('generation.image_extractor_gemini_model').includes('gemini-2.5-flash')).toBe(true);
    expect(getOptions('generation.image_extractor_openai_model').includes('gpt-4.1-mini')).toBe(true);
    expect(getOptions('generation.voice_extractor').includes('assemblyai')).toBe(true);
    expect(getOptions('generation.voice_extractor_assemblyai_model').includes('best')).toBe(true);
    expect(getOptions('providers.text.model').includes('command-r-plus')).toBe(true);
    expect(getOptions('providers.image.model').includes('gpt-image-1')).toBe(true);
    expect(getOptions('generation.enrichment_provider').includes('wikipedia')).toBe(true);
    expect(getOptions('generation.enrichment_provider').includes('wikidata')).toBe(true);
    expect(getOptions('generation.enrichment_provider').includes('dbpedia')).toBe(true);
    expect(getOptions('generation.enrichment_provider').includes('gdelt')).toBe(true);
    expect(getOptions('generation.enrichment_provider').includes('googlekg')).toBe(true);
    expect(getOptions('generation.enrichment_provider').includes('brave')).toBe(true);
    expect(getOptions('generation.enrichment_provider').includes('tavily')).toBe(true);
    expect(getOptions('generation.enrichment_provider').includes('exa')).toBe(true);
    expect(getOptions('generation.enrichment_provider').includes('serper')).toBe(true);
    expect(getOptions('generation.enrichment_provider').includes('serpapi')).toBe(true);
    expect(getOptions('generation.enrichment_fallback_provider').includes('gemini')).toBe(true);
  });
});
