const OBJECTIVE_DEFINITIONS = {
  summarize: {
    name: 'Summary',
    description: 'Summarize the source with clear cause-and-effect and concise, accurate beats.'
  },
  fun: {
    name: 'Fun',
    description: 'Make it playful, surprising, and entertaining while keeping the main facts accurate.'
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
