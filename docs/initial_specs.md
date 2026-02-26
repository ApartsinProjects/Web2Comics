# Software Requirements Specification (SRS)

## Product: Chrome Extension — Web Page → Comic Strip Summary

| Document Information | Details |
|----------------------|---------|
| **Version** | 1.0 |
| **Status** | Draft |
| **Platform** | Google Chrome Extension (Manifest V3) |
| **Document Type** | Software Requirements Specification |
| **Last Updated** | 2026-02-24 |

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Scope](#2-scope)
3. [Definitions](#3-definitions)
4. [References](#4-references)
5. [Users, Personas, and Primary Use Cases](#5-users-personas-and-primary-use-cases)
6. [Product Overview and Operating Environment](#6-product-overview-and-operating-environment)
7. [Functional Requirements](#7-functional-requirements)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Data Models](#9-data-models)
10. [Configuration Requirements](#10-configuration-requirements)
11. [Free / Low-Cost Model Set](#11-free--low-cost-model-set)
12. [Error Handling & User Feedback](#12-error-handling--user-feedback)
13. [Permissions](#13-permissions)
14. [Acceptance Criteria](#14-acceptance-criteria-v1)
15. [Recommended Implementation Notes](#15-recommended-implementation-notes)

---

## 1. Purpose

### 1.1 Product Purpose

Provide a Chrome extension that summarizes the current web page and renders the summary as a **comic strip** (a sequence of images with short captions). The extension enables users to convert any web page into an engaging visual narrative.

### 1.2 Objectives

- Extract readable content from any web page
- Generate structured narrative summaries organized as comic panels
- Produce per-panel image prompts with accompanying captions
- Render comic strips progressively as panels are generated
- Support configurable text-generation and image-generation providers
- Prioritize Google-first options and free/low-cost alternatives

### 1.3 Target Audience

- Casual readers seeking quick visual summaries of web content
- Power users who want detailed control over generation parameters
- Privacy-conscious users requiring transparency about data handling

---

## 2. Scope

### 2.1 In-Scope Features

| Feature ID | Feature Description | Priority |
|------------|---------------------|----------|
| F001 | Extract readable page content (user-selected or full page) | Must Have |
| F002 | Generate structured narrative summary (panel-by-panel) | Must Have |
| F003 | Generate per-panel image prompts with short captions | Must Have |
| F004 | Call image-generation provider to produce panels | Must Have |
| F005 | Display comic strip UI with progressive panel rendering | Must Have |
| F006 | Model/provider configuration UI with presets | Must Have |
| F007 | Support for free/low-cost model options | Should Have |
| F008 | Character consistency mode across panels | Should Have |
| F009 | Export comic strip (PNG/PDF) | Could Have |
| F010 | Local history storage of generated comics | Should Have |

### 2.2 Out-of-Scope Features (v1)

| Feature | Reason for Exclusion |
|---------|---------------------|
| Video/comic animation | Beyond v1 scope |
| Offline local model execution | Requires significant infrastructure |
| Automatic paywall bypass | Legal and ethical concerns |
| Publishing to non-Chrome marketplaces | Focus on Chrome Web Store |

### 2.3 Version Constraints

- **Initial Release**: Version 1.0
- **Platform Requirement**: Google Chrome (latest stable)
- **Manifest Version**: V3 (Manifest V3)

---

## 3. Definitions

### 3.1 Core Terms

| Term | Definition |
|------|------------|
| **Panel** | A single comic frame consisting of one image and its accompanying caption |
| **Prompt Recipe** | A set of parameters controlling style, detail level, character consistency, and constraints for image generation |
| **Provider** | A model endpoint source (e.g., Gemini API, Cloudflare Workers AI) that provides text summarization or image generation capabilities |
| **Progressive Rendering** | A UI pattern where panels appear sequentially as each generation task completes, rather than waiting for all panels |
| **Storyboard** | A structured JSON document containing the complete plan for a comic strip including all panels, captions, and prompts |
| **Manifest V3** | The latest Chrome extension manifest version with enhanced security and privacy features |
| **Service Worker** | A background script in MV3 extensions that handles events and can be terminated when idle |

### 3.2 Technical Terms

| Term | Definition |
|------|------------|
| **Extracted Text** | The raw text content obtained from a web page after cleaning and processing |
| **Character Descriptor** | Structured metadata describing a character's appearance for consistency across panels |
| **Negative Prompt** | Text input specifying elements to exclude from generated images |
| **Rate Limiting** | Technical controls that restrict the number of API requests within a time window |

---

## 4. References

### 4.1 Normative References

| Reference ID | Title | URL |
|--------------|-------|-----|
| [REF-001] | Chrome Extensions - Manifest V3 | https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3 |
| [REF-002] | Chrome Extensions Samples - Summarization API | https://developer.chrome.com/docs/extensions/samples |
| [REF-003] | Gemini API Pricing | https://ai.google.dev/gemini-api/docs/pricing |
| [REF-004] | Gemini API Rate Limits | https://ai.google.dev/gemini-api/docs/rate-limits |
| [REF-005] | Cloudflare Workers AI Pricing | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| [REF-006] | Chrome Extensions - What's New | https://developer.chrome.com/docs/extensions/whats-new |

### 4.2 Informative References

| Reference ID | Title | URL |
|--------------|-------|-----|
| [REF-007] | Chrome Web Store Policies | https://developer.chrome.com/docs/webstore/policies |
| [REF-008] | Chrome Storage API | https://developer.chrome.com/docs/extensions/reference/api/storage |

---

## 5. Users, Personas, and Primary Use Cases

### 5.1 User Personas

#### Persona 1: Casual Reader

| Attribute | Description |
|-----------|-------------|
| **Name** | Casual Reader |
| **Technical Skill** | Low to Medium |
| **Goals** | Get quick visual summaries of articles with minimal configuration |
| **Pain Points** | Complex setup, technical jargon, time-consuming processes |
| **Success Criteria** | One-click comic generation with acceptable quality |

#### Persona 2: Power User

| Attribute | Description |
|-----------|-------------|
| **Name** | Power User |
| **Technical Skill** | High |
| **Goals** | Fine-tune style, panel count, providers, and prompts |
| **Pain Points** | Limited customization, lack of advanced options |
| **Success Criteria** | Full control over generation pipeline |

#### Persona 3: Privacy-Conscious User

| Attribute | Description |
|-----------|-------------|
| **Name** | Privacy-Conscious User |
| **Technical Skill** | Medium |
| **Goals** | Understand what data is sent, have control over external calls |
| **Pain Points** | Unclear data handling, mandatory external requests |
| **Success Criteria** | Transparent data flow, local-only options when available |

### 5.2 Primary Use Cases

#### UC1: Generate 6-Panel Comic Summary

| Use Case ID | UC1 |
|-------------|-----|
| **Description** | Summarize current page into default 6-panel comic strip |
| **Actor** | Casual Reader |
| **Preconditions** | Extension installed, API key configured (or preset selected) |
| **Basic Flow** | 1. Navigate to article page<br>2. Click extension icon<br>3. Review extracted text preview<br>4. Click "Generate"<br>5. View progressive comic strip |
| **Postconditions** | Comic strip displayed with all 6 panels |

#### UC2: Summarize Selected Text Only

| Use Case ID | UC2 |
|-------------|-----|
| **Description** | Generate comic from user-highlighted text instead of full page |
| **Actor** | Casual Reader, Power User |
| **Preconditions** | Text selected on page before invoking extension |
| **Basic Flow** | 1. Select text on page<br>2. Click extension icon<br>3. Extension detects selection<br>4. Confirm "Selected text only" mode<br>5. Generate comic |
| **Postconditions** | Comic based solely on selected content |

#### UC3: Switch to Free Provider

| Use Case ID | UC3 |
|-------------|-----|
| **Description** | Switch provider preset to "Google Free Tier" or "Cloudflare Workers AI" |
| **Actor** | Privacy-Conscious User, Cost-Conscious User |
| **Preconditions** | None |
| **Basic Flow** | 1. Open extension settings<br>2. Navigate to Providers<br>3. Select "Google Gemini (Free tier)" or "Cloudflare Workers AI"<br>4. Save settings<br>5. Generate comic with new provider |
| **Postconditions** | Comic generated using selected free provider |

#### UC4: Adjust Style and Regenerate

| Use Case ID | UC4 |
|-------------|-----|
| **Description** | Change comic style (e.g., noir, minimalist, manga) and regenerate |
| **Actor** | Power User |
| **Preconditions** | Previous comic generated |
| **Basic Flow** | 1. Open comic viewer<br>2. Click "Settings"<br>3. Select new style preset<br>4. Click "Regenerate"<br>5. View updated comic |
| **Postconditions** | New comic generated with selected style |

#### UC5: Cancel Mid-Generation

| Use Case ID | UC5 |
|-------------|-----|
| **Description** | Cancel comic generation midway through panel creation |
| **Actor** | Any User |
| **Preconditions** | Generation in progress |
| **Basic Flow** | 1. Generation started<br>2. Click "Cancel" button<br>3. Confirm cancellation<br>4. View partial results (completed panels) |
| **Postconditions** | Partial comic displayed with completed panels only |

---

## 6. Product Overview and Operating Environment

### 6.1 Extension Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension (MV3)                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Popup     │  │  Side Panel │  │  Options Page       │  │
│  │   (UI)      │  │   (Viewer)  │  │  (Configuration)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                      Service Worker                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Content    │  │  Provider   │  │  Storage            │  │
│  │  Extraction │  │  Manager    │  │  Manager            │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    External APIs                             │
│  ┌───────────┐  ┌───────────────┐  ┌────────────────────┐   │
│  │  Gemini   │  │ Cloudflare AI │  │ Chrome Summarizer │   │
│  │  API      │  │   Workers     │  │    API (exp.)      │   │
│  └───────────┘  └───────────────┘  └────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 UI Surfaces

| Surface | Purpose | Launch Method |
|---------|---------|---------------|
| **Popup** | Quick actions, status overview | Click extension icon |
| **Side Panel** | Full comic viewer with controls | Click "Open Viewer" in popup |
| **Options Page** | Full settings and configuration | Right-click icon → Options |

### 6.3 Supported Environments

| Environment | Support Level |
|-------------|---------------|
| Google Chrome (latest stable) | Full Support |
| Chromium-based browsers | Best Effort |
| Standard HTML pages | Full Support |
| Single-Page Applications (SPA) | Basic Support |

### 6.4 Data Flow

```
[Web Page] → [Content Extraction] → [Text Preview] → [LLM Storyboard]
                                                                      ↓
                                                            [Image Prompts]
                                                                      ↓
                                                            [Image Generation]
                                                                      ↓
                                                            [Comic Viewer]
```

---

## 7. Functional Requirements

### 7.1 Installation & Onboarding

| Req ID | Requirement | Priority | Traceability |
|--------|-------------|----------|---------------|
| FR-1 | The extension shall install from Chrome Web Store and run under Manifest V3 | Must Have | [REF-001] |
| FR-2 | On first run, the extension shall show a short onboarding wizard with content scope default, provider preset selection, and data handling acknowledgment | Must Have | UC1, UC3 |
| FR-3 | The extension shall work without account creation; configuration uses local extension storage | Must Have | Privacy-Conscious User |

### 7.2 Content Acquisition (Page → Clean Text)

| Req ID | Requirement | Priority | Traceability |
|--------|-------------|----------|---------------|
| FR-4 | The extension shall support two input modes: Mode A (user selection) and Mode B (readable article extraction) | Must Have | UC2 |
| FR-5 | The extension shall present a preview of the extracted text (editable) before sending to any model | Must Have | NFR-S2 |
| FR-6 | The extension shall enforce a maximum input size and apply deterministic truncation strategy with user notification | Must Have | NFR-P2 |

### 7.3 Summarization & Storyboard Generation (Text → Panels Plan)

| Req ID | Requirement | Priority | Traceability |
|--------|-------------|----------|---------------|
| FR-7 | The extension shall generate a Storyboard JSON containing title, panels array with beat_summary, caption, image_prompt, negative_prompt, characters, scene_metadata, style_profile, and safety_tags | Must Have | Section 9 |
| FR-8 | The extension shall allow user-defined panel count (default 6; range 3-12), detail level (Low/Medium/High), style template (preset list + custom), caption length, and optional custom style/theme description | Must Have | UC4 |
| FR-8a | The extension shall allow users to enter a custom style/theme description (e.g., "vintage 1950s comic", "steampunk illustration") that is used in image generation prompts | Should Have | UC4 |
| FR-9 | The extension shall support "character consistency mode" where Panel 1 defines characters and subsequent panels reference descriptors | Should Have | F007 |

### 7.4 Image Generation (Prompts → Images)

| Req ID | Requirement | Priority | Traceability |
|--------|-------------|----------|---------------|
| FR-10 | The extension shall generate images sequentially or with bounded parallelism (configurable, default 2 concurrent) | Should Have | NFR-P3 |
| FR-11 | The extension shall show progressive results: placeholder skeletons appear immediately, each panel updates when ready, captions show immediately | Must Have | F005 |
| FR-12 | The extension shall support "retry panel" and "regenerate panel prompt" flows | Must Have | UC5 |

### 7.5 Model/Provider Configuration

| Req ID | Requirement | Priority | Traceability |
|--------|-------------|----------|---------------|
| FR-13 | The extension shall provide a "Providers" settings screen with provider type selection, model name, and authentication configuration | Must Have | Section 10 |
| FR-14 | The extension shall support Gemini API key configuration with clear display of free usage limits and rate limiting | Must Have | [REF-003], [REF-004] |
| FR-15 | The extension shall ship with built-in presets: "Google Gemini (Free tier)", "Cloudflare Workers AI (free daily neurons)", "Chrome Built-in Summarization API (experimental)" | Must Have | Section 11 |
| FR-16 | For each preset, the extension shall show cost expectations, quota/rate-limit notes, and data transmission details | Must Have | NFR-U1 |

### 7.6 Comic Viewer UX

| Req ID | Requirement | Priority | Traceability |
|--------|-------------|----------|---------------|
| FR-17 | The comic viewer shall support vertical strip layout (default), panel-by-panel view, and download/export (PNG per panel + combined strip) | Should Have | F009 |
| FR-18 | The viewer shall include "Re-run with same settings", "Edit storyboard", "Edit prompts", and "Cancel generation" controls | Must Have | UC4, UC5 |

### 7.7 History & Storage

| Req ID | Requirement | Priority | Traceability |
|--------|-------------|----------|---------------|
| FR-19 | The extension shall maintain local history of generated comics with URL, title, timestamp, settings snapshot, storyboard JSON, and panel images | Should Have | F010 |
| FR-20 | The user shall be able to delete individual comics or clear all data | Should Have | Privacy-Conscious User |

---

## 8. Non-Functional Requirements

### 8.1 Usability

| Req ID | Requirement | Target Metric |
|--------|-------------|---------------|
| NFR-U1 | Settings must be usable by non-technical users via presets | 100% of settings accessible via preset dropdowns |
| NFR-U2 | Any required credential entry must include inline validation | API key validation within 500ms of entry |
| NFR-U3 | Progressive rendering must show panel placeholders within 200ms after start | Placeholder visible < 200ms |

### 8.2 Performance

| Req ID | Requirement | Target Metric |
|--------|-------------|---------------|
| NFR-P1 | Text extraction + preview must complete within 1 second for typical articles | P95 < 1000ms |
| NFR-P2 | Summarization/storyboard generation must run asynchronously with visible progress | Progress indicator updates every 500ms |
| NFR-P3 | Image generation must allow cancellation and must not block Chrome UI thread | UI remains responsive (60fps) during generation |

### 8.3 Reliability

| Req ID | Requirement | Target Metric |
|--------|-------------|---------------|
| NFR-R1 | Handle transient provider failures with exponential backoff and per-panel retry | 3 retries with exponential backoff (1s, 2s, 4s) |
| NFR-R2 | Service worker lifecycle constraints must be handled with job persistence and resumability | Jobs survive service worker termination |

### 8.4 Privacy & Security

| Req ID | Requirement | Target Metric |
|--------|-------------|---------------|
| NFR-S1 | Default mode must not send data until user presses "Generate" | Zero network calls before user action |
| NFR-S2 | Show "data sent" preview and allow editing/redacting before sending | Text preview editable before submission |
| NFR-S3 | Store API keys only in Chrome extension storage; never log keys | Keys stored in chrome.storage.encrypted only |
| NFR-S4 | Provide "local-only mode" using Chrome's built-in summarization API when available | Experimental feature toggle in settings |

### 8.5 Compliance

| Req ID | Requirement | Target Metric |
|--------|-------------|---------------|
| NFR-C1 | Must comply with Chrome Web Store policies | Pass Chrome Web Store review |
| NFR-C2 | Must respect provider ToS and safety filters | Block disallowed content generation |

---

## 9. Data Models

### 9.1 Storyboard JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Comic Strip Storyboard",
  "version": "1.0",
  "type": "object",
  "required": ["schema_version", "source", "settings", "panels", "status"],
  "properties": {
    "schema_version": {
      "type": "string",
      "const": "1.0",
      "description": "Schema version for compatibility"
    },
    "source": {
      "type": "object",
      "required": ["url", "extracted_at"],
      "properties": {
        "url": {
          "type": "string",
          "format": "uri",
          "description": "Source page URL"
        },
        "title": {
          "type": "string",
          "description": "Source page title"
        },
        "extracted_at": {
          "type": "string",
          "format": "date-time",
          "description": "Content extraction timestamp"
        },
        "content_hash": {
          "type": "string",
          "description": "Hash of extracted content for verification"
        }
      }
    },
    "settings": {
      "type": "object",
      "required": ["panel_count", "detail_level", "style_id", "provider_text", "provider_image"],
      "properties": {
        "panel_count": {
          "type": "integer",
          "minimum": 3,
          "maximum": 12,
          "default": 6
        },
        "detail_level": {
          "type": "string",
          "enum": ["low", "medium", "high"],
          "default": "medium"
        },
        "style_id": {
          "type": "string",
          "description": "Style preset identifier"
        },
        "caption_len": {
          "type": "string",
          "enum": ["short", "medium", "long"],
          "default": "short"
        },
        "provider_text": {
          "type": "string",
          "description": "Text generation provider identifier"
        },
        "provider_image": {
          "type": "string",
          "description": "Image generation provider identifier"
        },
        "character_consistency": {
          "type": "boolean",
          "default": false,
          "description": "Enable character consistency mode"
        }
      }
    },
    "panels": {
      "type": "array",
      "minItems": 3,
      "maxItems": 12,
      "items": {
        "$ref": "#/definitions/panel"
      }
    },
    "style_profile": {
      "type": "object",
      "properties": {
        "art_style": {
          "type": "string",
          "description": "Art style (e.g., noir, minimalist, manga)"
        },
        "color_palette": {
          "type": "string",
          "description": "Color palette preference"
        },
        "mood": {
          "type": "string",
          "description": "Overall mood/tone"
        }
      }
    },
    "safety_tags": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Blocklist categories for content filtering"
    },
    "status": {
      "type": "object",
      "properties": {
        "overall": {
          "type": "string",
          "enum": ["pending", "generating_text", "generating_images", "completed", "failed", "canceled"]
        },
        "text_completed": {
          "type": "boolean"
        },
        "images_completed": {
          "type": "integer"
        },
        "total_panels": {
          "type": "integer"
        },
        "started_at": {
          "type": "string",
          "format": "date-time"
        },
        "completed_at": {
          "type": "string",
          "format": "date-time"
        }
      }
    }
  },
  "definitions": {
    "panel": {
      "type": "object",
      "required": ["panel_id", "beat_summary", "caption", "image_prompt"],
      "properties": {
        "panel_id": {
          "type": "string",
          "pattern": "^panel_[0-9]+$"
        },
        "beat_summary": {
          "type": "string",
          "minLength": 10,
          "maxLength": 300,
          "description": "1-3 sentences describing the scene"
        },
        "caption": {
          "type": "string",
          "minLength": 5,
          "maxLength": 100,
          "description": "Short caption displayed below the image"
        },
        "image_prompt": {
          "type": "string",
          "minLength": 10,
          "maxLength": 1000,
          "description": "Detailed prompt for image generation"
        },
        "negative_prompt": {
          "type": "string",
          "maxLength": 500,
          "description": "Elements to exclude from the image"
        },
        "characters": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/character"
          },
          "description": "Character descriptors for consistency"
        },
        "composition": {
          "type": "object",
          "properties": {
            "shot_type": {
              "type": "string",
              "enum": ["close-up", "medium", "wide", "extreme-wide", "over-shoulder", "POV"]
            },
            "angle": {
              "type": "string",
              "enum": ["eye-level", "low-angle", "high-angle", "bird's-eye", "worm's-eye"]
            }
          }
        },
        "artifacts": {
          "type": "object",
          "properties": {
            "image_blob_ref": {
              "type": "string",
              "description": "Reference to stored image blob"
            },
            "provider_metadata": {
              "type": "object",
              "description": "Provider-specific metadata (timing, model version, etc.)"
            }
          }
        }
      }
    },
    "character": {
      "type": "object",
      "required": ["character_id", "name", "description"],
      "properties": {
        "character_id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "description": {
          "type": "string",
          "description": "Visual description for consistency"
        },
        "first_appearance_panel": {
          "type": "string",
          "pattern": "^panel_[0-9]+$"
        }
      }
    }
  }
}
```

### 9.2 Provider Configuration Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Provider Configuration",
  "type": "object",
  "properties": {
    "providers": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/provider"
      }
    },
    "active_text_provider": {
      "type": "string",
      "description": "ID of active text generation provider"
    },
    "active_image_provider": {
      "type": "string",
      "description": "ID of active image generation provider"
    }
  },
  "definitions": {
    "provider": {
      "type": "object",
      "required": ["id", "name", "type", "capabilities"],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z0-9-_]+$"
        },
        "name": {
          "type": "string"
        },
        "type": {
          "type": "string",
          "enum": ["gemini", "cloudflare-workers-ai", "openai-compatible", "chrome-summarizer"]
        },
        "capabilities": {
          "type": "object",
          "required": ["supports_images", "max_prompt_length"],
          "properties": {
            "supports_images": {
              "type": "boolean"
            },
            "max_prompt_length": {
              "type": "integer"
            },
            "rate_limit_behavior": {
              "type": "string",
              "enum": ["strict", "graceful", "none"]
            },
            "cost_tag": {
              "type": "string",
              "enum": ["free", "limited", "paid"]
            }
          }
        },
        "config": {
          "type": "object",
          "description": "Provider-specific configuration",
          "properties": {
            "api_key": {
              "type": "string",
              "description": "Encrypted API key storage reference"
            },
            "model_name": {
              "type": "string"
            },
            "endpoint_url": {
              "type": "string",
              "format": "uri"
            }
          }
        }
      }
    }
  }
}
```

### 9.3 Comic History Entry Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Comic History Entry",
  "type": "object",
  "required": ["id", "source", "generated_at", "storyboard"],
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "source": {
      "type": "object",
      "properties": {
        "url": {
          "type": "string",
          "format": "uri"
        },
        "title": {
          "type": "string"
        }
      }
    },
    "generated_at": {
      "type": "string",
      "format": "date-time"
    },
    "settings_snapshot": {
      "type": "object",
      "description": "Copy of settings used for generation"
    },
    "storyboard": {
      "$ref": "storyboard.json"
    },
    "thumbnail": {
      "type": "string",
      "description": "Base64 thumbnail or blob reference"
    }
  }
}
```

---

## 10. Configuration Requirements

### 10.1 Settings Screens

#### 10.1.1 Quick Settings (Popup)

| Control | Type | Default | Range |
|---------|------|---------|-------|
| Panel Count | Slider/Dropdown | 6 | 3-12 |
| Detail Level | Dropdown | Medium | Low/Medium/High |
| Style Preset | Dropdown | Default | (preset list) |
| Provider Preset | Dropdown | Gemini Free | (provider list) |
| Generate Button | Button | - | - |

#### 10.1.2 Advanced Settings

| Section | Controls |
|---------|----------|
| Providers Page | Add/Edit/Remove providers, Configure credentials |
| Credential Vault | API keys/tokens (encrypted storage) |
| Quotas Display | Rate limit errors, cooldown timer, usage stats |
| Storage Management | Cache size, eviction policy configuration |

### 10.2 Provider Abstraction Interface

```typescript
interface ITextProvider {
  readonly capabilities: ProviderCapabilities;
  initialize(config: ProviderConfig): Promise<void>;
  summarize(text: string, options: SummarizationOptions): Promise<Storyboard>;
  validateCredentials(): Promise<boolean>;
}

interface IImageProvider {
  readonly capabilities: ProviderCapabilities;
  initialize(config: ProviderConfig): Promise<void>;
  generateImage(prompt: string, options: ImageOptions): Promise<ImageResult>;
  generateImageBatch(prompts: string[], options: ImageOptions): Promise<ImageResult[]>;
  validateCredentials(): Promise<boolean>;
}

interface ProviderCapabilities {
  supportsImages: boolean;
  maxPromptLength: number;
  rateLimitBehavior: 'strict' | 'graceful' | 'none';
  costTag: 'free' | 'limited' | 'paid';
}

interface ProviderConfig {
  apiKey?: string;
  modelName?: string;
  endpointUrl?: string;
  customHeaders?: Record<string, string>;
}
```

### 10.3 Requirements for Provider Implementation

| Req ID | Requirement | Priority |
|--------|-------------|----------|
| REQ-CFG1 | All providers must implement uniform interface: summarize() and generateImage() | Must Have |
| REQ-CFG2 | Providers must declare capabilities including supports_images, max_prompt_length, rate_limit_behavior, and cost_tag | Must Have |

---

## 11. Free / Low-Cost Model Set (v1 Baseline)

### 11.1 Provider Presets

#### 11.1.1 Google Gemini API

| Property | Value |
|----------|-------|
| **Provider ID** | `gemini-free` |
| **Type** | gemini |
| **Capabilities** | Text + Images (where supported) |
| **Cost** | Free tier available (see [REF-003]) |
| **Rate Limits** | 15 RPM (free tier), visible to user (see [REF-004]) |
| **Data Transmission** | Text and prompts sent to Google servers |
| **Configuration Required** | Gemini API Key |

#### 11.1.2 Cloudflare Workers AI

| Property | Value |
|----------|-------|
| **Provider ID** | `cloudflare-free` |
| **Type** | cloudflare-workers-ai |
| **Capabilities** | Text generation (image via external) |
| **Cost** | Free daily allocation (neurons/day) (see [REF-005]) |
| **Rate Limits** | Daily neuron limit, visible to user |
| **Data Transmission** | Text sent to Cloudflare Workers |
| **Configuration Required** | Cloudflare API Token (optional for free tier) |

#### 11.1.3 Chrome Built-in Summarization API

| Property | Value |
|----------|-------|
| **Provider ID** | `chrome-summarizer` |
| **Type** | chrome-summarizer |
| **Capabilities** | Text-only summarization (no images) |
| **Cost** | Free (browser-native) |
| **Rate Limits** | None (local processing) |
| **Data Transmission** | None (local-only) |
| **Configuration Required** | None |
| **Note** | Experimental feature, requires Chrome built-in support |

### 11.2 Preset Comparison Matrix

| Preset | Text Gen | Image Gen | Free | Requires API Key | Local Processing |
|--------|----------|-----------|------|------------------|------------------|
| Gemini Free | ✓ | ✓* | ✓ | Yes | No |
| Cloudflare Workers AI | ✓ | ✗ | ✓ | Optional | No |
| Chrome Summarizer (exp.) | ✓ | ✗ | ✓ | No | ✓ |

*Image generation via Gemini depends on model capabilities and may require paid tier.

---

## 12. Error Handling & User Feedback

### 12.1 Error Categories

| Error Category | Description | User Feedback |
|----------------|-------------|---------------|
| E001 | Extraction Error | "Unable to extract content from this page. Try selecting text manually." |
| E002 | Summarization Error | "Failed to generate storyboard. [Provider error message]. Try again or switch provider." |
| E003 | Image Generation Error (per panel) | "Panel [N] failed: [error]. Click to retry or regenerate prompt." |
| E004 | Rate Limit Exceeded | "Rate limit reached. Next available: [timestamp]. You can switch providers or wait." |
| E005 | Invalid Credentials | "API key invalid. Please check your settings." |
| E006 | Network Error | "Connection failed. Check internet and try again." |

### 12.2 Error Recovery Flow

```
┌──────────────┐
│  Error       │
│  Occurs      │
└──────┬───────┘
       │
       ▼
┌──────────────┐     ┌─────────────┐     ┌──────────────────┐
│  Retry       │────►│  Success?   │─No─►│  Exponential     │
│  (1st attempt)     └─────────────┘     │  Backoff + Retry │
└──────────────┘                         └──────────────────┘
       │                                         │
       │Yes                                       │No (after 3)
       ▼                                         ▼
┌──────────────┐                         ┌──────────────────┐
│  Continue    │                         │  User Notified   │
│  or Complete │                         │  + Options       │
└──────────────┘                         └──────────────────┘
```

### 12.3 User Action Options on Error

- **Cancel current job**: Stop all pending operations
- **Retry failed panel**: Re-attempt specific panel generation
- **Regenerate prompt**: Ask LLM to rewrite prompt for failed panel
- **Switch provider**: Change to different provider and retry
- **Edit manually**: User modifies prompt/storyboard directly

---

## 13. Permissions

### 13.1 Required Permissions

| Permission | Justification | Manifest Key |
|------------|---------------|--------------|
| `activeTab` | Access current tab for content extraction | `permissions` |
| `storage` | Store settings, history, cached data | `permissions` |
| `scripting` | Execute scripts to extract page content | `permissions` |

### 13.2 Optional Permissions

| Permission | Justification | Manifest Key |
|------------|---------------|--------------|
| `sidePanel` | Enable side panel comic viewer | `permissions` |
| `downloads` | Enable comic export functionality | `permissions` |

### 13.3 Host Permissions

| Host Pattern | Justification |
|--------------|---------------|
| `<all_urls>` or specific sites | Access page content for extraction |

### 13.4 Permission Minimization Strategy

- Request minimum permissions necessary for core functionality
- Use `activeTab` instead of `<all_urls>` where possible
- Provide clear explanations during installation
- Follow Chrome Web Store policies (see [REF-007])

---

## 14. Acceptance Criteria (v1)

### 14.1 Functional Acceptance Criteria

| AC ID | Criterion | Test Method |
|-------|-----------|-------------|
| AC-1 | From any article page, user can generate a 6-panel comic within one flow | Manual test on 5+ article pages |
| AC-2 | User can switch between Gemini and Cloudflare Workers AI presets | Manual provider switch test |
| AC-3 | Progress UI shows overall status, per-panel status, placeholders, and incremental updates | UI inspection during generation |
| AC-4 | User can edit prompts, regenerate single panel, and cancel generation | Manual interaction test |
| AC-5 | User sees and can edit exact text before sending | Text preview editable test |
| AC-6 | Character consistency mode maintains appearance across panels | Generate 6-panel comic with characters |
| AC-7 | History stores and retrieves previous comics | Generate, close, reopen, check history |

### 14.2 Non-Functional Acceptance Criteria

| AC ID | Criterion | Target |
|-------|-----------|--------|
| AC-8 | Text extraction completes within 1 second | P95 < 1000ms on 50 articles |
| AC-9 | Panel placeholders appear within 200ms of generation start | < 200ms latency |
| AC-10 | UI remains responsive during image generation | 60fps maintained |
| AC-11 | Extension passes Chrome Web Store review | All policies satisfied |

### 14.3 Visual Checkpoints

| Checkpoint | Description |
|------------|-------------|
| VC-1 | Onboarding wizard displays correctly on first run |
| VC-2 | Text preview shows extracted content with edit capability |
| VC-3 | Comic viewer displays vertical strip with all panels |
| VC-4 | Progressive rendering shows placeholder → image transition |
| VC-5 | Settings page shows all provider options with cost indicators |
| VC-6 | Error states display clear messages with recovery options |

---

## 15. Recommended Implementation Notes

### 15.1 MV3 Service Worker Considerations

| Consideration | Recommendation |
|---------------|----------------|
| Service worker termination | Persist job state to chrome.storage; resume on wake |
| Background processing | Use chrome.alarms for long-running generation tasks |
| Message passing | Implement robust message handling for popup ↔ service worker communication |

### 15.2 Rate Limit Handling

| Provider | Rate Limit Strategy |
|----------|---------------------|
| Gemini | Display remaining quota; queue requests; show cooldown timer |
| Cloudflare | Track daily neuron usage; warn before limit; fallback to text-only |

### 15.3 Image Generation Pipeline

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌────────────┐
│  Storyboard │───►│  Prompt      │───►│  Provider   │───►│  Image     │
│  JSON       │    │  Enrichment │    │  API Call   │    │  Storage   │
└─────────────┘    └──────────────┘    └─────────────┘    └────────────┘
```

### 15.4 Storage Strategy

| Data Type | Storage Location | Retention |
|-----------|-----------------|-----------|
| Settings | chrome.storage.local | Permanent |
| API Keys | chrome.storage.encrypted | Permanent |
| Comic History | chrome.storage.local | Configurable (default 30 days) |
| Generated Images | IndexedDB | LRU eviction |

---

## Appendix A: Traceability Matrix

| Requirement ID | Source | Type | Priority |
|----------------|--------|------|----------|
| FR-1 | [REF-001] | Functional | Must Have |
| FR-2 | UC1, UC3 | Functional | Must Have |
| FR-3 | Privacy-Conscious User | Functional | Must Have |
| FR-4 | UC2 | Functional | Must Have |
| FR-5 | NFR-S2 | Functional | Must Have |
| FR-6 | NFR-P2 | Functional | Must Have |
| FR-7 | Section 9 | Functional | Must Have |
| FR-8 | UC4 | Functional | Must Have |
| FR-9 | F007 | Functional | Should Have |
| FR-10 | NFR-P3 | Functional | Should Have |
| FR-11 | F005 | Functional | Must Have |
| FR-12 | UC5 | Functional | Must Have |
| FR-13 | Section 10 | Functional | Must Have |
| FR-14 | [REF-003], [REF-004] | Functional | Must Have |
| FR-15 | Section 11 | Functional | Must Have |
| FR-16 | NFR-U1 | Functional | Must Have |
| FR-17 | F009 | Functional | Should Have |
| FR-18 | UC4, UC5 | Functional | Must Have |
| FR-19 | F010 | Functional | Should Have |
| FR-20 | Privacy-Conscious User | Functional | Should Have |
| NFR-U1 | Personas | Non-Functional | Must Have |
| NFR-U2 | Personas | Non-Functional | Must Have |
| NFR-U3 | Section 7.4 | Non-Functional | Must Have |
| NFR-P1 | Section 8.2 | Non-Functional | Must Have |
| NFR-P2 | Section 8.2 | Non-Functional | Must Have |
| NFR-P3 | Section 8.2 | Non-Functional | Must Have |
| NFR-R1 | [REF-006] | Non-Functional | Must Have |
| NFR-R2 | [REF-006] | Non-Functional | Must Have |
| NFR-S1 | Section 8.4 | Non-Functional | Must Have |
| NFR-S2 | Section 8.4 | Non-Functional | Must Have |
| NFR-S3 | Section 8.4 | Non-Functional | Must Have |
| NFR-S4 | [REF-002] | Non-Functional | Must Have |
| NFR-C1 | Section 8.5 | Non-Functional | Must Have |
| NFR-C2 | Section 8.5 | Non-Functional | Must Have |

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **API Key** | Authentication token for accessing provider services |
| **Chrome Storage** | Chrome extension's built-in storage API |
| **Extraction** | Process of obtaining clean text from HTML |
| **Manifest V3** | Chrome extension manifest version 3 |
| **Provider** | External AI service provider |
| **Service Worker** | Background script in MV3 extensions |
| **Storyboard** | Structured plan for comic strip generation |

---

*Document Version: 1.0*  
*Last Updated: 2026-02-24*  
*Status: Draft for Review*
