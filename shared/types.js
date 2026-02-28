// Shared type definitions for Web to Comic extension

// ============ Storyboard Types ============

export const STORYBOARD_SCHEMA_VERSION = '1.0';

export interface SourceInfo {
  url: string;
  title?: string;
  extracted_at: string;
  content_hash?: string;
}

export interface StoryboardSettings {
  panel_count: number;
  objective?: 'summarize' | 'fun' | 'learn-step-by-step' | 'news-recap' | 'timeline' | 'key-facts' | 'compare-views' | 'explain-like-im-five' | 'study-guide' | 'meeting-recap' | 'how-to-guide' | 'debate-map';
  detail_level: 'low' | 'medium' | 'high';
  style_id: string;
  caption_len: 'short' | 'medium' | 'long';
  provider_text: string;
  provider_image: string;
  character_consistency?: boolean;
  custom_style_theme?: string;
}

export interface Character {
  character_id: string;
  name: string;
  description: string;
  first_appearance_panel?: string;
}

export interface PanelComposition {
  shot_type?: 'close-up' | 'medium' | 'wide' | 'extreme-wide' | 'over-shoulder' | 'POV';
  angle?: 'eye-level' | 'low-angle' | 'high-angle' | "bird's-eye" | "worm's-eye";
}

export interface PanelArtifacts {
  image_blob_ref?: string;
  provider_metadata?: Record<string, unknown>;
}

export interface Panel {
  panel_id: string;
  beat_summary: string;
  caption: string;
  image_prompt: string;
  negative_prompt?: string;
  characters?: Character[];
  composition?: PanelComposition;
  artifacts?: PanelArtifacts;
}

export interface StyleProfile {
  art_style?: string;
  color_palette?: string;
  mood?: string;
}

export interface StoryboardStatus {
  overall: 'pending' | 'generating_text' | 'generating_images' | 'completed' | 'failed' | 'canceled';
  text_completed?: boolean;
  images_completed?: number;
  total_panels?: number;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
}

export interface Storyboard {
  schema_version: string;
  source: SourceInfo;
  settings: StoryboardSettings;
  panels: Panel[];
  style_profile?: StyleProfile;
  safety_tags?: string[];
  status: StoryboardStatus;
}

// ============ Provider Types ============

export interface ProviderCapabilities {
  supportsImages: boolean;
  maxPromptLength: number;
  rateLimitBehavior: 'strict' | 'graceful' | 'none';
  costTag: 'free' | 'limited' | 'paid';
}

export interface ProviderConfig {
  apiKey?: string;
  modelName?: string;
  endpointUrl?: string;
  customHeaders?: Record<string, string>;
}

export interface Provider {
  id: string;
  name: string;
  type: 'gemini' | 'cloudflare-workers-ai' | 'openai-compatible' | 'chrome-summarizer';
  capabilities: ProviderCapabilities;
  config: ProviderConfig;
}

export interface SummarizationOptions {
  panelCount: number;
  objective?: 'summarize' | 'fun' | 'learn-step-by-step' | 'news-recap' | 'timeline' | 'key-facts' | 'compare-views' | 'explain-like-im-five' | 'study-guide' | 'meeting-recap' | 'how-to-guide' | 'debate-map';
  detailLevel: 'low' | 'medium' | 'high';
  styleId: string;
  captionLength: 'short' | 'medium' | 'long';
  characterConsistency?: boolean;
}

export interface ImageOptions {
  negativePrompt?: string;
  width?: number;
  height?: number;
  style?: string;
}

export interface ImageResult {
  imageData: string; // base64
  providerMetadata?: Record<string, unknown>;
}

// ============ Extension Settings Types ============

export interface ExtensionSettings {
  panelCount: number;
  objective?: 'summarize' | 'fun' | 'learn-step-by-step' | 'news-recap' | 'timeline' | 'key-facts' | 'compare-views' | 'explain-like-im-five' | 'study-guide' | 'meeting-recap' | 'how-to-guide' | 'debate-map';
  detailLevel: 'low' | 'medium' | 'high';
  styleId: string;
  captionLength: 'short' | 'medium' | 'long';
  activeTextProvider: string;
  activeImageProvider: string;
  characterConsistency: boolean;
  maxCacheSize: number;
  autoOpenSidePanel: boolean;
  textModel?: string;
  imageModel?: string;
  customStyleTheme?: string;
}

export interface ProvidersConfig {
  providers: Provider[];
  activeTextProvider: string;
  activeImageProvider: string;
}

// ============ Comic History Types ============

export interface ComicHistoryEntry {
  id: string;
  source: {
    url: string;
    title: string;
  };
  generated_at: string;
  settings_snapshot: StoryboardSettings;
  storyboard: Storyboard;
  thumbnail?: string;
}

// ============ Generation Job Types ============

export interface GenerationJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
  sourceUrl: string;
  sourceTitle: string;
  extractedText: string;
  settings: StoryboardSettings;
  storyboard?: Storyboard;
  currentPanelIndex: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

// ============ Message Types ============

export type MessageType = 
  | 'EXTRACT_CONTENT'
  | 'EXTRACT_CONTENT_RESULT'
  | 'START_GENERATION'
  | 'GENERATION_PROGRESS'
  | 'GENERATION_COMPLETE'
  | 'GENERATION_ERROR'
  | 'CANCEL_GENERATION'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS'
  | 'GET_PROVIDERS'
  | 'SAVE_PROVIDERS'
  | 'VALIDATE_API_KEY'
  | 'GET_HISTORY'
  | 'DELETE_HISTORY'
  | 'CLEAR_HISTORY'
  | 'OPEN_SIDE_PANEL';

export interface ExtensionMessage {
  type: MessageType;
  payload?: unknown;
}

// ============ Style Presets ============

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  artStyle: string;
  colorPalette?: string;
  mood?: string;
}

export const DEFAULT_STYLE_PRESETS: StylePreset[] = [
  { id: 'default', name: 'Default', description: 'Classic comic book style', artStyle: 'classic comic' },
  { id: 'noir', name: 'Noir', description: 'Dark, dramatic black and white', artStyle: 'film noir' },
  { id: 'minimalist', name: 'Minimalist', description: 'Clean, simple lines', artStyle: 'minimalist illustration' },
  { id: 'manga', name: 'Manga', description: 'Japanese anime style', artStyle: 'manga anime' },
  { id: 'superhero', name: 'Superhero', description: 'Bold comic book action', artStyle: 'american comic superhero' },
  { id: 'watercolor', name: 'Watercolor', description: 'Soft painted look', artStyle: 'watercolor painting' },
  { id: 'pixel', name: 'Pixel Art', description: 'Retro pixel art style', artStyle: 'pixel art' }
];

// ============ Default Settings ============

export const DEFAULT_SETTINGS: ExtensionSettings = {
  panelCount: 3,
  objective: 'summarize',
  detailLevel: 'low',
  styleId: 'default',
  captionLength: 'short',
  activeTextProvider: 'gemini-free',
  activeImageProvider: 'gemini-free',
  characterConsistency: false,
  maxCacheSize: 100,
  autoOpenSidePanel: true
};

// ============ Error Codes ============

export const ERROR_CODES = {
  EXTRACTION_ERROR: 'E001',
  SUMMARIZATION_ERROR: 'E002',
  IMAGE_GENERATION_ERROR: 'E003',
  RATE_LIMIT_EXCEEDED: 'E004',
  INVALID_CREDENTIALS: 'E005',
  NETWORK_ERROR: 'E006',
  STORAGE_ERROR: 'E007',
  UNKNOWN_ERROR: 'E999'
} as const;

// ============ OpenAI Provider Models ============

export const OPENAI_TEXT_MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, supportsVision: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, supportsVision: true },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000, supportsVision: true },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', contextWindow: 16385, supportsVision: false }
];

export const OPENAI_IMAGE_MODELS = [
  { id: 'dall-e-3', name: 'DALL-E 3', resolution: '1024x1024', quality: 'standard' },
  { id: 'dall-e-2', name: 'DALL-E 2', resolution: '1024x1024', quality: 'standard' }
];

export const GEMINI_TEXT_MODELS = [
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1000000, supportsImages: true },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', contextWindow: 1000000, supportsImages: true },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', contextWindow: 2000000, supportsImages: true },
  { id: 'gemini-1.0-pro', name: 'Gemini 1.0 Pro', contextWindow: 32000, supportsImages: false }
];

export const CLOUDFLARE_TEXT_MODELS = [
  { id: '@cf/meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', contextWindow: 128000 },
  { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', contextWindow: 128000 },
  { id: '@cf/meta/llama-3-8b-instruct', name: 'Llama 3 8B', contextWindow: 128000 },
  { id: '@cf/mistral/mistral-7b-instruct-v0.1', name: 'Mistral 7B', contextWindow: 32000 }
];
