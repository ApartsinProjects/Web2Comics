# ComicBot Easy Setup (Non-Technical)

This guide is for users who do not code.

Goal: create your own Telegram bot that turns text/URLs into comic images.

## What you need
- Windows PC
- Telegram app
- Internet connection
- 10-15 minutes

## Step 1: Create your Telegram bot (very easy)
1. Open Telegram.
2. Search for **BotFather** (`@BotFather`).
3. Send: `/newbot`
4. Follow prompts:
   - pick bot name (example: `My Comic Bot`)
   - pick username ending with `bot` (example: `mycomichelperbot`)
5. BotFather gives you a **token**. Keep it.

## Step 2: Get a Gemini API key (default provider)
1. Open Google AI Studio.
2. Create API key.
3. Copy the key.

## Step 3: One-time local setup
1. Open this project folder on your PC.
2. Go to `comicbot` folder.
3. Double-click: **`start-bot.bat`**

What happens:
- If `.env` does not exist, it is created automatically.
- Notepad opens `.env`.

4. In `.env`, paste:
- `TELEGRAM_BOT_TOKEN=...` (from BotFather)
- `GEMINI_API_KEY=...` (from AI Studio)

5. Save file and close Notepad.
6. Double-click **`start-bot.bat`** again.

The bot starts. Keep the terminal window open.

## Step 4: Use your bot
1. Open your bot chat in Telegram.
2. Send `/start`.
3. Send one of these:
- plain text story
- full URL starting with `http://` or `https://`

The bot replies with a comic image.

## Daily usage
- Start bot: double-click `comicbot/start-bot.bat`
- Stop bot: press `Ctrl + C` in the terminal window

## Troubleshooting (simple)
- "Missing TELEGRAM_BOT_TOKEN"
  - open `comicbot/.env` and paste token from BotFather.
- "quota" or "billing" error
  - your provider key has no available quota; create/use another key.
- no response in Telegram
  - make sure terminal window is still open and running.

## Optional safety (only your chat)
If you want only your chat to use this bot:
1. In `comicbot/.env`, set `COMICBOT_ALLOWED_CHAT_IDS`.
2. Ask a technical friend to find your chat ID once.

---
If you want advanced options (models/config tuning), use: `comicbot/USER_GUIDE.md`.
