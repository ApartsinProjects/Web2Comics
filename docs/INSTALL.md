# Web2Comics - Installation Guide

Simple step-by-step instructions to install and use the Web2Comics Chrome extension.

---

## Quick Start (5 minutes)

### Step 1: Load Extension in Chrome

1. **Open Chrome** and go to:
   ```
   chrome://extensions/
   ```

2. **Enable Developer mode** (top-right corner)
   - Toggle the switch ON

3. **Click "Load unpacked"**
   ```
   [+ Load unpacked]
   ```

4. **Select the extracted Web2Comics release folder**
   - Navigate to the extracted folder (for example `Web2Comics-v1.0.2`)
   - Select the folder that contains `manifest.json`
   - Click "Select Folder" or "Open"

5. **Confirm the extension is enabled**
   - In `chrome://extensions`, make sure the `Web2Comics` card toggle is ON

6. **Done!** The extension should now appear in your extensions list

---

### Step 2: Show the Extension Icon in the Toolbar (Enable + Pin)

1. Click the puzzle piece (Extensions) icon in Chrome's toolbar
2. Find **Web2Comics**
3. If it does not appear, confirm it is enabled in `chrome://extensions`
4. Click the **pin** icon next to **Web2Comics** to keep it visible in the toolbar
5. Click the Web2Comics toolbar icon to open the popup

---

### Step 3: Configure API Keys / Tokens (Important!)

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

#### Option C: Cloudflare Workers AI (Account ID + API Token)

1. **Get your Cloudflare Account ID**
   - Open Cloudflare dashboard
   - Copy your Account ID from the account overview

2. **Create an API token**
   - Create a token with Workers AI / AI inference access for your account

3. **Configure in extension:**
   - Open **Options -> Providers**
   - Enter Cloudflare Account ID and API Token
   - Click `Validate`
   - Click `Save Providers`

4. **Note**
   - Cloudflare Workers AI supports both text and image generation in this extension
   - Exact model availability may vary by account and region

---

## Using the Extension

### Generate Your First Comic

1. **Navigate to any article** (news, blog, etc.)
2. **Click the Web2Comics extension icon** in the toolbar
3. Click **Create Comic** in the launcher and use defaults for a fast first run, or expand options to customize.
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

### Extension icon not visible in toolbar
```
Solutions:
- Open the Extensions (puzzle) menu and pin Web2Comics
- Confirm Web2Comics is enabled in chrome://extensions
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
4. Using a provider that supports images (Gemini, OpenAI, Cloudflare, OpenRouter, or Hugging Face depending on your account/model access)
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
2. Find "Web2Comics"
3. Click "Remove"
4. Confirm

---

## What's Included

```
Web2Comics-v1.0.2/
├── manifest.json           # Extension config
├── popup/                 # Main popup UI
├── sidepanel/            # Comic viewer
├── options/              # Settings page
├── background/           # Service worker
├── content/              # Page extraction
├── providers/            # AI providers
├── shared/               # Shared code
├── icons/                # Extension icons
├── docs/
│   └── user-manual.html  # User manual / help file
└── docs/INSTALL.md       # This file
```

---

## Need Help?

- **GitHub Issues:** Report bugs at https://github.com/ApartsinProjects/Web2Comics/issues
- **Documentation:** See `docs/user-manual.html` for setup and usage details

---

*Version 1.0.2 | Last Updated: 2026-02-28*
