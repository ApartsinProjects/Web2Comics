// Keep runtime defaults local to avoid importing shared/types.js, which currently contains
// TypeScript-only declarations and is not executable as a browser module.
const DEFAULT_SETTINGS = {
  panelCount: 3,
  objective: 'summarize',
  detailLevel: 'low',
  styleId: 'default',
  customStyleName: '',
  customStyleTheme: '',
  captionLength: 'short',
  outputLanguage: 'en',
  activeTextProvider: 'gemini-free',
  activeImageProvider: 'gemini-free',
  textModel: 'gpt-4o-mini',
  imageModel: 'dall-e-2',
  geminiTextModel: 'gemini-2.5-flash',
  geminiImageModel: 'gemini-2.0-flash-exp-image-generation',
  cloudflareTextModel: '@cf/meta/llama-3.1-8b-instruct',
  cloudflareImageModel: '@cf/black-forest-labs/flux-1-schnell',
  openrouterTextModel: 'openai/gpt-oss-20b:free',
  openrouterImageModel: 'google/gemini-2.5-flash-image-preview',
  openrouterImageSize: '1K',
  huggingfaceTextModel: 'mistralai/Mistral-7B-Instruct-v0.2',
  huggingfaceImageModel: 'black-forest-labs/FLUX.1-schnell',
  huggingfaceImageSize: '512x512',
  huggingfaceImageQuality: 'fastest',
  openaiImageQuality: 'standard',
  openaiImageSize: '256x256',
  characterConsistency: false,
  debugFlag: false,
  imageRefusalHandling: 'rewrite_and_retry',
  showRewrittenBadge: true,
  logRewrittenPrompts: false,
  maxCacheSize: 100,
  autoOpenSidePanel: true,
  googleDriveAutoSave: false,
  otherShareTarget: 'linkedin'
};

const AUTHORIZATION_URLS = {
  googleDrive: 'https://accounts.google.com/',
  facebook: 'https://www.facebook.com/login/',
  x: 'https://x.com/i/flow/login',
  instagram: 'https://www.instagram.com/accounts/login/',
  linkedin: 'https://www.linkedin.com/login',
  reddit: 'https://www.reddit.com/login/',
  email: 'https://mail.google.com/'
};

const DEFAULT_PROMPT_TEMPLATES = {
  openai: {
    storyboard:
      'Create a comic storyboard as strict JSON with a top-level "panels" array.\n' +
      'Grounding rules:\n' +
      '- Choose one dominant story/topic from the content and keep all panels on that topic.\n' +
      '- Use concrete facts from the content (named entities, numbers, dates, outcomes) when available.\n' +
      '- Do not invent unsupported facts, quotes, or events.\n' +
      '- Build a clear beginning -> development -> outcome arc across panels.\n' +
      '- Keep captions specific and concise; avoid generic filler.\n' +
      'Source: {{source_title}} ({{source_url}})\nPanels: {{panel_count}}\nDetail: {{detail_level}}\nObjective: {{objective_label}}\nObjective guidance: {{objective_guidance}}\nStyle: {{style_prompt}}\nContent:\n{{content}}',
    image:
      'Comic panel {{panel_index}}/{{panel_count}}.\nCaption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
      'Image grounding rules:\n' +
      '- Depict the exact event/claim in caption+summary, not a generic scene.\n' +
      '- Reuse key entities/details from caption+summary (who/where/what) when provided.\n' +
      '- Keep character/setting continuity with prior panels.\n' +
      '- No text overlays unless explicitly required by the caption.'
  },
  gemini: {
    storyboard:
      'Generate a comic storyboard in strict JSON only, with a top-level "panels" array.\n' +
      'Grounding rules:\n' +
      '- Choose one dominant story/topic from the content and keep all panels on that topic.\n' +
      '- Use concrete facts from the content (named entities, numbers, dates, outcomes) when available.\n' +
      '- Do not invent unsupported facts, quotes, or events.\n' +
      '- Build a clear beginning -> development -> outcome arc across panels.\n' +
      '- Keep captions specific and concise; avoid generic filler.\n' +
      'Source title: {{source_title}}\nSource URL: {{source_url}}\nPanel count: {{panel_count}}\nDetail level: {{detail_level}}\nObjective: {{objective_label}}\nObjective guidance: {{objective_guidance}}\nStyle guidance: {{style_prompt}}\nContent:\n{{content}}',
    image:
      'Create comic panel artwork {{panel_index}}/{{panel_count}}.\nPanel caption: {{panel_caption}}\nPanel summary: {{panel_summary}}\nStyle guidance: {{style_prompt}}\n' +
      'Image grounding rules:\n' +
      '- Depict the exact event/claim in caption+summary, not a generic scene.\n' +
      '- Reuse key entities/details from caption+summary (who/where/what) when provided.\n' +
      '- Keep character/setting continuity with prior panels.\n' +
      '- No text overlays unless explicitly required by the caption.'
  },
  cloudflare: {
    storyboard:
      'Create a comic storyboard as strict JSON with a top-level "panels" array.\n' +
      'Grounding rules:\n' +
      '- Choose one dominant story/topic from the content and keep all panels on that topic.\n' +
      '- Use concrete facts from the content (named entities, numbers, dates, outcomes) when available.\n' +
      '- Do not invent unsupported facts, quotes, or events.\n' +
      '- Build a clear beginning -> development -> outcome arc across panels.\n' +
      '- Keep captions specific and concise; avoid generic filler.\n' +
      'Source: {{source_title}} ({{source_url}})\nPanels: {{panel_count}}\nDetail: {{detail_level}}\nObjective: {{objective_label}}\nObjective guidance: {{objective_guidance}}\nStyle: {{style_prompt}}\nContent:\n{{content}}',
    image:
      'Comic panel {{panel_index}}/{{panel_count}}.\nCaption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
      'Image grounding rules:\n' +
      '- Depict the exact event/claim in caption+summary, not a generic scene.\n' +
      '- Reuse key entities/details from caption+summary (who/where/what) when provided.\n' +
      '- Keep character/setting continuity with prior panels.\n' +
      '- No text overlays unless explicitly required by the caption.'
  },
  openrouter: {
    storyboard:
      'Create a comic storyboard as strict JSON with a top-level "panels" array.\n' +
      'Grounding rules:\n' +
      '- Choose one dominant story/topic from the content and keep all panels on that topic.\n' +
      '- Use concrete facts from the content (named entities, numbers, dates, outcomes) when available.\n' +
      '- Do not invent unsupported facts, quotes, or events.\n' +
      '- Build a clear beginning -> development -> outcome arc across panels.\n' +
      '- Keep captions specific and concise; avoid generic filler.\n' +
      'Source: {{source_title}} ({{source_url}})\nPanels: {{panel_count}}\nDetail: {{detail_level}}\nObjective: {{objective_label}}\nObjective guidance: {{objective_guidance}}\nStyle: {{style_prompt}}\nContent:\n{{content}}',
    image:
      'Comic panel {{panel_index}}/{{panel_count}}.\nCaption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
      'Image grounding rules:\n' +
      '- Depict the exact event/claim in caption+summary, not a generic scene.\n' +
      '- Reuse key entities/details from caption+summary (who/where/what) when provided.\n' +
      '- Keep character/setting continuity with prior panels.\n' +
      '- No text overlays unless explicitly required by the caption.'
  },
  huggingface: {
    storyboard:
      'Create a comic storyboard as strict JSON with a top-level "panels" array.\n' +
      'Grounding rules:\n' +
      '- Choose one dominant story/topic from the content and keep all panels on that topic.\n' +
      '- Use concrete facts from the content (named entities, numbers, dates, outcomes) when available.\n' +
      '- Do not invent unsupported facts, quotes, or events.\n' +
      '- Build a clear beginning -> development -> outcome arc across panels.\n' +
      '- Keep captions specific and concise; avoid generic filler.\n' +
      'Source: {{source_title}} ({{source_url}})\nPanels: {{panel_count}}\nDetail: {{detail_level}}\nObjective: {{objective_label}}\nObjective guidance: {{objective_guidance}}\nStyle: {{style_prompt}}\nContent:\n{{content}}',
    image:
      'Comic panel {{panel_index}}/{{panel_count}}.\nCaption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
      'Image grounding rules:\n' +
      '- Depict the exact event/claim in caption+summary, not a generic scene.\n' +
      '- Reuse key entities/details from caption+summary (who/where/what) when provided.\n' +
      '- Keep character/setting continuity with prior panels.\n' +
      '- No text overlays unless explicitly required by the caption.'
  }
};
const PROMPT_LIBRARY_PRESETS = {
  news: [
    {
      id: 'news_breaking_recap',
      name: 'Breaking Recap',
      objective: 'News Recap',
      useCase: 'Fast update from one article with concrete facts and outcomes.',
      storyboard:
        'Create a factual comic recap as strict JSON with top-level "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Use only evidence from source, including entities, numbers, dates, and verified outcomes.\n' +
        'Structure: what happened -> why it matters -> what happens next.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Panel {{panel_index}}/{{panel_count}} for a news recap.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Depict the specific reported event and actors; avoid generic newsroom scenes.'
    },
    {
      id: 'news_compare_views',
      name: 'Compare Views',
      objective: 'Compare Viewpoints',
      useCase: 'Balanced contrast of claims, evidence, and implications.',
      storyboard:
        'Create a balanced compare-views storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Alternate perspectives, attach each claim to source evidence, and end with unresolved tensions.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Comic panel {{panel_index}}/{{panel_count}} comparing viewpoints.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Use scene composition to visualize contrast grounded in panel evidence.'
    },
    {
      id: 'news_fact_check',
      name: 'Fact Check',
      objective: 'Key Facts Only',
      useCase: 'Separate strong facts from speculation in one article.',
      storyboard:
        'Create a fact-check storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'For each panel, state one high-confidence fact and one caveat if uncertainty exists.\n' +
        'Keep wording precise and non-sensational.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Fact-check panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Visualize facts as concrete scenes, not abstract symbols.'
    }
  ],
  learning: [
    {
      id: 'learn_step_by_step',
      name: 'Step-by-Step Explainer',
      objective: 'Learn Step by Step',
      useCase: 'Turn dense source text into progressive learning steps.',
      storyboard:
        'Generate a learning storyboard in strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Each panel adds one concept in sequence from basics to conclusion.\n' +
        'Include one concrete example whenever available.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Educational panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Visualize the exact concept from summary with clear instructional cues.'
    },
    {
      id: 'learn_eli5',
      name: 'ELI5 Simplifier',
      objective: "Explain Like I'm Five",
      useCase: 'Explain complex topics simply without losing key facts.',
      storyboard:
        'Create an ELI5 storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Use plain language and analogies while preserving factual anchors.\n' +
        'Avoid jargon unless you define it in one sentence.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Simple explanatory panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Use approachable visuals tied directly to panel facts.'
    },
    {
      id: 'learn_quiz_mode',
      name: 'Quiz Me',
      objective: 'Study Guide',
      useCase: 'Convert content into memorable Q/A-style narrative beats.',
      storyboard:
        'Create a study-guide storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Each panel should imply a question and answer using source facts.\n' +
        'End with a quick review panel.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Study panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Use visual memory anchors that map to concrete facts.'
    }
  ],
  work: [
    {
      id: 'work_meeting_notes',
      name: 'Meeting Notes',
      objective: 'Meeting Recap',
      useCase: 'Summarize decisions, owners, and next actions.',
      storyboard:
        'Create a meeting recap storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Capture decision -> rationale -> owner -> next step progression.\n' +
        'If names/owners are present, include them accurately.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Work recap panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Depict concrete meeting actions from the summary.'
    },
    {
      id: 'work_timeline',
      name: 'Project Timeline',
      objective: 'Timeline Breakdown',
      useCase: 'Convert updates into chronological milestones.',
      storyboard:
        'Create a timeline storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Each panel represents one dated milestone and dependency.\n' +
        'Panels should flow chronologically with explicit transitions.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Timeline panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Show sequence and causality, not disconnected scenes.'
    },
    {
      id: 'work_exec_brief',
      name: 'Executive Brief',
      objective: 'Quick Summary',
      useCase: 'Executive-level update: risks, progress, and decisions.',
      storyboard:
        'Create an executive brief storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Use concise language and prioritize impact, risks, and decisions.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Executive brief panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Use clean visual hierarchy and grounded business context.'
    }
  ],
  social: [
    {
      id: 'social_creator_hook',
      name: 'Creator Hook',
      objective: 'Have Fun',
      useCase: 'Punchy, shareable comic with factual grounding.',
      storyboard:
        'Create a social-first storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Start with a hook, build tension, end with a memorable payoff grounded in source facts.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Share-ready panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Design for readability and strong visual hook tied to source facts.'
    },
    {
      id: 'social_quick_summary',
      name: 'Quick Share Summary',
      objective: 'Quick Summary',
      useCase: 'Portable summary for social sharing with clear takeaway.',
      storyboard:
        'Generate a concise social summary as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Panel 1 hook/context, middle factual beats, last panel takeaway.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Compact social panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Depict one clear idea per panel with continuity across the strip.'
    },
    {
      id: 'social_thread_builder',
      name: 'Thread Builder',
      objective: 'Key Facts Only',
      useCase: 'Turn long content into a sequence suitable for post/thread slides.',
      storyboard:
        'Create a thread-ready storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Each panel should stand alone but also connect as a sequence.\n' +
        'Use short captions with one factual point per panel.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Thread panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Optimize for mobile readability and scannable composition.'
    }
  ],
  research: [
    {
      id: 'research_paper_digest',
      name: 'Paper Digest',
      objective: 'Quick Summary',
      useCase: 'Summarize a paper/article into hypothesis, method, findings, limits.',
      storyboard:
        'Create a research digest storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Cover question, method, key findings, and limitations with factual precision.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Research digest panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Visualize claims and evidence, not decorative generic lab scenes.'
    },
    {
      id: 'research_method_walkthrough',
      name: 'Method Walkthrough',
      objective: 'How-To Guide',
      useCase: 'Explain methods/process sections clearly.',
      storyboard:
        'Create a method walkthrough storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Use sequential steps and include assumptions/prerequisites when present.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Method panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Use process visuals tied directly to the described method.'
    },
    {
      id: 'research_debate_map',
      name: 'Debate Map',
      objective: 'Debate Map',
      useCase: 'Map competing interpretations and evidence.',
      storyboard:
        'Create a debate-map storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'For each panel, show claim -> supporting evidence -> counterpoint.\n' +
        'End with an evidence-weighted synthesis.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Debate-map panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Use framing that makes opposing claims visually distinct and grounded.'
    }
  ],
  marketing: [
    {
      id: 'marketing_case_study',
      name: 'Case Study',
      objective: 'Quick Summary',
      useCase: 'Convert article into problem, action, result narrative.',
      storyboard:
        'Create a case-study storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Use structure: challenge -> strategy -> execution -> measurable result.\n' +
        'Include concrete metrics when available.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Case-study panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Depict practical scenarios with clear before/after progression.'
    },
    {
      id: 'marketing_aida',
      name: 'AIDA Story',
      objective: 'Have Fun',
      useCase: 'Create attention-interest-desire-action comic arc.',
      storyboard:
        'Create an AIDA storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Map panels to attention, interest, desire, action while grounded in source facts.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'AIDA panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Prioritize clarity of emotional arc without inventing facts.'
    },
    {
      id: 'marketing_feature_benefit',
      name: 'Feature -> Benefit',
      objective: 'How-To Guide',
      useCase: 'Translate technical features into end-user benefits.',
      storyboard:
        'Create a feature-to-benefit storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Each panel should map one feature to one practical outcome.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Feature-benefit panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Show user outcome directly linked to the feature.'
    }
  ],
  product: [
    {
      id: 'product_release_notes',
      name: 'Release Notes',
      objective: 'Timeline Breakdown',
      useCase: 'Turn release notes into a user-facing story.',
      storyboard:
        'Create a release-notes storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Cover changes, user impact, migration notes, and known constraints.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Release panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Visualize concrete before/after product states.'
    },
    {
      id: 'product_tradeoffs',
      name: 'Tradeoff Explorer',
      objective: 'Compare Viewpoints',
      useCase: 'Explain product/architecture tradeoffs.',
      storyboard:
        'Create a tradeoff storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Present options, constraints, tradeoffs, and recommendation criteria.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Tradeoff panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Depict comparative scenarios grounded in source details.'
    },
    {
      id: 'product_user_journey',
      name: 'User Journey',
      objective: 'Learn Step by Step',
      useCase: 'Show user flow from pain point to success state.',
      storyboard:
        'Create a user-journey storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Sequence panels as trigger -> action -> obstacle -> resolution.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'User-journey panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Show user context and progression with consistent visual continuity.'
    }
  ],
  study: [
    {
      id: 'study_exam_cram',
      name: 'Exam Cram',
      objective: 'Study Guide',
      useCase: 'High-yield recap for quick revision.',
      storyboard:
        'Create an exam-cram storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Prioritize high-yield facts, definitions, and common pitfalls.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Exam-cram panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Use mnemonic-friendly visuals tied to concrete facts.'
    },
    {
      id: 'study_timeline_memory',
      name: 'Memory Timeline',
      objective: 'Timeline Breakdown',
      useCase: 'Memorize chronology-heavy topics.',
      storyboard:
        'Create a memory timeline storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Each panel should lock one date/time period to a key event and consequence.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Memory timeline panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Make chronology explicit and easy to remember.'
    },
    {
      id: 'study_concept_map',
      name: 'Concept Map',
      objective: 'Learn Step by Step',
      useCase: 'Connect definitions, relationships, and examples.',
      storyboard:
        'Create a concept-map storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Map one core concept per panel and show how it links to previous panels.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Concept-map panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Use relationship-focused scenes grounded in source concepts.'
    }
  ],
  fun: [
    {
      id: 'fun_satire_light',
      name: 'Light Satire',
      objective: 'Have Fun',
      useCase: 'Playful retelling while keeping facts grounded.',
      storyboard:
        'Create a playful satire storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Tone can be witty, but factual claims must stay grounded in source.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Playful panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Use exaggerated expressions but preserve factual context.'
    },
    {
      id: 'fun_character_drama',
      name: 'Character Drama',
      objective: 'Have Fun',
      useCase: 'Narrative-driven comic emphasizing character perspective.',
      storyboard:
        'Create a character-driven storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Frame each panel through actor motivations from source facts.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Character drama panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Keep characters consistent across panels and grounded in source details.'
    },
    {
      id: 'fun_mini_adventure',
      name: 'Mini Adventure',
      objective: 'Quick Summary',
      useCase: 'Convert source into a fast adventure arc.',
      storyboard:
        'Create an adventure-style storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Use setup -> challenge -> turning point -> resolution while staying factual.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Adventure panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}\n' +
        'Keep energy high without introducing unsupported events.'
    }
  ],
  styles: [
    {
      id: 'style_noir_editorial',
      name: 'Noir Editorial',
      objective: 'Quick Summary',
      useCase: 'High-contrast dramatic look for serious topics.',
      storyboard:
        'Create a noir-style storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Keep factual clarity while using dramatic narrative pacing.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Noir editorial panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}; high contrast, cinematic shadows.\n' +
        'Ground every visual beat in the panel summary.'
    },
    {
      id: 'style_newspaper_strip',
      name: 'Newspaper Strip',
      objective: 'Quick Summary',
      useCase: 'Classic concise storytelling with clean framing.',
      storyboard:
        'Create a newspaper-strip storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Use concise captions and clear setup/payoff flow.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Newspaper-strip panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}; clean ink lines and readable composition.\n' +
        'Avoid clutter and keep one idea per panel.'
    },
    {
      id: 'style_cinematic_storyboard',
      name: 'Cinematic Storyboard',
      objective: 'Timeline Breakdown',
      useCase: 'Film-like scene progression with continuity emphasis.',
      storyboard:
        'Create a cinematic storyboard as strict JSON with "panels".\n' +
        'Objective: {{objective_label}}. Guidance: {{objective_guidance}}\n' +
        'Use shot progression (wide -> medium -> close) while preserving source facts.\n' +
        'Panels: {{panel_count}}\nSource: {{source_title}} ({{source_url}})\nContent:\n{{content}}',
      image:
        'Cinematic panel {{panel_index}}/{{panel_count}}.\n' +
        'Caption: {{panel_caption}}\nSummary: {{panel_summary}}\nStyle: {{style_prompt}}; cinematic framing and coherent lighting.\n' +
        'Maintain continuity in location, actors, and key objects.'
    }
  ]
};
const USER_STYLE_PREFIX = 'user:';

function mapRecommendedSettingsPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  if (payload.settings && typeof payload.settings === 'object') return payload.settings;
  const providers = payload.providers || {};
  return {
    textModel: providers.openai?.text,
    imageModel: providers.openai?.image,
    geminiTextModel: providers.gemini?.text,
    geminiImageModel: providers.gemini?.image,
    cloudflareTextModel: providers.cloudflare?.text,
    cloudflareImageModel: providers.cloudflare?.image,
    openrouterTextModel: providers.openrouter?.text,
    openrouterImageModel: providers.openrouter?.image,
    huggingfaceTextModel: providers.huggingface?.text,
    huggingfaceImageModel: providers.huggingface?.image
  };
}

class OptionsController {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.customStyles = [];
    this.promptTemplates = JSON.parse(JSON.stringify(DEFAULT_PROMPT_TEMPLATES));
    this.promptLibraryCustomPresets = [];
    this.connectionStates = {};
    this.pendingPromptLibraryPreview = null;
    this.activePromptProviderScope = 'openai';
    this.init();
  }

  async init() {
    await this.loadRecommendedDefaults();
    await this.loadSettings();
    await this.loadStorageInfo();
    this.relocateModelTestButtons();
    this.bindEvents();
    this.updateUI();
    await this.refreshAllConnectionStatuses();
  }

  async appendDebugLog(event, data) {
    try {
      const { debugLogs } = await chrome.storage.local.get('debugLogs');
      const logs = Array.isArray(debugLogs) ? debugLogs : [];
      logs.push({
        ts: new Date().toISOString(),
        source: 'options',
        event,
        ...(data && typeof data === 'object' ? { data } : {})
      });
      if (logs.length > 1000) logs.splice(0, logs.length - 1000);
      await chrome.storage.local.set({ debugLogs: logs });
    } catch (_) {}
  }

  async loadRecommendedDefaults() {
    try {
      if (typeof fetch !== 'function' || !chrome?.runtime?.getURL) return;
      const url = chrome.runtime.getURL('shared/recommended-model-set.local.json');
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      const recommendedSettings = mapRecommendedSettingsPayload(json);
      if (!recommendedSettings || typeof recommendedSettings !== 'object') return;
      this.settings = { ...DEFAULT_SETTINGS, ...recommendedSettings };
    } catch (_) {
      // Optional local file. Ignore if missing/unreadable.
    }
  }

  async loadSettings() {
    try {
      const stored = await chrome.storage.local.get(['settings', 'providers', 'providerValidation', 'promptTemplates', 'customStyles', 'promptLibraryCustomPresets', 'connectionStates']);
      if (stored.settings) {
        this.settings = { ...this.settings, ...stored.settings };
      }
      this.customStyles = Array.isArray(stored.customStyles) ? stored.customStyles : [];
      this.promptLibraryCustomPresets = Array.isArray(stored.promptLibraryCustomPresets)
        ? stored.promptLibraryCustomPresets
        : [];
      this.connectionStates = (stored.connectionStates && typeof stored.connectionStates === 'object')
        ? stored.connectionStates
        : {};
      this.providers = stored.providers || {};
      this.providerValidation = stored.providerValidation || {};
      if (stored.promptTemplates && typeof stored.promptTemplates === 'object') {
        const mergedTemplates = {};
        Object.keys(DEFAULT_PROMPT_TEMPLATES).forEach((scope) => {
          mergedTemplates[scope] = {
            ...DEFAULT_PROMPT_TEMPLATES[scope],
            ...(stored.promptTemplates[scope] || {})
          };
        });
        this.promptTemplates = mergedTemplates;
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      void this.appendDebugLog('settings.load.error', { message: error?.message || String(error) });
    }
  }

  async loadStorageInfo() {
    try {
      const { history } = await chrome.storage.local.get('history');
      const historyCount = history?.length || 0;
      document.getElementById('history-size').textContent = `${historyCount} comics`;
    } catch (error) {
      console.error('Failed to load storage info:', error);
      void this.appendDebugLog('storage.info.load.error', { message: error?.message || String(error) });
    }
  }

  bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchSection(e.currentTarget.dataset.section));
    });

    // General settings
    document.getElementById('save-general-btn').addEventListener('click', () => this.saveGeneralSettings());
    document.getElementById('default-style')?.addEventListener('change', () => this.updateGeneralCustomStyleUI());
    document.getElementById('create-default-style-btn')?.addEventListener('click', () => this.createDefaultCustomStyle());

    // Provider settings
    document.querySelectorAll('.provider-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const providerCard = e.currentTarget;
        this.selectProvider(providerCard.dataset.provider);
      });
    });

    document.querySelectorAll('.validate-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.validateProvider(e.currentTarget.dataset.provider, e.currentTarget));
    });
    document.querySelectorAll('.test-model-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.testProviderModel(
        e.currentTarget.dataset.provider,
        e.currentTarget.dataset.mode,
        e.currentTarget
      ));
    });

    document.getElementById('save-providers-btn').addEventListener('click', () => this.saveProvidersSettings());
    document.getElementById('prompt-provider-scope')?.addEventListener('change', (e) => {
      this.activePromptProviderScope = e.currentTarget.value || 'openai';
      this.updatePromptTemplatesUI();
    });
    document.getElementById('save-prompts-btn')?.addEventListener('click', () => this.savePromptTemplates());
    document.getElementById('reset-storyboard-template-btn')?.addEventListener('click', () => this.resetPromptTemplateField('storyboard'));
    document.getElementById('reset-image-template-btn')?.addEventListener('click', () => this.resetPromptTemplateField('image'));
    document.getElementById('prompt-library-group')?.addEventListener('change', () => {
      this.populatePromptLibraryPresetUI();
      this.previewSelectedPromptLibraryPreset();
    });
    document.getElementById('prompt-library-preset')?.addEventListener('change', () => {
      this.updatePromptLibraryDescription();
      this.previewSelectedPromptLibraryPreset();
    });
    document.getElementById('apply-prompt-preset-current-btn')?.addEventListener('click', () => this.approvePromptLibraryPreview());
    document.getElementById('cancel-prompt-preset-preview-btn')?.addEventListener('click', () => this.cancelPromptLibraryPreview());
    document.getElementById('apply-prompt-preset-all-btn')?.addEventListener('click', () => this.applyPromptLibraryPreset(true));
    document.getElementById('import-prompt-library-btn')?.addEventListener('click', () => {
      document.getElementById('import-prompt-library-file')?.click();
    });
    document.getElementById('import-prompt-library-file')?.addEventListener('change', (event) => this.handlePromptLibraryImportFileChange(event));

    // Storage settings
    document.getElementById('clear-history-btn')?.addEventListener('click', () => this.clearHistory());
    document.getElementById('clear-cache-btn')?.addEventListener('click', () => this.clearCache());
    document.getElementById('export-data-btn')?.addEventListener('click', () => this.exportData());
    document.getElementById('export-debug-logs-btn')?.addEventListener('click', () => this.exportDebugLogs());
    document.getElementById('save-drive-settings-btn')?.addEventListener('click', () => this.saveConnectionSettings());
    document.getElementById('connect-google-drive-btn')?.addEventListener('click', () => this.connectGoogleDrive());
    document.getElementById('disconnect-google-drive-btn')?.addEventListener('click', () => this.disconnectGoogleDrive());
    document.getElementById('connect-facebook-btn')?.addEventListener('click', () => this.connectFacebook());
    document.getElementById('disconnect-facebook-btn')?.addEventListener('click', () => this.disconnectFacebook());
    document.getElementById('connect-x-btn')?.addEventListener('click', () => this.connectX());
    document.getElementById('disconnect-x-btn')?.addEventListener('click', () => this.disconnectX());
    document.getElementById('connect-instagram-btn')?.addEventListener('click', () => this.connectInstagram());
    document.getElementById('disconnect-instagram-btn')?.addEventListener('click', () => this.disconnectInstagram());
    document.getElementById('connect-other-share-btn')?.addEventListener('click', () => this.connectOtherShareTarget());
    document.getElementById('disconnect-other-share-btn')?.addEventListener('click', () => this.disconnectOtherShareTarget());
    document.getElementById('other-share-target-select')?.addEventListener('change', () => this.refreshOtherShareTargetStatus());
  }

  getProviderModelSelectId(providerId, mode) {
    if (providerId === 'openai') return mode === 'image' ? 'openai-image-model' : 'openai-text-model';
    if (providerId === 'gemini-free') return mode === 'image' ? 'gemini-image-model' : 'gemini-text-model';
    if (providerId === 'cloudflare-free') return mode === 'image' ? 'cloudflare-image-model' : 'cloudflare-text-model';
    if (providerId === 'openrouter') return mode === 'image' ? 'openrouter-image-model' : 'openrouter-text-model';
    if (providerId === 'huggingface') return mode === 'image' ? 'huggingface-image-model' : 'huggingface-text-model';
    return null;
  }

  relocateModelTestButtons() {
    document.querySelectorAll('.test-model-btn').forEach((btn) => {
      const providerId = btn.dataset.provider;
      const mode = btn.dataset.mode;
      const selectId = this.getProviderModelSelectId(providerId, mode);
      const selectEl = selectId ? document.getElementById(selectId) : null;
      const modelItem = selectEl?.closest('.model-item');
      if (!modelItem) return;

      let inlineWrap = btn.closest('.model-test-inline');
      if (!inlineWrap) {
        inlineWrap = document.createElement('div');
        inlineWrap.className = 'model-test-inline';
        const statusEl = document.createElement('div');
        statusEl.className = 'model-test-status';
        statusEl.setAttribute('aria-live', 'polite');
        inlineWrap.appendChild(btn);
        inlineWrap.appendChild(statusEl);
      }
      modelItem.appendChild(inlineWrap);
    });

    document.querySelectorAll('.model-test-actions').forEach((container) => {
      if (!container.querySelector('.test-model-btn')) {
        container.style.display = 'none';
      }
    });
  }

  getModelTestStatusEl(buttonEl, providerId, mode) {
    const inlineWrap = buttonEl?.closest('.model-test-inline');
    if (inlineWrap) {
      let statusEl = inlineWrap.querySelector('.model-test-status');
      if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.className = 'model-test-status';
        statusEl.setAttribute('aria-live', 'polite');
        inlineWrap.appendChild(statusEl);
      }
      return statusEl;
    }

    const selectId = this.getProviderModelSelectId(providerId, mode);
    const modelItem = selectId ? document.getElementById(selectId)?.closest('.model-item') : null;
    if (!modelItem) return null;
    let statusEl = modelItem.querySelector('.model-test-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.className = 'model-test-status';
      statusEl.setAttribute('aria-live', 'polite');
      modelItem.appendChild(statusEl);
    }
    return statusEl;
  }

  setModelTestStatus(buttonEl, providerId, mode, variant, message) {
    const statusEl = this.getModelTestStatusEl(buttonEl, providerId, mode);
    if (!statusEl) return;
    statusEl.className = `model-test-status ${variant || ''}`.trim();
    statusEl.textContent = message || '';
  }

  updateUI() {
    this.populateDefaultStyleOptions();
    // General
    document.getElementById('default-panel-count').value = this.settings.panelCount;
    document.getElementById('default-detail').value = this.settings.detailLevel;
    document.getElementById('default-style').value = this.settings.styleId || 'default';
    document.getElementById('default-caption').value = this.settings.captionLength;
    const defaultLanguageEl = document.getElementById('default-language');
    if (defaultLanguageEl) {
      defaultLanguageEl.value = this.settings.outputLanguage || 'en';
      if (defaultLanguageEl.value !== (this.settings.outputLanguage || 'en')) {
        defaultLanguageEl.value = 'en';
      }
    }
    document.getElementById('auto-open-panel').checked = this.settings.autoOpenSidePanel !== false;
    document.getElementById('character-consistency').checked = this.settings.characterConsistency || false;
    document.getElementById('debug-flag').checked = this.settings.debugFlag || false;
    const refusalMode = this.settings.imageRefusalHandling || 'rewrite_and_retry';
    const refusalSelect = document.getElementById('image-refusal-handling-select');
    if (refusalSelect) {
      refusalSelect.value = refusalMode;
      if (refusalSelect.value !== refusalMode) {
        refusalSelect.value = 'rewrite_and_retry';
      }
    }
    const badgeToggle = document.getElementById('show-rewritten-badge');
    if (badgeToggle) badgeToggle.checked = this.settings.showRewrittenBadge !== false;
    const logToggle = document.getElementById('log-rewritten-prompts');
    if (logToggle) logToggle.checked = !!this.settings.logRewrittenPrompts;
    
    // Custom style
    this.updateGeneralCustomStyleUI();

    // Storage
    document.getElementById('max-cache-size').value = this.settings.maxCacheSize || 100;
    document.getElementById('history-retention').value = this.settings.historyRetention || 30;
    const googleDriveAutoSaveItemEl = document.getElementById('google-drive-auto-save-item');
    const googleDriveAutoSaveEl = document.getElementById('google-drive-auto-save');
    if (googleDriveAutoSaveItemEl) {
      googleDriveAutoSaveItemEl.style.display = 'none';
    }
    if (googleDriveAutoSaveEl) {
      googleDriveAutoSaveEl.checked = !!this.settings.googleDriveAutoSave;
      googleDriveAutoSaveEl.disabled = true;
    }
    const otherTargetEl = document.getElementById('other-share-target-select');
    if (otherTargetEl) otherTargetEl.value = this.settings.otherShareTarget || 'linkedin';
    if (document.getElementById('openai-text-model')) {
      document.getElementById('openai-text-model').value = this.settings.textModel || 'gpt-4o-mini';
      document.getElementById('openai-image-model').value = this.settings.imageModel || 'dall-e-2';
      document.getElementById('openai-image-quality').value = this.settings.openaiImageQuality || 'standard';
      document.getElementById('openai-image-size').value = this.settings.openaiImageSize || '256x256';
      document.getElementById('gemini-text-model').value = this.settings.geminiTextModel || 'gemini-2.5-flash';
      document.getElementById('gemini-image-model').value = this.settings.geminiImageModel || 'gemini-2.0-flash-exp-image-generation';
      document.getElementById('cloudflare-text-model').value = this.settings.cloudflareTextModel || '@cf/meta/llama-3.1-8b-instruct';
      document.getElementById('cloudflare-image-model').value = this.settings.cloudflareImageModel || '@cf/black-forest-labs/flux-1-schnell';
      document.getElementById('openrouter-text-model').value = this.settings.openrouterTextModel || 'openai/gpt-oss-20b:free';
      if (document.getElementById('openrouter-image-model')) {
        document.getElementById('openrouter-image-model').value = this.settings.openrouterImageModel || 'google/gemini-2.5-flash-image-preview';
      }
      if (document.getElementById('openrouter-image-size')) {
        document.getElementById('openrouter-image-size').value = this.settings.openrouterImageSize || '1K';
      }
      document.getElementById('huggingface-text-model').value = this.settings.huggingfaceTextModel || 'mistralai/Mistral-7B-Instruct-v0.2';
      if (document.getElementById('huggingface-image-model')) {
        document.getElementById('huggingface-image-model').value = this.settings.huggingfaceImageModel || 'black-forest-labs/FLUX.1-schnell';
      }
      if (document.getElementById('huggingface-image-size')) {
        document.getElementById('huggingface-image-size').value = this.settings.huggingfaceImageSize || '512x512';
      }
      if (document.getElementById('huggingface-image-quality')) {
        document.getElementById('huggingface-image-quality').value = this.settings.huggingfaceImageQuality || 'fastest';
      }
    }

    // Check for stored API keys
    this.checkApiKeys();

    // Provider preset selection
    this.updateProviderSelectionUI();
    this.updatePromptTemplatesUI();
  }

  updateProviderSelectionUI() {
    const activeProvider = this.settings.activeTextProvider || 'gemini-free';
    document.querySelectorAll('.provider-card').forEach(card => {
      card.classList.toggle('active', card.dataset.provider === activeProvider);
    });
  }

  selectProvider(providerId) {
    if (!providerId) return;

    this.settings.activeTextProvider = providerId;

    // Only a subset of providers support image generation.
    if (
      providerId === 'gemini-free' ||
      providerId === 'openai' ||
      providerId === 'cloudflare-free' ||
      providerId === 'openrouter' ||
      providerId === 'huggingface'
    ) {
      this.settings.activeImageProvider = providerId;
    }

    this.updateProviderSelectionUI();
  }

  async checkApiKeys() {
    const { apiKeys, settings, providerValidation, cloudflareConfig, cloudflare } = await chrome.storage.local.get([
      'apiKeys',
      'settings',
      'providerValidation',
      'cloudflareConfig',
      'cloudflare'
    ]);
    const validations = providerValidation || {};
    const cfConfig = (cloudflareConfig && typeof cloudflareConfig === 'object')
      ? cloudflareConfig
      : ((cloudflare && typeof cloudflare === 'object') ? cloudflare : {});
    
    if (apiKeys?.gemini) {
      document.getElementById('gemini-api-key').value = '••••••••••••••••';
      this.updateProviderStatus('gemini', !!validations.gemini?.valid);
    }
    
    if (apiKeys?.openai) {
      document.getElementById('openai-api-key').value = '••••••••••••••••';
      this.updateProviderStatus('openai', !!validations.openai?.valid);
      
      // Load model selections
      if (settings?.textModel) {
        document.getElementById('openai-text-model').value = settings.textModel;
      }
      if (settings?.imageModel) {
        document.getElementById('openai-image-model').value = settings.imageModel;
      }
      if (settings?.openaiImageQuality) {
        document.getElementById('openai-image-quality').value = settings.openaiImageQuality;
      }
      if (settings?.openaiImageSize) {
        document.getElementById('openai-image-size').value = settings.openaiImageSize;
      }
    }

    if (settings?.geminiTextModel && document.getElementById('gemini-text-model')) {
      document.getElementById('gemini-text-model').value = settings.geminiTextModel;
    }
    if (settings?.geminiImageModel && document.getElementById('gemini-image-model')) {
      document.getElementById('gemini-image-model').value = settings.geminiImageModel;
    }
    if (settings?.cloudflareTextModel && document.getElementById('cloudflare-text-model')) {
      document.getElementById('cloudflare-text-model').value = settings.cloudflareTextModel;
    }
    if (settings?.cloudflareImageModel && document.getElementById('cloudflare-image-model')) {
      document.getElementById('cloudflare-image-model').value = settings.cloudflareImageModel;
    }
    if (document.getElementById('cloudflare-account-id') && cfConfig.accountId) {
      document.getElementById('cloudflare-account-id').value = cfConfig.accountId;
    }
    if (document.getElementById('cloudflare-api-token') && (cfConfig.apiToken || apiKeys?.cloudflare)) {
      document.getElementById('cloudflare-api-token').value = '••••••••••••••••';
    }
    if (document.getElementById('cloudflare-email') && cfConfig.email) {
      document.getElementById('cloudflare-email').value = cfConfig.email;
    }
    if (document.getElementById('cloudflare-api-key') && cfConfig.apiKey) {
      document.getElementById('cloudflare-api-key').value = '••••••••••••••••';
    }
    const hasCloudflareCreds = !!(
      cfConfig.accountId && (
        cfConfig.apiToken ||
        (cfConfig.email && cfConfig.apiKey)
      )
    );
    if (document.getElementById('cloudflare-status')) {
      if (hasCloudflareCreds) {
        this.updateProviderStatus('cloudflare', !!validations.cloudflare?.valid);
      } else {
        const text = document.querySelector('#cloudflare-status span:last-child');
        const indicator = document.querySelector('#cloudflare-status .status-indicator');
        if (indicator) indicator.classList.remove('ready');
        if (text) text.textContent = 'Not configured';
      }
    }
    if (settings?.openrouterTextModel && document.getElementById('openrouter-text-model')) {
      document.getElementById('openrouter-text-model').value = settings.openrouterTextModel;
    }
    if (settings?.openrouterImageModel && document.getElementById('openrouter-image-model')) {
      document.getElementById('openrouter-image-model').value = settings.openrouterImageModel;
    }
    if (settings?.openrouterImageSize && document.getElementById('openrouter-image-size')) {
      document.getElementById('openrouter-image-size').value = settings.openrouterImageSize;
    }
    if (settings?.huggingfaceTextModel && document.getElementById('huggingface-text-model')) {
      document.getElementById('huggingface-text-model').value = settings.huggingfaceTextModel;
    }
    if (settings?.huggingfaceImageModel && document.getElementById('huggingface-image-model')) {
      document.getElementById('huggingface-image-model').value = settings.huggingfaceImageModel;
    }
    if (settings?.huggingfaceImageSize && document.getElementById('huggingface-image-size')) {
      document.getElementById('huggingface-image-size').value = settings.huggingfaceImageSize;
    }
    if (settings?.huggingfaceImageQuality && document.getElementById('huggingface-image-quality')) {
      document.getElementById('huggingface-image-quality').value = settings.huggingfaceImageQuality;
    }

    if (apiKeys?.openrouter) {
      document.getElementById('openrouter-api-key').value = '••••••••••••••••';
      this.updateProviderStatus('openrouter', !!validations.openrouter?.valid);
    }

    if (apiKeys?.huggingface) {
      document.getElementById('huggingface-api-key').value = '••••••••••••••••';
      this.updateProviderStatus('huggingface', !!validations.huggingface?.valid);
    }
  }

  switchSection(section) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.section === section);
    });

    document.querySelectorAll('.settings-section').forEach(sec => {
      sec.classList.toggle('active', sec.id === `${section}-section`);
    });
  }

  getPromptScopeTemplates(scope = this.activePromptProviderScope) {
    const providerScope = DEFAULT_PROMPT_TEMPLATES[scope] ? scope : 'openai';
    return this.promptTemplates[providerScope] || DEFAULT_PROMPT_TEMPLATES[providerScope];
  }

  updateGeneralCustomStyleUI() {
    const customContainer = document.getElementById('default-custom-style-container');
    const styleSelect = document.getElementById('default-style');
    if (!customContainer || !styleSelect) return;
    const isCustom = styleSelect.value === 'custom';
    customContainer.style.display = isCustom ? 'block' : 'none';
    if (isCustom) {
      const nameEl = document.getElementById('default-custom-style-name');
      const descEl = document.getElementById('default-custom-style');
      if (nameEl) nameEl.value = this.settings.customStyleName || '';
      if (descEl) descEl.value = this.settings.customStyleTheme || '';
    }
  }

  populateDefaultStyleOptions() {
    const styleSelect = document.getElementById('default-style');
    if (!styleSelect) return;
    const baseOptions = [
      ['default', 'Default (Classic Comic)'],
      ['noir', 'Noir (Dark & Dramatic)'],
      ['minimalist', 'Minimalist'],
      ['manga', 'Manga (Anime)'],
      ['superhero', 'Superhero'],
      ['watercolor', 'Watercolor'],
      ['pixel', 'Pixel Art']
    ];
    const currentValue = this.settings.styleId || styleSelect.value || 'default';
    styleSelect.innerHTML = '';
    baseOptions.forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      styleSelect.appendChild(opt);
    });
    (this.customStyles || []).forEach((style) => {
      if (!style || !style.id || !style.name) return;
      const opt = document.createElement('option');
      opt.value = USER_STYLE_PREFIX + style.id;
      opt.textContent = style.name;
      styleSelect.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom...';
    styleSelect.appendChild(customOpt);

    styleSelect.value = currentValue;
    if (styleSelect.value !== currentValue) {
      styleSelect.value = 'default';
    }
  }

  slugifyStyleName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'style';
  }

  async createDefaultCustomStyle() {
    const styleSelect = document.getElementById('default-style');
    const nameEl = document.getElementById('default-custom-style-name');
    const descEl = document.getElementById('default-custom-style');
    const name = (nameEl?.value || '').trim();
    const description = (descEl?.value || '').trim();
    if (!name || !description) {
      this.showToast('Enter custom style name and description', 'error');
      return;
    }

    let id = this.slugifyStyleName(name);
    let nextId = id;
    let n = 2;
    while ((this.customStyles || []).some((s) => s && s.id === nextId)) {
      nextId = `${id}-${n++}`;
    }
    id = nextId;
    const styleEntry = {
      id,
      name,
      description,
      createdAt: new Date().toISOString()
    };
    this.customStyles = [...(this.customStyles || []), styleEntry];
    await chrome.storage.local.set({ customStyles: this.customStyles });

    // Persist selected style and keep compatibility values populated for runtime/popup.
    this.settings = {
      ...this.settings,
      styleId: USER_STYLE_PREFIX + id,
      customStyleName: name,
      customStyleTheme: description
    };
    await chrome.storage.local.set({ settings: this.settings });

    this.populateDefaultStyleOptions();
    if (styleSelect) styleSelect.value = USER_STYLE_PREFIX + id;
    this.updateGeneralCustomStyleUI(); // hides custom editor because selection is no longer "custom"
    this.showToast('Custom style created', 'success');
  }

  updatePromptTemplatesUI() {
    const scopeSelect = document.getElementById('prompt-provider-scope');
    if (scopeSelect) {
      scopeSelect.value = this.activePromptProviderScope || 'openai';
    }
    const templates = this.getPromptScopeTemplates();
    const storyboardEl = document.getElementById('storyboard-template');
    const imageEl = document.getElementById('image-template');
    if (storyboardEl) storyboardEl.value = templates.storyboard || '';
    if (imageEl) imageEl.value = templates.image || '';
    this.pendingPromptLibraryPreview = null;
    this.populatePromptLibraryUI();
    this.updatePromptLibraryPreviewStatus();
    this.validatePromptTemplatesUI();
  }

  populatePromptLibraryUI() {
    const groupEl = document.getElementById('prompt-library-group');
    if (!groupEl) return;
    this.ensurePromptLibraryGroupOptions();
    const presetsMap = this.getPromptLibraryPresetsMap();
    if (!groupEl.value || !presetsMap[groupEl.value]) {
      groupEl.value = 'news';
    }
    this.populatePromptLibraryPresetUI();
  }

  getPromptLibraryPresetsMap() {
    const map = {};
    Object.keys(PROMPT_LIBRARY_PRESETS).forEach((group) => {
      map[group] = [...(PROMPT_LIBRARY_PRESETS[group] || [])];
    });
    (this.promptLibraryCustomPresets || []).forEach((entry) => {
      const normalized = this.normalizePromptLibraryEntry(entry);
      if (!normalized) return;
      const group = normalized.group;
      if (!map[group]) map[group] = [];
      const idx = map[group].findIndex((preset) => preset.id === normalized.id);
      if (idx >= 0) map[group][idx] = normalized;
      else map[group].push(normalized);
    });
    return map;
  }

  ensurePromptLibraryGroupOptions() {
    const groupEl = document.getElementById('prompt-library-group');
    if (!groupEl) return;
    const presetsMap = this.getPromptLibraryPresetsMap();
    const desiredGroups = Object.keys(presetsMap);
    const existingValues = Array.from(groupEl.options).map((option) => option.value);
    desiredGroups.forEach((group) => {
      if (existingValues.includes(group)) return;
      const option = document.createElement('option');
      option.value = group;
      option.textContent = group === 'custom'
        ? 'Custom Imports'
        : group.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
      groupEl.appendChild(option);
    });
  }

  populatePromptLibraryPresetUI() {
    const groupEl = document.getElementById('prompt-library-group');
    const presetEl = document.getElementById('prompt-library-preset');
    if (!groupEl || !presetEl) return;
    const presetsMap = this.getPromptLibraryPresetsMap();
    const group = presetsMap[groupEl.value] ? groupEl.value : 'news';
    const presets = presetsMap[group] || [];
    const previousValue = presetEl.value;
    presetEl.innerHTML = '';
    presets.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = `${preset.name} (${preset.objective})`;
      presetEl.appendChild(option);
    });
    if (presets.some((preset) => preset.id === previousValue)) {
      presetEl.value = previousValue;
    }
    this.updatePromptLibraryDescription();
  }

  getSelectedPromptLibraryPreset() {
    const groupEl = document.getElementById('prompt-library-group');
    const presetEl = document.getElementById('prompt-library-preset');
    const presetsMap = this.getPromptLibraryPresetsMap();
    const group = groupEl && presetsMap[groupEl.value] ? groupEl.value : 'news';
    const presets = presetsMap[group] || [];
    return presets.find((preset) => preset.id === (presetEl?.value || '')) || presets[0] || null;
  }

  updatePromptLibraryDescription() {
    const descriptionEl = document.getElementById('prompt-library-description');
    if (!descriptionEl) return;
    const preset = this.getSelectedPromptLibraryPreset();
    if (!preset) {
      descriptionEl.textContent = 'Choose a preset to apply structured storyboard/image templates.';
      return;
    }
    descriptionEl.textContent = `${preset.useCase} Objective: ${preset.objective}.`;
  }

  updatePromptLibraryPreviewStatus() {
    const statusEl = document.getElementById('prompt-library-preview-status');
    if (!statusEl) return;
    const pending = this.pendingPromptLibraryPreview;
    if (!pending) {
      statusEl.textContent = 'Select a preset to preview it in the editors. Approve to keep it.';
      return;
    }
    if (pending.approved) {
      statusEl.textContent = 'Preset preview approved. Save Prompt Templates to persist.';
      return;
    }
    statusEl.textContent = 'Preview only. Approve to keep changes, or cancel to restore previous templates.';
  }

  previewSelectedPromptLibraryPreset() {
    const preset = this.getSelectedPromptLibraryPreset();
    if (!preset) return;
    const storyboardEl = document.getElementById('storyboard-template');
    const imageEl = document.getElementById('image-template');
    if (!storyboardEl || !imageEl) return;

    if (!this.pendingPromptLibraryPreview || this.pendingPromptLibraryPreview.scope !== this.activePromptProviderScope) {
      this.pendingPromptLibraryPreview = {
        scope: this.activePromptProviderScope,
        originalStoryboard: storyboardEl.value,
        originalImage: imageEl.value,
        approved: false
      };
    }

    this.pendingPromptLibraryPreview.presetId = preset.id;
    this.pendingPromptLibraryPreview.approved = false;
    storyboardEl.value = preset.storyboard;
    imageEl.value = preset.image;
    this.updatePromptLibraryPreviewStatus();
    this.validatePromptTemplatesUI();
  }

  approvePromptLibraryPreview() {
    const pending = this.pendingPromptLibraryPreview;
    if (!pending || pending.scope !== this.activePromptProviderScope) {
      this.previewSelectedPromptLibraryPreset();
      return;
    }
    pending.approved = true;
    this.updatePromptLibraryPreviewStatus();
    this.validatePromptTemplatesUI();
    this.showToast('Preset preview approved. Click "Save Prompt Templates" to persist.', 'success');
  }

  cancelPromptLibraryPreview() {
    const pending = this.pendingPromptLibraryPreview;
    const storyboardEl = document.getElementById('storyboard-template');
    const imageEl = document.getElementById('image-template');
    if (pending && storyboardEl && imageEl && pending.scope === this.activePromptProviderScope) {
      storyboardEl.value = pending.originalStoryboard || '';
      imageEl.value = pending.originalImage || '';
    }
    this.pendingPromptLibraryPreview = null;
    this.updatePromptLibraryPreviewStatus();
    this.validatePromptTemplatesUI();
    this.showToast('Preset preview canceled', 'success');
  }

  normalizePromptLibraryEntry(entry, fallbackIndex = 0) {
    if (!entry || typeof entry !== 'object') return null;
    const storyboard = String(entry.storyboard || '').trim();
    const image = String(entry.image || '').trim();
    if (!storyboard || !image) return null;
    const rawGroup = String(entry.group || 'custom').trim().toLowerCase();
    const group = rawGroup.replace(/[^a-z0-9_-]+/g, '-') || 'custom';
    const idSource = String(entry.id || entry.name || `imported-${fallbackIndex + 1}`).trim().toLowerCase();
    const id = idSource.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `imported-${fallbackIndex + 1}`;
    const name = String(entry.name || id).trim();
    const objective = String(entry.objective || 'Quick Summary').trim();
    const useCase = String(entry.useCase || 'Imported prompt preset').trim();
    return {
      ...entry,
      group,
      id,
      name,
      objective,
      useCase,
      storyboard,
      image
    };
  }

  async readFileAsText(file) {
    if (!file) return '';
    if (typeof file.text === 'function') {
      return file.text();
    }
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
        reader.readAsText(file);
      } catch (error) {
        reject(error);
      }
    });
  }

  async handlePromptLibraryImportFileChange(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (!file) return;
    try {
      const jsonText = await this.readFileAsText(file);
      const parsed = JSON.parse(String(jsonText || ''));
      if (!Array.isArray(parsed)) {
        this.showToast('Prompt library import requires a JSON array', 'error');
        return;
      }
      await this.importPromptLibraryEntries(parsed);
    } catch (error) {
      this.showToast(`Failed to import prompt library: ${error?.message || String(error)}`, 'error');
    } finally {
      if (input) input.value = '';
    }
  }

  async importPromptLibraryEntries(entries) {
    const normalized = [];
    let skipped = 0;
    (entries || []).forEach((entry, index) => {
      const preset = this.normalizePromptLibraryEntry(entry, index);
      if (!preset) {
        skipped += 1;
        return;
      }
      normalized.push(preset);
    });
    if (!normalized.length) {
      this.showToast('No valid prompt presets found in import file', 'error');
      return;
    }

    const merged = new Map();
    (this.promptLibraryCustomPresets || []).forEach((preset) => {
      const normalizedPreset = this.normalizePromptLibraryEntry(preset);
      if (!normalizedPreset) return;
      merged.set(`${normalizedPreset.group}::${normalizedPreset.id}`, normalizedPreset);
    });
    normalized.forEach((preset) => {
      merged.set(`${preset.group}::${preset.id}`, preset);
    });
    this.promptLibraryCustomPresets = Array.from(merged.values());
    await chrome.storage.local.set({ promptLibraryCustomPresets: this.promptLibraryCustomPresets });
    this.populatePromptLibraryUI();
    const summary = skipped > 0
      ? `Imported ${normalized.length} prompt presets (${skipped} skipped)`
      : `Imported ${normalized.length} prompt presets`;
    this.showToast(summary, 'success');
  }

  async applyPromptLibraryPreset(applyToAllProviders = false) {
    const preset = this.getSelectedPromptLibraryPreset();
    if (!preset) {
      this.showToast('No prompt preset selected', 'error');
      return;
    }

    if (applyToAllProviders) {
      const updated = { ...this.promptTemplates };
      Object.keys(DEFAULT_PROMPT_TEMPLATES).forEach((scope) => {
        updated[scope] = {
          ...(updated[scope] || {}),
          storyboard: preset.storyboard,
          image: preset.image
        };
      });
      this.promptTemplates = updated;
      try {
        await chrome.storage.local.set({ promptTemplates: this.promptTemplates });
        this.updatePromptTemplatesUI();
        this.showToast('Prompt preset applied to all providers', 'success');
      } catch (_) {
        this.showToast('Failed to apply preset to all providers', 'error');
      }
      return;
    }

    this.previewSelectedPromptLibraryPreset();
  }

  collectPromptTemplateInputs() {
    return {
      storyboard: document.getElementById('storyboard-template')?.value || '',
      image: document.getElementById('image-template')?.value || ''
    };
  }

  validatePromptTemplates(templates) {
    const required = {
      storyboard: ['{{panel_count}}', '{{content}}'],
      image: ['{{panel_caption}}', '{{style_prompt}}']
    };
    const allowed = new Set([
      '{{source_title}}',
      '{{source_url}}',
      '{{panel_count}}',
      '{{detail_level}}',
      '{{objective}}',
      '{{objective_label}}',
      '{{objective_guidance}}',
      '{{output_language}}',
      '{{output_language_label}}',
      '{{output_language_instruction}}',
      '{{style_prompt}}',
      '{{content}}',
      '{{panel_caption}}',
      '{{panel_summary}}',
      '{{panel_index}}'
    ]);
    const messages = [];
    let hasError = false;
    ['storyboard', 'image'].forEach((key) => {
      const text = String(templates[key] || '');
      for (const token of required[key]) {
        if (!text.includes(token)) {
          hasError = true;
          messages.push(`${key}: missing required ${token}`);
        }
      }
      const found = text.match(/\{\{[^}]+\}\}/g) || [];
      const unknown = found.filter((token) => !allowed.has(token));
      if (unknown.length) {
        messages.push(`${key}: unknown placeholders ${unknown.join(', ')}`);
      }
    });
    if (!messages.length) {
      messages.push('Templates look valid for phase-1 placeholder checks.');
    }
    return { hasError, hasWarning: !hasError && messages.some((m) => m.includes('unknown placeholders')), messages };
  }

  validatePromptTemplatesUI() {
    const box = document.getElementById('prompt-template-validation');
    if (!box) return;
    const result = this.validatePromptTemplates(this.collectPromptTemplateInputs());
    box.classList.remove('ok', 'warn');
    if (!result.hasError && !result.hasWarning) box.classList.add('ok');
    if (result.hasError || result.hasWarning) box.classList.add('warn');
    box.textContent = result.messages.join(' | ');
    return result;
  }

  resetPromptTemplateField(field) {
    const templates = this.getPromptScopeTemplates(this.activePromptProviderScope);
    if (field === 'storyboard') {
      const el = document.getElementById('storyboard-template');
      if (el) el.value = DEFAULT_PROMPT_TEMPLATES[this.activePromptProviderScope]?.storyboard || templates.storyboard || '';
    }
    if (field === 'image') {
      const el = document.getElementById('image-template');
      if (el) el.value = DEFAULT_PROMPT_TEMPLATES[this.activePromptProviderScope]?.image || templates.image || '';
    }
    this.validatePromptTemplatesUI();
  }

  async savePromptTemplates() {
    const scope = DEFAULT_PROMPT_TEMPLATES[this.activePromptProviderScope] ? this.activePromptProviderScope : 'openai';
    const nextTemplates = this.collectPromptTemplateInputs();
    const validation = this.validatePromptTemplatesUI();
    if (validation?.hasError) {
      this.showToast('Prompt templates have validation errors', 'error');
      return;
    }
    if (
      this.pendingPromptLibraryPreview &&
      this.pendingPromptLibraryPreview.scope === scope &&
      !this.pendingPromptLibraryPreview.approved
    ) {
      this.showToast('Approve or cancel prompt preset preview before saving', 'error');
      return;
    }
    this.promptTemplates = {
      ...this.promptTemplates,
      [scope]: {
        ...(this.promptTemplates[scope] || {}),
        ...nextTemplates
      }
    };
    try {
      await chrome.storage.local.set({ promptTemplates: this.promptTemplates });
      this.pendingPromptLibraryPreview = null;
      this.updatePromptLibraryPreviewStatus();
      this.showToast('Prompt templates saved!', 'success');
    } catch (error) {
      this.showToast('Failed to save prompt templates', 'error');
    }
  }

  async saveGeneralSettings() {
    const styleId = document.getElementById('default-style').value;
    let customStyleName = '';
    let customStyleTheme = '';
    if (styleId === 'custom') {
      customStyleName = (document.getElementById('default-custom-style-name')?.value || '').trim();
      customStyleTheme = (document.getElementById('default-custom-style')?.value || '');
    } else if (String(styleId).startsWith(USER_STYLE_PREFIX)) {
      const style = (this.customStyles || []).find((s) => s && (USER_STYLE_PREFIX + s.id) === styleId);
      customStyleName = style?.name || '';
      customStyleTheme = style?.description || '';
    }
    
    this.settings = {
      ...this.settings,
      panelCount: parseInt(document.getElementById('default-panel-count').value),
      detailLevel: document.getElementById('default-detail').value,
      styleId: styleId,
      customStyleName: customStyleName,
      customStyleTheme: customStyleTheme,
      captionLength: document.getElementById('default-caption').value,
      outputLanguage: document.getElementById('default-language')?.value || 'en',
      autoOpenSidePanel: document.getElementById('auto-open-panel').checked,
      characterConsistency: document.getElementById('character-consistency').checked,
      debugFlag: document.getElementById('debug-flag').checked,
      imageRefusalHandling:
        (document.getElementById('image-refusal-handling-select')?.value || 'rewrite_and_retry'),
      showRewrittenBadge: document.getElementById('show-rewritten-badge')?.checked !== false,
      logRewrittenPrompts: !!document.getElementById('log-rewritten-prompts')?.checked,
      maxCacheSize: parseInt(document.getElementById('max-cache-size').value),
      historyRetention: parseInt(document.getElementById('history-retention').value),
      googleDriveAutoSave: !!document.getElementById('google-drive-auto-save')?.checked,
      otherShareTarget: (document.getElementById('other-share-target-select')?.value || 'linkedin').trim()
    };

    try {
      await chrome.storage.local.set({ settings: this.settings });
      this.showToast('Settings saved successfully!', 'success');
    } catch (error) {
      this.showToast('Failed to save settings', 'error');
    }
  }

  async validateProvider(provider, buttonEl) {
    const button = buttonEl || document.querySelector(`.validate-btn[data-provider="${provider}"]`);
    const originalLabel = button?.textContent || '';

    try {
      if (button) {
        button.disabled = true;
        button.classList.add('is-loading');
        button.textContent = 'Validating...';
      }

      if (provider === 'cloudflare') {
        await this.validateCloudflareProvider();
        this.updateProviderStatus('cloudflare', true);
        this.showToast('cloudflare credentials validated!', 'success');
        return;
      }

      const inputId = `${provider}-api-key`;
      const input = document.getElementById(inputId);
      const apiKey = input?.value?.trim();

      if (!apiKey || apiKey === '••••••••••••••••') {
        this.showToast('Please enter an API key', 'error');
        return;
      }

      if (provider === 'openai') {
        const textModel = document.getElementById('openai-text-model')?.value || this.settings.textModel || 'gpt-4o-mini';
        const remote = await chrome.runtime.sendMessage({
          type: 'VALIDATE_PROVIDER_REMOTE',
          payload: {
            providerId: 'openai',
            apiKey,
            textModel
          }
        });
        if (!remote || remote.success === false) {
          throw new Error(remote?.error || 'OpenAI remote validation failed');
        }
      }

      // Store the API key
      const { apiKeys, providerValidation } = await chrome.storage.local.get(['apiKeys', 'providerValidation']);
      await chrome.storage.local.set({
        apiKeys: { ...apiKeys, [provider]: apiKey },
        providerValidation: {
          ...(providerValidation || {}),
          [provider]: {
            valid: true,
            validatedAt: new Date().toISOString()
          }
        }
      });

      this.updateProviderStatus(provider, true);
      this.showToast(`${provider} API key validated!`, 'success');
    } catch (error) {
      this.showToast(error?.message || `Failed to validate ${provider}`, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('is-loading');
        button.textContent = originalLabel || 'Validate';
      }
    }
  }

  async validateCloudflareProvider() {
    const accountId = (document.getElementById('cloudflare-account-id')?.value || '').trim();
    const tokenInput = (document.getElementById('cloudflare-api-token')?.value || '').trim();
    const email = (document.getElementById('cloudflare-email')?.value || '').trim();
    const apiKeyInput = (document.getElementById('cloudflare-api-key')?.value || '').trim();

    if (!accountId) {
      this.showToast('Please enter Cloudflare Account ID', 'error');
      throw new Error('Missing Cloudflare Account ID');
    }

    const useToken = !!tokenInput && tokenInput !== '••••••••••••••••';
    const useGlobalKey = !!email && !!apiKeyInput && apiKeyInput !== '••••••••••••••••';
    if (!useToken && !useGlobalKey) {
      this.showToast('Enter Cloudflare API Token (recommended) or Email + Global API Key', 'error');
      throw new Error('Missing Cloudflare credentials');
    }

    const { cloudflareConfig: prevConfig, cloudflare: legacyCloudflare, apiKeys, providerValidation } =
      await chrome.storage.local.get(['cloudflareConfig', 'cloudflare', 'apiKeys', 'providerValidation']);
    const previous = (prevConfig && typeof prevConfig === 'object')
      ? prevConfig
      : ((legacyCloudflare && typeof legacyCloudflare === 'object') ? legacyCloudflare : {});

    const nextConfig = {
      ...previous,
      accountId
    };

    if (useToken) {
      nextConfig.apiToken = tokenInput;
    }
    if (email) {
      nextConfig.email = email;
    }
    if (useGlobalKey) {
      nextConfig.apiKey = apiKeyInput;
    }

    await chrome.storage.local.set({
      cloudflareConfig: nextConfig,
      cloudflare: nextConfig,
      apiKeys: {
        ...(apiKeys || {}),
        ...(nextConfig.apiToken ? { cloudflare: nextConfig.apiToken } : {})
      },
      providerValidation: {
        ...(providerValidation || {}),
        cloudflare: {
          valid: true,
          validatedAt: new Date().toISOString()
        }
      }
    });
  }

  getProviderModelSelection(providerId, mode) {
    const kind = mode === 'image' ? 'image' : 'text';
    if (providerId === 'openai') {
      return kind === 'text'
        ? (document.getElementById('openai-text-model')?.value || this.settings.textModel)
        : (document.getElementById('openai-image-model')?.value || this.settings.imageModel);
    }
    if (providerId === 'gemini-free') {
      return kind === 'text'
        ? (document.getElementById('gemini-text-model')?.value || this.settings.geminiTextModel)
        : (document.getElementById('gemini-image-model')?.value || this.settings.geminiImageModel);
    }
    if (providerId === 'cloudflare-free') {
      return kind === 'text'
        ? (document.getElementById('cloudflare-text-model')?.value || this.settings.cloudflareTextModel)
        : (document.getElementById('cloudflare-image-model')?.value || this.settings.cloudflareImageModel);
    }
    if (providerId === 'openrouter') {
      if (mode === 'image') {
        return document.getElementById('openrouter-image-model')?.value || this.settings.openrouterImageModel;
      }
      return document.getElementById('openrouter-text-model')?.value || this.settings.openrouterTextModel;
    }
    if (providerId === 'huggingface') {
      if (mode === 'image') {
        return document.getElementById('huggingface-image-model')?.value || this.settings.huggingfaceImageModel;
      }
      return document.getElementById('huggingface-text-model')?.value || this.settings.huggingfaceTextModel;
    }
    return '';
  }

  async testProviderModel(providerId, mode, buttonEl) {
    const selectedModel = this.getProviderModelSelection(providerId, mode);
    if (!selectedModel) {
      this.setModelTestStatus(buttonEl, providerId, mode, 'error', 'No model selected');
      this.showToast('No model selected to test', 'error');
      return;
    }
    const button = buttonEl || document.querySelector(`.test-model-btn[data-provider="${providerId}"][data-mode="${mode}"]`);
    const originalLabel = button?.textContent || '';
    try {
      if (button) {
        button.disabled = true;
        button.classList.add('is-loading');
        button.textContent = 'Testing...';
      }
      this.setModelTestStatus(button, providerId, mode, 'pending', 'Testing model...');
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_PROVIDER_MODEL',
        payload: {
          providerId,
          mode: mode === 'image' ? 'image' : 'text',
          model: selectedModel
        }
      });
      if (!response || response.success === false) {
        throw new Error(response?.error || 'Model test failed');
      }
      const result = response.result || {};
      const actualModel = result.providerMetadata && result.providerMetadata.model
        ? String(result.providerMetadata.model)
        : '';
      let detail = result.summary ? ` (${result.summary})` : '';
      if (actualModel && actualModel !== selectedModel) {
        detail += `${detail ? ' ' : ' ('}Actual model used: ${actualModel}${detail ? '' : ')'}`;
      }
      this.setModelTestStatus(button, providerId, mode, 'success', `It's working!${detail}`);
      this.showToast(`${providerId} ${mode} model test passed`, 'success');
    } catch (error) {
      const errorText = this.classifyProviderModelTestError(providerId, mode, error);
      this.setModelTestStatus(button, providerId, mode, 'error', `Error: ${errorText}`);
      this.showToast(`${providerId} ${mode} model test failed`, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('is-loading');
        button.textContent = originalLabel || 'Test Model';
      }
    }
  }

  classifyProviderModelTestError(providerId, mode, error) {
    const raw = error?.message || String(error) || 'Model test failed';
    const normalized = String(raw);
    const lower = normalized.toLowerCase();

    if (providerId === 'openai') {
      if (/(insufficient_quota|quota|billing|budget)/i.test(normalized)) {
        return 'OpenAI quota/billing issue for this key/project. The key may be valid, but this model request cannot run.';
      }
      if (/(does not have access to model|model .*not found|unknown model|unsupported model|not available)/i.test(normalized)) {
        return 'This OpenAI key/project does not have access to the selected model. Try another model (for example gpt-4o-mini or dall-e-3).';
      }
      if (/(api key|unauthorized|401|invalid_api_key|incorrect api key)/i.test(normalized)) {
        return 'OpenAI key appears invalid for model requests (the token may have changed or belong to a different project).';
      }
      if (mode === 'image' && /content policy|safety|moderation|blocked/.test(lower)) {
        return 'Image prompt was blocked by provider safety/content policy during the model test.';
      }
    }

    return normalized;
  }

  updateProviderStatus(provider, valid) {
    const statusEl = document.getElementById(`${provider}-status`);
    if (statusEl) {
      const indicator = statusEl.querySelector('.status-indicator');
      const text = statusEl.querySelector('span:last-child');
      if (indicator) indicator.classList.toggle('ready', valid);
        if (text) text.textContent = valid ? 'Configured' : 'Configured (not validated)';
    }
  }

  async saveProvidersSettings() {
    const imageModel = document.getElementById('openai-image-model')?.value || this.settings.imageModel;
    const openaiImageQuality = document.getElementById('openai-image-quality')?.value || this.settings.openaiImageQuality;
    const openaiImageSize = document.getElementById('openai-image-size')?.value || this.settings.openaiImageSize;

    this.settings = {
      ...this.settings,
      textModel: document.getElementById('openai-text-model')?.value || this.settings.textModel,
      imageModel: imageModel,
      geminiTextModel: document.getElementById('gemini-text-model')?.value || this.settings.geminiTextModel,
      geminiImageModel: document.getElementById('gemini-image-model')?.value || this.settings.geminiImageModel,
      cloudflareTextModel: document.getElementById('cloudflare-text-model')?.value || this.settings.cloudflareTextModel,
      cloudflareImageModel: document.getElementById('cloudflare-image-model')?.value || this.settings.cloudflareImageModel,
      openrouterTextModel: document.getElementById('openrouter-text-model')?.value || this.settings.openrouterTextModel,
      openrouterImageModel: document.getElementById('openrouter-image-model')?.value || this.settings.openrouterImageModel,
      openrouterImageSize: document.getElementById('openrouter-image-size')?.value || this.settings.openrouterImageSize,
      huggingfaceTextModel: document.getElementById('huggingface-text-model')?.value || this.settings.huggingfaceTextModel,
      huggingfaceImageModel: document.getElementById('huggingface-image-model')?.value || this.settings.huggingfaceImageModel,
      huggingfaceImageSize: document.getElementById('huggingface-image-size')?.value || this.settings.huggingfaceImageSize,
      huggingfaceImageQuality: document.getElementById('huggingface-image-quality')?.value || this.settings.huggingfaceImageQuality,
      openaiImageSize: this.normalizeOpenAIImageSize(imageModel, openaiImageSize),
      openaiImageQuality: this.normalizeOpenAIImageQuality(imageModel, openaiImageQuality)
    };

    try {
      await chrome.storage.local.set({ settings: this.settings });
      this.showToast('Provider settings saved!', 'success');
    } catch (error) {
      this.showToast('Failed to save provider settings', 'error');
    }
  }

  normalizeOpenAIImageSize(imageModel, size) {
    const model = imageModel || 'dall-e-2';
    const requested = size || '256x256';
    if (model === 'dall-e-2') {
      const allowed = ['256x256', '512x512', '1024x1024'];
      return allowed.includes(requested) ? requested : '256x256';
    }
    const allowed = ['1024x1024', '1024x1792', '1792x1024'];
    return allowed.includes(requested) ? requested : '1024x1024';
  }

  normalizeOpenAIImageQuality(imageModel, quality) {
    const model = imageModel || 'dall-e-2';
    if (model !== 'dall-e-3') {
      return 'standard';
    }
    return quality === 'hd' ? 'hd' : 'standard';
  }

  async clearHistory() {
    if (confirm('Are you sure you want to clear all comic history?')) {
      await chrome.storage.local.set({ history: [] });
      await this.loadStorageInfo();
      this.showToast('History cleared!', 'success');
    }
  }

  async clearCache() {
    if (confirm('Are you sure you want to clear the image cache?')) {
      // TODO: Implement cache clearing
      this.showToast('Cache cleared!', 'success');
    }
  }

  async exportData() {
    try {
      const data = await chrome.storage.local.get(null);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `web2comics-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      this.showToast('Data exported!', 'success');
    } catch (error) {
      this.showToast('Failed to export data', 'error');
    }
  }

  async exportDebugLogs() {
    try {
      const { debugLogs } = await chrome.storage.local.get('debugLogs');
      const payload = {
        exported_at: new Date().toISOString(),
        count: Array.isArray(debugLogs) ? debugLogs.length : 0,
        logs: Array.isArray(debugLogs) ? debugLogs : []
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `web2comics-debug-logs-${new Date().toISOString().split('T')[0]}.json`;
      a.click();

      URL.revokeObjectURL(url);
      this.showToast('Debug logs exported!', 'success');
    } catch (error) {
      this.showToast('Failed to export debug logs', 'error');
    }
  }

  async saveConnectionSettings(options = {}) {
    const silent = !!options.silent;
    this.settings = {
      ...this.settings,
      googleDriveAutoSave: !!document.getElementById('google-drive-auto-save')?.checked,
      otherShareTarget: (document.getElementById('other-share-target-select')?.value || 'linkedin').trim()
    };
    try {
      await chrome.storage.local.set({ settings: this.settings });
      if (!silent) this.showToast('Connection settings saved!', 'success');
      await this.refreshAllConnectionStatuses();
    } catch (error) {
      this.showToast('Failed to save connection settings', 'error');
    }
  }

  async saveDriveSettings() {
    return this.saveConnectionSettings({ silent: false });
  }

  async persistConnectionState(key, connected) {
    this.connectionStates = {
      ...(this.connectionStates || {}),
      [key]: !!connected
    };
    await chrome.storage.local.set({ connectionStates: this.connectionStates });
  }

  getConnectionState(key) {
    return !!(this.connectionStates && this.connectionStates[key]);
  }

  openAuthorizationAuthentication(url) {
    if (!url) return;
    try {
      chrome.tabs?.create?.({ url });
    } catch (_) {}
  }

  async connectGoogleDrive() {
    try {
      await this.saveConnectionSettings({ silent: true });
      const response = await chrome.runtime.sendMessage({ type: 'GOOGLE_DRIVE_CONNECT' });
      if (!response || response.success === false) {
        throw new Error(response?.error || 'Google Drive connection failed');
      }
      await this.refreshAllConnectionStatuses();
      this.showToast('Google Drive connected', 'success');
    } catch (error) {
      this.showToast(error?.message || 'Failed to connect Google Drive', 'error');
    }
  }

  async disconnectGoogleDrive() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GOOGLE_DRIVE_DISCONNECT' });
      if (!response || response.success === false) {
        throw new Error(response?.error || 'Disconnect failed');
      }
      await this.refreshAllConnectionStatuses();
      this.showToast('Google Drive disconnected', 'success');
    } catch (error) {
      this.showToast(error?.message || 'Failed to disconnect Google Drive', 'error');
    }
  }

  async refreshGoogleDriveStatus() {
    const statusEl = document.getElementById('google-drive-connection-status');
    const autoSaveItemEl = document.getElementById('google-drive-auto-save-item');
    const autoSaveEl = document.getElementById('google-drive-auto-save');
    if (!statusEl) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GOOGLE_DRIVE_GET_STATUS' });
      const hasClientId = response?.status?.hasClientId !== false;
      const connected = !!(response && response.success !== false && response.status && response.status.connected);
      statusEl.textContent = hasClientId ? (connected ? 'Connected' : 'Not connected') : 'OAuth app not configured';
      statusEl.classList.toggle('connected', connected);
      statusEl.classList.toggle('disconnected', !connected);
      this.updateConnectionActionButtons('connect-google-drive-btn', 'disconnect-google-drive-btn', connected, hasClientId);
      if (autoSaveItemEl) {
        autoSaveItemEl.style.display = connected ? '' : 'none';
      }
      if (autoSaveEl) {
        autoSaveEl.disabled = !connected || !hasClientId;
        if (!connected) autoSaveEl.checked = false;
      }
    } catch (_) {
      statusEl.textContent = 'Status unavailable';
      statusEl.classList.remove('connected');
      statusEl.classList.add('disconnected');
      this.updateConnectionActionButtons('connect-google-drive-btn', 'disconnect-google-drive-btn', false, false);
      if (autoSaveItemEl) {
        autoSaveItemEl.style.display = 'none';
      }
      if (autoSaveEl) {
        autoSaveEl.disabled = true;
        autoSaveEl.checked = false;
      }
    }
  }

  async connectFacebook() {
    try {
      await this.saveConnectionSettings({ silent: true });
      const response = await chrome.runtime.sendMessage({ type: 'FACEBOOK_CONNECT' });
      if (!response || response.success === false) {
        throw new Error(response?.error || 'Facebook connection failed');
      }
      await this.refreshAllConnectionStatuses();
      this.showToast('Facebook connected', 'success');
    } catch (error) {
      this.showToast(error?.message || 'Failed to connect Facebook', 'error');
    }
  }

  async disconnectFacebook() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'FACEBOOK_DISCONNECT' });
      if (!response || response.success === false) {
        throw new Error(response?.error || 'Disconnect failed');
      }
      await this.refreshAllConnectionStatuses();
      this.showToast('Facebook disconnected', 'success');
    } catch (error) {
      this.showToast(error?.message || 'Failed to disconnect Facebook', 'error');
    }
  }

  async refreshFacebookStatus() {
    const statusEl = document.getElementById('facebook-connection-status');
    if (!statusEl) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'FACEBOOK_GET_STATUS' });
      const hasAppId = response?.status?.hasAppId !== false;
      const connected = !!(response && response.success !== false && response.status && response.status.connected);
      statusEl.textContent = hasAppId ? (connected ? 'Connected' : 'Not connected') : 'OAuth app not configured';
      statusEl.classList.toggle('connected', connected);
      statusEl.classList.toggle('disconnected', !connected);
      this.updateConnectionActionButtons('connect-facebook-btn', 'disconnect-facebook-btn', connected, hasAppId);
    } catch (_) {
      statusEl.textContent = 'Status unavailable';
      statusEl.classList.remove('connected');
      statusEl.classList.add('disconnected');
      this.updateConnectionActionButtons('connect-facebook-btn', 'disconnect-facebook-btn', false, false);
    }
  }

  async connectX() {
    try {
      await this.saveConnectionSettings({ silent: true });
      const response = await chrome.runtime.sendMessage({ type: 'X_CONNECT' });
      if (!response || response.success === false) {
        throw new Error(response?.error || 'X connection failed');
      }
      await this.refreshAllConnectionStatuses();
      this.showToast('X connected', 'success');
    } catch (error) {
      this.showToast(error?.message || 'Failed to connect X', 'error');
    }
  }

  async disconnectX() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'X_DISCONNECT' });
      if (!response || response.success === false) {
        throw new Error(response?.error || 'Disconnect failed');
      }
      await this.refreshAllConnectionStatuses();
      this.showToast('X disconnected', 'success');
    } catch (error) {
      this.showToast(error?.message || 'Failed to disconnect X', 'error');
    }
  }

  async refreshXStatus() {
    const statusEl = document.getElementById('x-connection-status');
    if (!statusEl) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'X_GET_STATUS' });
      const hasClientId = response?.status?.hasClientId !== false;
      const connected = !!(response && response.success !== false && response.status && response.status.connected);
      statusEl.textContent = hasClientId ? (connected ? 'Connected' : 'Not connected') : 'OAuth app not configured';
      statusEl.classList.toggle('connected', connected);
      statusEl.classList.toggle('disconnected', !connected);
      this.updateConnectionActionButtons('connect-x-btn', 'disconnect-x-btn', connected, hasClientId);
    } catch (_) {
      statusEl.textContent = 'Status unavailable';
      statusEl.classList.remove('connected');
      statusEl.classList.add('disconnected');
      this.updateConnectionActionButtons('connect-x-btn', 'disconnect-x-btn', false, false);
    }
  }

  async connectInstagram() {
    try {
      this.openAuthorizationAuthentication(AUTHORIZATION_URLS.instagram);
      await this.persistConnectionState('instagram', true);
      await this.refreshInstagramStatus();
      this.showToast('Instagram authorization started', 'success');
    } catch (error) {
      this.showToast(error?.message || 'Failed to connect Instagram', 'error');
    }
  }

  async disconnectInstagram() {
    try {
      await this.persistConnectionState('instagram', false);
      await this.refreshInstagramStatus();
      this.showToast('Instagram disconnected', 'success');
    } catch (error) {
      this.showToast(error?.message || 'Failed to disconnect Instagram', 'error');
    }
  }

  async refreshInstagramStatus() {
    const statusEl = document.getElementById('instagram-connection-status');
    if (!statusEl) return;
    const connected = this.getConnectionState('instagram');
    statusEl.textContent = connected ? 'Connected' : 'Not connected';
    statusEl.classList.toggle('connected', connected);
    statusEl.classList.toggle('disconnected', !connected);
    this.updateConnectionActionButtons('connect-instagram-btn', 'disconnect-instagram-btn', connected, true);
  }

  getSelectedOtherShareTarget() {
    return (document.getElementById('other-share-target-select')?.value || 'linkedin').trim().toLowerCase();
  }

  async connectOtherShareTarget() {
    const target = this.getSelectedOtherShareTarget();
    try {
      await this.saveConnectionSettings({ silent: true });
      this.openAuthorizationAuthentication(AUTHORIZATION_URLS[target] || AUTHORIZATION_URLS.linkedin);
      await this.persistConnectionState(`otherShare:${target}`, true);
      await this.refreshOtherShareTargetStatus();
      this.showToast(`${target} authorization started`, 'success');
    } catch (error) {
      this.showToast(error?.message || 'Failed to connect share target', 'error');
    }
  }

  async disconnectOtherShareTarget() {
    const target = this.getSelectedOtherShareTarget();
    try {
      await this.persistConnectionState(`otherShare:${target}`, false);
      await this.refreshOtherShareTargetStatus();
      this.showToast(`${target} disconnected`, 'success');
    } catch (error) {
      this.showToast(error?.message || 'Failed to disconnect share target', 'error');
    }
  }

  async refreshOtherShareTargetStatus() {
    const statusEl = document.getElementById('other-share-connection-status');
    if (!statusEl) return;
    const target = this.getSelectedOtherShareTarget();
    const connected = this.getConnectionState(`otherShare:${target}`);
    statusEl.textContent = connected ? `Connected (${target})` : `Not connected (${target})`;
    statusEl.classList.toggle('connected', connected);
    statusEl.classList.toggle('disconnected', !connected);
    this.updateConnectionActionButtons('connect-other-share-btn', 'disconnect-other-share-btn', connected, true);
  }

  updateConnectionActionButtons(connectBtnId, disconnectBtnId, connected, available = true) {
    const connectBtn = document.getElementById(connectBtnId);
    const disconnectBtn = document.getElementById(disconnectBtnId);
    if (!connectBtn || !disconnectBtn) return;
    const isAvailable = Boolean(available);
    if (!isAvailable) {
      connectBtn.disabled = true;
      connectBtn.classList.remove('hidden');
      disconnectBtn.classList.add('hidden');
      disconnectBtn.disabled = true;
      return;
    }
    connectBtn.disabled = false;
    connectBtn.classList.toggle('hidden', Boolean(connected));
    disconnectBtn.disabled = !connected;
    disconnectBtn.classList.toggle('hidden', !connected);
  }

  async refreshAllConnectionStatuses() {
    await Promise.all([
      this.refreshGoogleDriveStatus(),
      this.refreshFacebookStatus(),
      this.refreshXStatus(),
      this.refreshInstagramStatus(),
      this.refreshOtherShareTargetStatus()
    ]);
  }

  showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const messageEl = document.getElementById('toast-message');
    
    messageEl.textContent = message;
    toast.className = `toast ${type}`;
    if (type === 'error') {
      void this.appendDebugLog('ui.toast.error', { message: String(message || '') });
    }
    
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const controller = new OptionsController();
  try {
    window.__optionsController = controller;
  } catch (_) {}
});
