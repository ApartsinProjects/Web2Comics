param(
    [string]$OutputDir = ".release"
)

$ErrorActionPreference = "Stop"

$manifest = Get-Content -Raw "manifest.json" | ConvertFrom-Json
$version = [string]$manifest.version
$packageName = "Web2Comics-v$version"
$stagingRoot = Join-Path $OutputDir $packageName
$zipPath = Join-Path $OutputDir "$packageName-extension.zip"

if (Test-Path $OutputDir) {
    Remove-Item $OutputDir -Recurse -Force
}

New-Item -ItemType Directory -Path $stagingRoot | Out-Null

$runtimeDirs = @(
    "background",
    "content",
    "icons",
    "options",
    "popup",
    "providers",
    "shared",
    "sidepanel"
)

foreach ($dir in $runtimeDirs) {
    Copy-Item $dir -Destination $stagingRoot -Recurse
}

Copy-Item "manifest.json" -Destination $stagingRoot
Copy-Item "INSTALL.md" -Destination $stagingRoot

$docsDir = Join-Path $stagingRoot "docs"
New-Item -ItemType Directory -Path $docsDir | Out-Null
Copy-Item "docs/user-manual.html" -Destination (Join-Path $docsDir "user-manual.html")

# Strip developer docs and optional local artifacts from the runtime folders.
Get-ChildItem -Path $stagingRoot -Recurse -File -Filter "README.md" | Remove-Item -Force
Get-ChildItem -Path $stagingRoot -Recurse -File -Filter "*.local.json" | Remove-Item -Force
$typesPath = Join-Path $stagingRoot "shared/types.js"
if (Test-Path $typesPath) {
    Remove-Item $typesPath -Force
}

Compress-Archive -Path $stagingRoot -DestinationPath $zipPath -CompressionLevel Optimal -Force

Write-Output "Created: $zipPath"
