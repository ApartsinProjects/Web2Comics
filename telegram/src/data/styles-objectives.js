const OBJECTIVE_DEFINITIONS = {
  summarize: {
    name: 'Summary',
    description: 'Summarize the source with clear cause-and-effect and concise, accurate beats.'
  },
  fun: {
    name: 'Fun',
    description: 'Make it playful, surprising, and entertaining while keeping the main facts accurate.'
  },
  meme: {
    name: 'Meme Viral',
    description: 'Craft each panel as punchy, relatable, and instantly shareable meme content with a strong setup-payoff rhythm, high emotional contrast, and visual hooks people want to repost.'
  },
  'learn-step-by-step': {
    name: 'Learn Step By Step',
    description: 'Teach progressively from basics to advanced points, with clear transitions between steps.'
  },
  'news-recap': {
    name: 'News Recap',
    description: 'Focus on who/what/when/where/why and keep a neutral, factual recap tone.'
  },
  timeline: {
    name: 'Timeline',
    description: 'Present events in strict chronological order with explicit time progression.'
  },
  'key-facts': {
    name: 'Key Facts',
    description: 'Highlight only the most important facts and remove weak or repetitive details.'
  },
  'compare-views': {
    name: 'Compare Views',
    description: 'Present contrasting viewpoints fairly, showing agreements, disagreements, and evidence.'
  },
  'explain-like-im-five': {
    name: 'Explain Like I Am Five',
    description: 'Use simple words, short sentences, and relatable examples suitable for a young audience.'
  },
  'study-guide': {
    name: 'Study Guide',
    description: 'Structure content for learning and recall with definitions, examples, and memory cues.'
  },
  'meeting-recap': {
    name: 'Meeting Recap',
    description: 'Emphasize decisions, actions, owners, and next steps in a practical recap format.'
  },
  'how-to-guide': {
    name: 'How To Guide',
    description: 'Convert source into actionable instructions with prerequisites, sequence, and outcomes.'
  },
  'debate-map': {
    name: 'Debate Map',
    description: 'Map claims, counter-claims, and supporting evidence with logical structure and balance.'
  },
  'scientific-paper-comics': {
    name: 'Scientific Paper Comics',
    description: 'Turn research papers into clear visual summaries emphasizing problem, method, results, limitations, and practical impact.'
  },
  'legal-contract-visualization': {
    name: 'Legal Contract Visualization',
    description: 'Present obligations, responsibilities, timelines, exceptions, and risk points as an easy-to-follow legal narrative.'
  },
  'corporate-meeting-summaries': {
    name: 'Corporate Meeting Summaries',
    description: 'Condense meeting discussions into decisions, owners, disagreements, action items, deadlines, and next steps.'
  },
  'software-documentation-comics': {
    name: 'Software Documentation Comics',
    description: 'Explain setup flow, architecture, APIs, and onboarding sequence as practical step-by-step technical visuals.'
  },
  'customer-support-conversation-comics': {
    name: 'Customer Support Conversation Comics',
    description: 'Reconstruct support interactions into issue timeline, troubleshooting attempts, root cause, escalation, and resolution.'
  },
  'historical-story-mode': {
    name: 'Historical Story Mode',
    description: 'Depict historical events and biographies with chronological accuracy, context, and engaging narrative continuity.'
  },
  'therapy-reflection-journals': {
    name: 'Therapy / Reflection Journals',
    description: 'Transform reflection text into gentle narrative scenes that highlight emotions, triggers, coping choices, and growth.'
  },
  'children-learning-mode': {
    name: 'Children Learning Mode',
    description: 'Explain concepts using age-appropriate language, friendly examples, and memorable educational storytelling.'
  },
  'debate-visualization': {
    name: 'Debate Visualization',
    description: 'Represent opposing viewpoints as clear scenes showing positions, tradeoffs, evidence, and potential compromise.'
  },
  'investor-narrative-mode': {
    name: 'Investor Narrative Mode',
    description: 'Translate financial and company updates into clear cause-effect narratives about risks, drivers, and market implications.'
  }
};

const STYLE_DEFINITIONS = {
  classic: {
    name: 'Classic',
    description: 'clean illustrated art, readable characters, coherent scene progression'
  },
  noir: {
    name: 'Noir',
    description: 'film noir comic style, dramatic shadows, high contrast, moody scenes'
  },
  manga: {
    name: 'Manga',
    description: 'manga-inspired comic art, expressive characters, dynamic framing'
  },
  superhero: {
    name: 'Superhero',
    description: 'american superhero comic style, dynamic action poses, bold colors'
  },
  watercolor: {
    name: 'Watercolor',
    description: 'watercolor comic style, soft painterly textures, warm tones'
  },
  newspaper: {
    name: 'Newspaper',
    description: 'newspaper comic strip style, clean ink lines, expressive cartooning'
  },
  cinematic: {
    name: 'Cinematic',
    description: 'cinematic concept-art look, dramatic composition, volumetric lighting, rich depth'
  },
  anime: {
    name: 'Anime',
    description: 'anime-inspired style, clean cel shading, expressive faces, dynamic action framing'
  },
  cyberpunk: {
    name: 'Cyberpunk',
    description: 'neon cyberpunk mood, high-tech cityscapes, reflective surfaces, electric color glow'
  },
  'pixel-art': {
    name: 'Pixel Art',
    description: 'retro pixel-art aesthetic, chunky pixels, limited palette, crisp 2D game vibe'
  },
  'retro-pop': {
    name: 'Retro Pop',
    description: 'retro pop-art comic style, halftone texture, bold contour lines, vibrant flat colors'
  },
  minimalist: {
    name: 'Minimalist',
    description: 'minimalist visual language, simple geometry, clean negative space, restrained palette'
  },
  storybook: {
    name: 'Storybook',
    description: 'illustrated storybook look, warm textures, whimsical details, soft narrative atmosphere'
  },
  'ink-wash': {
    name: 'Ink Wash',
    description: 'ink wash illustration style, flowing brush strokes, subtle gradients, poetic contrast'
  },
  'line-art': {
    name: 'Line Art',
    description: 'clean line-art rendering, precise contours, light shading, high visual clarity'
  },
  'clay-3d': {
    name: 'Clay 3D',
    description: 'stylized clay-like 3D render, tactile materials, soft global illumination, playful forms'
  }
};

const OBJECTIVE_VALUES = Object.keys(OBJECTIVE_DEFINITIONS);
const STYLE_PRESETS = Object.fromEntries(
  Object.entries(STYLE_DEFINITIONS).map(([id, meta]) => [id, String(meta.description || '').trim()])
);

const STYLE_SHORTCUTS = Object.fromEntries(
  Object.keys(STYLE_PRESETS).map((name) => [`/${name}`, name])
);

const OBJECTIVE_SHORTCUTS = {
  '/summary': 'summarize',
  '/fun': 'fun',
  '/meme': 'meme',
  '/learn': 'learn-step-by-step',
  '/news': 'news-recap',
  '/timeline': 'timeline',
  '/facts': 'key-facts',
  '/compare': 'compare-views',
  '/5yold': 'explain-like-im-five',
  '/eli5': 'explain-like-im-five',
  '/study': 'study-guide',
  '/meeting': 'meeting-recap',
  '/howto': 'how-to-guide',
  '/debate': 'debate-map'
};

function getObjectiveMeta(objectiveId) {
  const id = String(objectiveId || '').trim().toLowerCase();
  const found = OBJECTIVE_DEFINITIONS[id] || null;
  if (!found) {
    return {
      id,
      name: id || 'Objective',
      description: ''
    };
  }
  return {
    id,
    name: String(found.name || id).trim(),
    description: String(found.description || '').trim()
  };
}

function getStyleMeta(styleId) {
  const id = String(styleId || '').trim().toLowerCase();
  const found = STYLE_DEFINITIONS[id] || null;
  if (!found) {
    return {
      id,
      name: id || 'Style',
      description: ''
    };
  }
  return {
    id,
    name: String(found.name || id).trim(),
    description: String(found.description || '').trim()
  };
}

module.exports = {
  OBJECTIVE_DEFINITIONS,
  STYLE_DEFINITIONS,
  OBJECTIVE_VALUES,
  STYLE_PRESETS,
  STYLE_SHORTCUTS,
  OBJECTIVE_SHORTCUTS,
  getObjectiveMeta,
  getStyleMeta
};
