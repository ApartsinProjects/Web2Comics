const STORYBOARD_PROMPT_PREFIX_LINES = [
  'Create a comic storyboard as strict JSON only. No markdown fences.',
  'Schema: {"title": string, "description": string, "panels":[{"caption": string, "image_prompt": string}]}'
];

const STORYBOARD_RULE_LINES = [
  '- Keep captions concise, factual, and sequential.',
  '- Build a clear narrative arc across panels: setup -> escalation -> turn -> resolution.',
  '- Keep character identity and setting continuity stable across panels.',
  '- Keep each image_prompt visual and concrete for a single panel scene.',
  '- For each image_prompt include: subject/action, environment, framing angle, lighting mood, and emotional tone.',
  '- Image prompt must avoid panel numbering and must never ask for any text elements inside the image.'
];

const STYLE_REFERENCE_PROMPT_LINES = {
  intro: 'Create one reference image that defines a consistent visual style bible for the full comic.',
  sceneRule: 'Show key characters and setting mood in one scene with strong silhouette readability and cohesive palette.'
};

const PANEL_IMAGE_PROMPT_LINES = {
  sceneRule: 'Create one clear scene (no collage), with strong focal point and readable composition.',
  styleLock1: 'STYLE LOCK: a summary reference image is provided as image input.',
  styleLock2: 'Treat that summary reference image as the authoritative style guide.',
  styleLock3: 'Match its linework, color palette, shading, lighting mood, character rendering, and texture treatment.',
  styleLock4: 'Keep scene content for this panel, but preserve the same visual style family as the summary image.'
};

const NO_TEXT_RULE_BLOCK = [
  'STRICT NO-TEXT RULE (English): do not render any text in the image.',
  'No words, letters, numbers, symbols, subtitles, labels, signs, logos, UI text, speech bubbles, captions, or watermarks.',
  'If any text appears, regenerate mentally and output a text-free scene.',
  'כלל ללא טקסט (עברית): אין להציג טקסט בתמונה.',
  'אין מילים, אותיות, מספרים, סמלים, כתוביות, תוויות, שלטים, לוגואים, טקסט ממשק, בועות דיבור, כיתובים או סימני מים.',
  'אם מופיע טקסט כלשהו, יש ליצור מחדש את התמונה ללא טקסט.',
  'СТРОГО БЕЗ ТЕКСТА (Русский): не добавляй текст на изображение.',
  'Без слов, букв, цифр, символов, субтитров, подписей, табличек, логотипов, интерфейсного текста, облаков речи, титров и водяных знаков.',
  'Если появляется текст, пересоздай сцену полностью без текста.'
];

module.exports = {
  STORYBOARD_PROMPT_PREFIX_LINES,
  STORYBOARD_RULE_LINES,
  STYLE_REFERENCE_PROMPT_LINES,
  PANEL_IMAGE_PROMPT_LINES,
  NO_TEXT_RULE_BLOCK
};
