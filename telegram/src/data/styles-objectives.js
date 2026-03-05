const OBJECTIVE_VALUES = [
  'summarize',
  'fun',
  'learn-step-by-step',
  'news-recap',
  'timeline',
  'key-facts',
  'compare-views',
  'explain-like-im-five',
  'study-guide',
  'meeting-recap',
  'how-to-guide',
  'debate-map'
];

const STYLE_PRESETS = {
  classic: 'clean illustrated art, readable characters, coherent scene progression',
  noir: 'film noir comic style, dramatic shadows, high contrast, moody scenes',
  manga: 'manga-inspired comic art, expressive characters, dynamic framing',
  superhero: 'american superhero comic style, dynamic action poses, bold colors',
  watercolor: 'watercolor comic style, soft painterly textures, warm tones',
  newspaper: 'newspaper comic strip style, clean ink lines, expressive cartooning'
};

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

module.exports = {
  OBJECTIVE_VALUES,
  STYLE_PRESETS,
  STYLE_SHORTCUTS,
  OBJECTIVE_SHORTCUTS
};
