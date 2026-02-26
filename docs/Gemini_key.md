# Gemini API Key Guide (Google AI Studio, Free Tier)

Step-by-step instructions to obtain a Google Gemini API key for Web2Comics using Google AI Studio (Gemini free tier access).

## Quick Link

- Google AI Studio API keys page: https://aistudio.google.com/app/apikey

## What You Need

- A Google account
- Access to Google AI Studio in your region
- Gemini free tier availability for your account/region (AI Studio limits vary)

## Steps

1. Open Google AI Studio:
   - https://aistudio.google.com/

2. Sign in with your Google account (if prompted).

3. Open the API Keys page:
   - https://aistudio.google.com/app/apikey

4. Click `Create API key`.
   - If asked, choose or create a Google Cloud project.

5. Copy the generated API key.
   - Treat it like a password.
   - Do not share it publicly or commit it to Git.

6. Open Web2Comics in Chrome.
   - Click the Web2Comics toolbar icon
   - Open `Options -> Providers`

7. Paste the key into the Gemini provider field.

8. Click `Validate`, then click `Save Providers`.

9. Return to the popup and generate a comic.

## Troubleshooting

- AI Studio page does not open or key creation is unavailable:
  - Check region/account eligibility in Google AI Studio
  - Try a different Google account

- Key validates but generation fails:
  - Check quota/usage limits in AI Studio
  - Retry with fewer panels (for example `3`) and lower detail

- Gemini not visible/usable in Web2Comics:
  - Confirm the key was saved in `Options -> Providers`
  - Re-open the extension popup after saving

## Security Notes

- Keep your Gemini API key private.
- Do not paste your key into screenshots, issue reports, or public chats.
- If a key is exposed, revoke/regenerate it in AI Studio and update Web2Comics.
