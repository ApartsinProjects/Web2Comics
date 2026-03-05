param()

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$botDir = Join-Path $repoRoot 'comicbot'
$envFile = Join-Path $botDir '.env'
$envExample = Join-Path $botDir '.env.example'

Set-Location $repoRoot

if (-not (Test-Path $envFile)) {
  Copy-Item $envExample $envFile -Force
  Write-Host ''
  Write-Host 'Created comicbot/.env from .env.example' -ForegroundColor Yellow
  Write-Host 'Please add TELEGRAM_BOT_TOKEN and GEMINI_API_KEY in .env, then run this script again.' -ForegroundColor Yellow
  Write-Host ''
  Start-Process notepad $envFile
  exit 0
}

Write-Host 'Installing dependencies (first run may take a few minutes)...' -ForegroundColor Cyan
npm install

Write-Host ''
Write-Host 'Starting ComicBot...' -ForegroundColor Green
Write-Host 'Press Ctrl+C to stop.' -ForegroundColor Green
npm run comicbot:start
