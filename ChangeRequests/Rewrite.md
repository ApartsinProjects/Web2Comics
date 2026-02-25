# Change Request (CR)

## Title

web2Comics Chrome Extension: Image Generation Refusal Handling (Prompt Rewrite / Sanitization / Show Blocked)

---

## 1. Background

In web2Comics, the extension summarizes a page and generates a comic-strip via image generation prompts. Prompts that include **real political figures** (e.g., Trump) can be refused by the image provider due to content filtering. This can break comic strips (missing panels) unless handled gracefully.

---

## 2. Objective

Add a **user-configurable refusal-handling policy** in the Chrome extension **Options/Settings panel** to control what happens when an image generation request is blocked.

---

## 3. User Stories

- As a user, when image generation is blocked, I want the extension to automatically retry with a safer prompt so I still get a comic.
- As a user, I want an option to preserve the storyline but replace real names if needed to avoid blocks.
- As a user, I want an option to do nothing and show “blocked” placeholders for transparency.

---

## 4. UI/UX Requirements (Chrome Extension Options Panel)

### 4.1 Settings Section

Add a section:

**Image Generation → Content Filtering Handling**

Control: **Radio group** (single selection)

Label: **When image generation is blocked**

Options (3):

1. **Rewrite and try again (keep real figure)**
   
   - Description: If the provider blocks the prompt, rewrite it to a neutral editorial style and retry once.

2. **Replace people and trigger words, then retry**
   
   - Description: Replace real names and sensitive trigger phrases with neutral fictional descriptors, then retry once.

3. **Do nothing (show blocked panel)**
   
   - Description: Don’t retry; show a blocked placeholder panel in the comic strip.

Default: **Rewrite and try again (keep real figure)**

---

### 4.2 Optional Toggles (Recommended)

- **Show “Rewritten” badge on retried panels:** toggle (default ON)
- **Log original + rewritten prompt locally (for debugging):** toggle (default OFF)

Notes:

- Retry count is fixed to **1** (no UI needed).

---

## 5. Functional Requirements

### 5.1 Refusal Detection

When calling the image generation provider, the extension must detect refusal outcomes, including:

- Explicit “blocked/refused” status codes (provider-specific)
- Error messages indicating content policy / safety filter / moderation refusal

On refusal, the extension must route to the configured handling mode.

---

### 5.2 Handling Modes

#### Mode A — `rewrite_and_retry` (keep real figure)

Behavior:

1. Take the original prompt.
2. Apply the Prompt Rewriting Template (Section 6).
3. Retry image generation **once**.
4. If retry fails: render blocked placeholder for that panel.

Notes:

- Preserves the real figure reference.
- Removes persuasive/defamatory framing.
- Avoids “exact likeness” / deepfake phrasing.

---

#### Mode B — `replace_people_and_triggers` (sanitize and retry)

Behavior:

1. Take the original prompt.
2. Replace:
   - Real-person names → fictional neutral descriptors (e.g., “a well-known American politician”).
   - Trigger terms (e.g., “arrest”, “corruption”, “rigged election”) → neutral context (e.g., “legal setting”, “political event”).
3. Retry once.
4. If retry fails: render blocked placeholder.

Notes:

- Higher success probability.
- May alter user intent (explicitly documented in UI description).

---

#### Mode C — `show_blocked` (no retry)

Behavior:

1. Do not modify the prompt.
2. Do not retry.
3. Insert a blocked placeholder image panel with a short caption.

Placeholder requirements:

- Same aspect ratio as normal panels
- Text: “Panel blocked by image provider policy”
- Provide a “View prompt” link/button if debugging is enabled

---

## 6. Prompt Rewriting Template (Mode A)

Rewrite the image generation prompt to reduce refusal likelihood while preserving:

- The real public figure mentioned
- The core storyline or scene
- The intended artistic style (if specified)

Apply the following rules:

1. Keep tone neutral and documentary-like.
2. Remove persuasive, promotional, or election-influencing language.
3. Remove defamatory or unverified criminal claims.
4. Replace emotionally loaded words with neutral descriptors.
5. Frame as editorial/journalistic/historical/artistic context.
6. Avoid “exact likeness,” “deepfake,” or similar phrasing.
7. If realism is requested, use “editorial photo style” / “news photography style.”

Return only the rewritten prompt.

---

## 

## 8. Runtime Flow (Panel-Level)

For each comic panel:

1. Generate panel prompt (from web summary + storyboard).
2. Call Image API.
3. If success → render panel.
4. If refused → apply selected mode:
   - `rewrite_and_retry` → rewrite → retry → render success or blocked placeholder
   - `replace_people_and_triggers` → sanitize → retry → render success or blocked placeholder
   - `show_blocked` → render blocked placeholder

---

## 9. Acceptance Criteria

| ID  | Setting                     | Scenario                                  | Expected                                          |
| --- | --------------------------- | ----------------------------------------- | ------------------------------------------------- |
| AC1 | rewrite_and_retry           | Prompt with real political figure blocked | Prompt rewritten, retried once                    |
| AC2 | rewrite_and_retry           | Retry succeeds                            | Panel renders; optional “Rewritten” badge shown   |
| AC3 | rewrite_and_retry           | Retry fails                               | Blocked placeholder panel rendered                |
| AC4 | replace_people_and_triggers | Prompt blocked                            | Names/trigger terms replaced; retried once        |
| AC5 | show_blocked                | Prompt blocked                            | No retry; blocked placeholder rendered            |
| AC6 | storage.sync                | Change setting                            | Setting persists across devices (if sync enabled) |

---

## 10. Notes / Edge Cases

- If the provider returns a refusal without detailed reason, treat as refusal and follow the selected mode.
- Ensure retries do not loop across refreshes (store per-panel attempt state in memory for the current run).
- If multiple providers are supported, normalize provider responses into: `{success | refused | error}`.
