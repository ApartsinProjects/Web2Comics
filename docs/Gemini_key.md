# Gemini API Key Guide (Google AI Studio, Free Tier)

Step-by-step instructions to obtain a Google Gemini API key for Web2Comics using Google AI Studio (Gemini free tier access).

## Quick Link

- Google AI Studio API keys page: https://aistudio.google.com/app/apikey

## What You Need

- A Google account
- Access to Google AI Studio in your region
- Gemini free tier availability for your account/region (AI Studio limits vary)

## Do You Need To Enable a Google API Service First?

Usually, **no** for the Gemini free-tier flow in **Google AI Studio**.

- If you can open AI Studio and create a Gemini API key there, you typically do **not** need a separate manual API enable step.
- Google AI Studio handles the common key creation flow for Gemini API access.

You may need extra setup only if:
- your Google Workspace admin restricts AI Studio access, or
- you are using/importing a specific Google Cloud project with restricted APIs/permissions.

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
  - If you use a managed Google Workspace account, ask your admin to enable **Google AI Studio** access for your org/unit

- API key page opens, but API calls fail due to project/API access errors:
  - Open Google Cloud Console API Library for your project:
    - https://console.cloud.google.com/apis/library
  - Search for and enable **Generative Language API** (if it is disabled)
  - Retry key creation/use from AI Studio
  - If your org restricts API usage, ask an admin for project/API access permissions

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
