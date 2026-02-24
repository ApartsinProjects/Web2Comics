# Web to Comic - Installation Guide

Simple step-by-step instructions to the Web install and use to Comic Chrome extension.

---

## Quick Start (5 minutes)

### Step 1: Prepare Icons (If Needed)

The extension includes SVG icons. If Chrome shows warnings, create simple PNG icons:

1. Open https://svgtopng.com
2. Upload each SVG file from the `icons/` folder
3. Download the PNG versions (16x16, 48x48, 128x128)
4. Replace the SVG files with PNG files

**Or use the included SVG icons directly** (works in most modern Chrome versions)

---

### Step 2: Load Extension in Chrome

1. **Open Chrome** and go to:
   ```
   chrome://extensions/
   ```

2. **Enable Developer Mode** (top-right corner)
   - Toggle the switch to ON

3. **Click "Load unpacked"**
   ```
   [+ Load unpacked]
   ```

4. **Select the WebToComin folder**
   - Navigate to where you extracted the files
   - Click "Select Folder" or "Open"

5. **Done!** The extension should now appear in your extensions list

---

### Step 3: Pin to Chrome Toolbar

1. Click the puzzle piece icon (🧩) in Chrome's toolbar
2. Find "Web to Comic"
3. Click the **pin icon** to keep it visible

---

### Step 4: Configure API Keys (Important!)

The extension needs AI providers to generate comics. You must configure at least one:

#### Option A: Google Gemini (Recommended)

1. **Get a free API key:**
   - Go to https://aistudio.google.com/app/apikey
   - Sign in with Google
   - Click "Create API key"
   - Copy the key

2. **Configure in extension:**
   - Click the extension icon
   - Click the gear/settings icon
   - Go to **Providers** tab
   - Paste your Gemini API key
   - Click "Validate"
   - Click "Save Providers"

#### Option B: OpenAI (GPT + DALL-E)

1. **Get an API key:**
   - Go to https://platform.openai.com/api-keys
   - Sign in/Sign up
   - Create a new secret key
   - Copy the key (starts with `sk-`)

2. **Configure:**
   - Same as above, but enter OpenAI key
   - Select your preferred models (GPT-4o, DALL-E 3)

#### Option C: Cloudflare Workers AI (Free)

1. No API key needed for basic use
2. Just select "Cloudflare Workers AI" as provider
3. Note: Only supports text generation (no images)

---

## Using the Extension

### Generate Your First Comic

1. **Navigate to any article** (news, blog, etc.)
2. **Click the extension icon** in toolbar
3. You'll see:
   - Extracted content preview
   - Panel count selector (3-12 panels)
   - Style presets (Noir, Manga, etc.)
   - Provider selection
4. **Click "Generate Comic"**
5. Wait for generation (progress shown)
6. **Click "Open Comic Viewer"** to see your comic!

### Tips

- **Selected text mode**: Select specific text on page before clicking extension
- **Style presets**: Try "Noir" for dramatic black & white, "Manga" for anime style
- **Panel count**: More panels = more detail but slower generation

---

## Troubleshooting

### Extension won't load
```
Solution: Make sure Developer mode is ON in chrome://extensions/
```

### "API key not configured" error
```
Solution: Configure your API key in Options > Providers
```

### Content extraction fails
```
Solutions:
- Try selecting text manually on the page
- Refresh the page
- Check if page requires login
```

### Images not generating
```
Check:
1. API key is configured
2. You haven't exceeded rate limits
3. Network is working
4. Using a provider that supports images (Gemini or OpenAI)
```

### Service worker errors
```
This is normal - MV3 service workers stop when idle.
They wake up automatically when needed.
Check chrome://extensions > Service worker for logs.
```

---

## Uninstalling

1. Go to `chrome://extensions/`
2. Find "Web to Comic"
3. Click "Remove"
4. Confirm

---

## What's Included

```
WebToComin/
├── manifest.json           # Extension config
├── popup/                 # Main popup UI
├── sidepanel/            # Comic viewer
├── options/              # Settings page
├── background/           # Service worker
├── content/              # Page extraction
├── providers/            # AI providers
├── shared/               # Shared code
├── icons/                # Extension icons
├── SPEC.md               # Full specification
└── INSTALL.md            # This file
```

---

## Need Help?

- **GitHub Issues:** Report bugs at https://github.com/anomalyco/opencode/issues
- **Documentation:** See `SPEC.md` for technical details

---

*Version 1.0 | Last Updated: 2026-02-24*
