param(
    [string]$OutputDir = ".release"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path "package.json")) {
    throw "Run this script from repository root."
}

$packageJson = Get-Content -Raw "package.json" | ConvertFrom-Json
$version = [string]$packageJson.version
if ([string]::IsNullOrWhiteSpace($version)) {
    throw "Could not resolve version from package.json"
}

$packageName = "Web2Comics-TelegramBot-v$version"
$stagingRoot = Join-Path $OutputDir $packageName
$zipPath = Join-Path $OutputDir "$packageName-deploy.zip"

if (Test-Path $stagingRoot) {
    Remove-Item $stagingRoot -Recurse -Force
}
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}
New-Item -ItemType Directory -Path $stagingRoot | Out-Null

# Required runtime/deploy content for standalone bot deployment.
$includePaths = @(
    "telegram",
    "engine",
    "docker",
    "render",
    "scripts/deploy-bot-auto.js",
    "scripts/validate-secrets.js",
    "scripts/cloudflare/create-scoped-tokens.js",
    "package.json",
    "package-lock.json",
    "README.md"
)

foreach ($entry in $includePaths) {
    if (-not (Test-Path $entry)) { continue }
    $destination = Join-Path $stagingRoot $entry
    $destDir = Split-Path -Parent $destination
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    if ((Get-Item $entry).PSIsContainer) {
        Copy-Item $entry -Destination $destination -Recurse -Force
    } else {
        Copy-Item $entry -Destination $destination -Force
    }
}

# Remove secrets and transient artifacts aggressively.
$removePaths = @(
    ".env",
    ".env.local",
    ".env.e2e.local",
    ".telegram.yaml",
    ".cloudflare.yaml",
    ".aws.yaml",
    "telegram/.env",
    "telegram/out",
    "telegram/data",
    "telegram/cfgs",
    "cloudflare/.dev.vars",
    "cloudflare/.wrangler",
    ".wrangler",
    "node_modules"
)
foreach ($rel in $removePaths) {
    $p = Join-Path $stagingRoot $rel
    if (Test-Path $p) {
        Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Remove any accidentally copied secret-like files.
Get-ChildItem -Path $stagingRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -match '(^|\.)(env|yaml|yml)$' -and
        ($_.FullName -match 'telegram\\\.env$' -or $_.Name -match '^\.(telegram|cloudflare|aws)\.ya?ml$' -or $_.Name -match '^\.env')
    } |
    ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }

Compress-Archive -Path $stagingRoot -DestinationPath $zipPath -CompressionLevel Optimal -Force

$zipItem = Get-Item $zipPath
Write-Output "Created: $($zipItem.FullName)"
Write-Output "Size: $([Math]::Round($zipItem.Length / 1MB, 2)) MB"
Write-Output "Package root: $stagingRoot"
