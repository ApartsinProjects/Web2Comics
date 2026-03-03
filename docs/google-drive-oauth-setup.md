# Google Drive OAuth Setup (Web2Comics Extension)

This guide configures Google OAuth so `Connect Google Drive` works in the extension and auto-sync uploads comics to the `MyComics` folder.

## 1. Create/Configure Google Cloud Project

1. Open Google Cloud Console.
2. Create a project (or select an existing one).
3. Enable API:
   - `Google Drive API`

## 2. Configure OAuth Consent Screen

1. Go to `APIs & Services` -> `OAuth consent screen`.
2. Choose user type (`External` for most extension use).
3. Fill required app fields (name, support email, developer contact).
4. Add scope:
   - `https://www.googleapis.com/auth/drive.file`
5. If app is in Testing mode, add your tester Google accounts.

## 3. Create OAuth Client Credentials

Use an OAuth client that supports redirect URIs (typically `Web application` for this flow).

1. Go to `APIs & Services` -> `Credentials`.
2. Create `OAuth client ID`.
3. Add authorized redirect URI(s):
   - `https://<YOUR_EXTENSION_ID>.chromiumapp.org/google-oauth2`
   - Optional fallback also supported by code:
     - `https://<YOUR_EXTENSION_ID>.chromiumapp.org/`

Notes:
- Replace `<YOUR_EXTENSION_ID>` with your real Chrome extension ID.
- The code uses `chrome.identity.getRedirectURL('google-oauth2')` first, then `chrome.identity.getRedirectURL()`.

## 4. Put Client ID Into Extension Config

The extension resolves Google Drive OAuth client ID in this order:

1. `chrome.storage.local.oauthClientConfig.googleDriveClientId`
2. `shared/oauth-client-config.local.json` (`googleDriveClientId`)
3. `manifest.oauth2.client_id`

Recommended for local/dev:

Create `shared/oauth-client-config.local.json`:

```json
{
  "googleDriveClientId": "YOUR_CLIENT_ID.apps.googleusercontent.com"
}
```

## 5. Required Extension Permissions

Manifest must include:

- `permissions`: `identity`, `storage`
- `host_permissions`: `https://www.googleapis.com/*`

These are already present in the current extension.

## 6. Runtime Flow (What You Should See)

1. Open extension Options -> `Connections`.
2. Click `Connect` in Google Drive card.
3. Google sign-in/consent popup appears.
4. After approval, status becomes `Connected`.
5. `Enable authorization` checkbox becomes available.
6. Generate a comic; autosave uploads HTML to Drive folder `MyComics`.

## 7. Token Behavior

The extension uses OAuth 2.0 Authorization Code + PKCE:

- Receives authorization code from Google.
- Exchanges code for access token (and refresh token when provided).
- Refreshes expired access tokens in background before Drive upload.

## 8. Validation Checklist

1. `Connect` opens Google consent UI.
2. No `OAuth app not configured` status after client ID is set.
3. `googleDriveAuth` is stored in `chrome.storage.local` with:
   - `accessToken`
   - `expiresAt`
   - `clientId`
   - optionally `refreshToken`
4. Upload creates/uses Drive folder `MyComics`.
5. Uploaded file type is HTML and opens in Drive preview.

## 9. Common Failure Causes

1. Redirect URI mismatch:
   - Authorized URI in Google Cloud does not exactly match `chromiumapp.org` URL used by extension.
2. Wrong OAuth client type or wrong client ID.
3. Consent screen still unapproved and test user not whitelisted.
4. Drive API not enabled in project.
5. Browser/profile uses different extension ID than the one configured in redirect URI.

## 10. Debug Tips

1. Export debug logs from popup/sidepanel/options.
2. Look for service-worker events:
   - `drive.connect.success`
   - `drive.connect.attempt_failed`
   - `drive.token.refresh.success`
   - `drive.upload.success`
   - `drive.upload.error`

