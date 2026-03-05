param(
  [switch]$PreserveBadges
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $scriptDir '..')).Path
$docsRoot = Join-Path $repo 'docs'
$telegramRoot = Join-Path $repo 'telegram'
$htmlRoot = Join-Path $docsRoot 'HTML'

if (Test-Path $htmlRoot) { Remove-Item -Recurse -Force $htmlRoot }
New-Item -ItemType Directory -Path $htmlRoot | Out-Null

$mdSources = @()
$docsMdFiles = Get-ChildItem -Path $docsRoot -Recurse -File -Filter *.md
foreach ($f in $docsMdFiles) {
  $rel = $f.FullName.Substring($docsRoot.Length + 1) -replace '\\','/'
  $mdSources += [PSCustomObject]@{
    FullName = $f.FullName
    RelativeMd = $rel
    RelativeHtml = ([System.IO.Path]::ChangeExtension($rel, '.html') -replace '\\','/')
  }
}

$telegramDocsRoot = Join-Path $telegramRoot 'docs'
if (Test-Path $telegramDocsRoot) {
  $telegramMdFiles = Get-ChildItem -Path $telegramDocsRoot -Recurse -File -Filter *.md
  foreach ($f in $telegramMdFiles) {
    $rel = $f.FullName.Substring($telegramRoot.Length + 1) -replace '\\','/'
    $mdSources += [PSCustomObject]@{
      FullName = $f.FullName
      RelativeMd = ('telegram/' + $rel)
      RelativeHtml = ('telegram/' + ([System.IO.Path]::ChangeExtension($rel, '.html') -replace '\\','/'))
    }
  }
}

$telegramReadme = Join-Path $telegramRoot 'README.md'
if (Test-Path $telegramReadme) {
  $mdSources += [PSCustomObject]@{
    FullName = $telegramReadme
    RelativeMd = 'telegram/README.md'
    RelativeHtml = 'telegram/README.html'
  }
}

$rootHtmlFiles = Get-ChildItem -Path $docsRoot -File -Filter *.html
$knownMd = @{}
foreach ($md in $mdSources) {
  $knownMd[$md.RelativeMd.ToLowerInvariant()] = $md.RelativeHtml
}
$knownRootHtml = @{}
foreach ($html in $rootHtmlFiles) {
  $relHtml = $html.FullName.Substring($docsRoot.Length + 1) -replace '\\','/'
  $knownRootHtml[$relHtml.ToLowerInvariant()] = $relHtml
}

function Split-LinkParts([string]$target) {
  $base = $target
  $suffix = ''
  $hashIdx = $target.IndexOf('#')
  $qIdx = $target.IndexOf('?')
  $cut = -1
  if ($hashIdx -ge 0 -and $qIdx -ge 0) { $cut = [Math]::Min($hashIdx, $qIdx) }
  elseif ($hashIdx -ge 0) { $cut = $hashIdx }
  elseif ($qIdx -ge 0) { $cut = $qIdx }
  if ($cut -ge 0) {
    $base = $target.Substring(0, $cut)
    $suffix = $target.Substring($cut)
  }
  return @{ base = $base; suffix = $suffix }
}

function Resolve-DocHtmlTarget([string]$currentRelativeMd, [string]$target) {
  if ([string]::IsNullOrWhiteSpace($target)) { return $null }
  $trimmed = $target.Trim()
  if ($trimmed -match '^(https?:|mailto:|tel:|#)') { return $null }

  $parts = Split-LinkParts $trimmed
  $base = $parts.base
  $suffix = $parts.suffix
  $normalized = ($base -replace '\\','/').Trim()
  if ($normalized -match '^docs/') { $normalized = $normalized.Substring(5) }
  $normalized = $normalized.TrimStart('/')

  if (!$normalized.ToLowerInvariant().EndsWith('.md')) { return $null }

  $currentDir = [System.IO.Path]::GetDirectoryName($currentRelativeMd)
  if ($null -eq $currentDir) { $currentDir = '' }
  $currentDir = $currentDir -replace '\\','/'
  if (![string]::IsNullOrWhiteSpace($currentDir)) { $currentDir = $currentDir.Trim('/') + '/' } else { $currentDir = '' }

  $baseUri = [Uri]('https://local/' + $currentDir)
  $resolved = [Uri]::new($baseUri, $normalized).AbsolutePath.TrimStart('/')
  $resolvedLower = $resolved.ToLowerInvariant()
  if ($resolvedLower -eq $currentRelativeMd.ToLowerInvariant()) { return $null }
  if (-not $knownMd.ContainsKey($resolvedLower)) { return $null }

  $targetHtml = $knownMd[$resolvedLower]
  $fromUri = [Uri]('https://local/' + $currentDir)
  $toUri = [Uri]('https://local/' + $targetHtml)
  $rel = [Uri]::UnescapeDataString($fromUri.MakeRelativeUri($toUri).ToString())
  return $rel + $suffix
}

function Resolve-DocsRootHtmlTarget([string]$currentRelativeMd, [string]$target) {
  if ([string]::IsNullOrWhiteSpace($target)) { return $null }
  $trimmed = $target.Trim()
  if ($trimmed -match '^(https?:|mailto:|tel:|#)') { return $null }

  $parts = Split-LinkParts $trimmed
  $base = $parts.base
  $suffix = $parts.suffix
  $normalized = ($base -replace '\\','/').Trim()
  if ($normalized -match '^docs/') { $normalized = $normalized.Substring(5) }
  $normalized = $normalized.TrimStart('/')
  if (!$normalized.ToLowerInvariant().EndsWith('.html')) { return $null }

  $currentDir = [System.IO.Path]::GetDirectoryName($currentRelativeMd)
  if ($null -eq $currentDir) { $currentDir = '' }
  $currentDir = $currentDir -replace '\\','/'
  if (![string]::IsNullOrWhiteSpace($currentDir)) { $currentDir = $currentDir.Trim('/') + '/' } else { $currentDir = '' }

  $baseUri = [Uri]('https://local/' + $currentDir)
  $resolved = [Uri]::new($baseUri, $normalized).AbsolutePath.TrimStart('/')
  $resolvedLower = $resolved.ToLowerInvariant()
  if (-not $knownRootHtml.ContainsKey($resolvedLower)) { return $null }

  # Generated pages live under docs/HTML/{currentDir}
  $fromUri = [Uri]('https://local/HTML/' + $currentDir)
  $toUri = [Uri]('https://local/' + $knownRootHtml[$resolvedLower])
  $rel = [Uri]::UnescapeDataString($fromUri.MakeRelativeUri($toUri).ToString())
  return $rel + $suffix
}

function Rewrite-OutsideFencedCode([string]$text, [scriptblock]$rewriter) {
  $parts = [regex]::Split($text, '(?s)(```.*?```)')
  for ($i = 0; $i -lt $parts.Length; $i++) {
    if (($i % 2) -eq 0) {
      $parts[$i] = & $rewriter $parts[$i]
    }
  }
  return [string]::Join('', $parts)
}

function Remove-BadgeLines([string]$text) {
  # Remove markdown lines that are made only of img.shields.io badges
  $badgeAtom = '(?:\[!\[[^\]]*\]\(https?://img\.shields\.io/[^)\r\n]+\)\]\([^)]+\)|!\[[^\]]*\]\(https?://img\.shields\.io/[^)\r\n]+\))'
  $badgeLine = '(?m)^[ \t]*(?:' + $badgeAtom + ')(?:[ \t]+' + $badgeAtom + ')*[ \t]*\r?\n?'
  return [regex]::Replace($text, $badgeLine, '')
}

function Convert-LinkTarget([string]$currentRelativeMd, [string]$target) {
  if ([string]::IsNullOrWhiteSpace($target)) { return $target }
  $wrapped = $false
  $trimmed = $target.Trim()
  if ($trimmed.StartsWith('<') -and $trimmed.EndsWith('>')) {
    $wrapped = $true
    $trimmed = $trimmed.Substring(1, $trimmed.Length - 2)
  }

  $resolved = Resolve-DocHtmlTarget $currentRelativeMd $trimmed
  if (-not $resolved) {
    $resolved = Resolve-DocsRootHtmlTarget $currentRelativeMd $trimmed
  }
  if ($resolved) {
    $rebuilt = $resolved
  } else {
    $rebuilt = $trimmed
  }
  if ($wrapped) { return '<' + $rebuilt + '>' }
  return $rebuilt
}

foreach ($file in $mdSources) {
  $relativeMd = $file.RelativeMd
  $relativeHtml = $file.RelativeHtml
  $outputPath = Join-Path $htmlRoot ($relativeHtml -replace '/', [System.IO.Path]::DirectorySeparatorChar)
  $outDir = Split-Path -Parent $outputPath
  if (!(Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

  $raw = Get-Content -Raw -Path $file.FullName
  $rewritten = Rewrite-OutsideFencedCode $raw {
    param($segment)
    if (-not $PreserveBadges) {
      $segment = Remove-BadgeLines $segment
    }

    $linked = [regex]::Replace(
      $segment,
      '\[(?<text>[^\]]+)\]\((?<url>[^)]+)\)',
      {
        param($m)
        $text = $m.Groups['text'].Value
        $url = $m.Groups['url'].Value
        $newUrl = Convert-LinkTarget $relativeMd $url
        return '[' + $text + '](' + $newUrl + ')'
      }
    )

    $linked = [regex]::Replace(
      $linked,
      '(?<![\[`])`(?<path>[^`\r\n]+?\.md(?:#[^`\r\n]+)?)`(?!`)',
      {
        param($m)
        $path = $m.Groups['path'].Value
        $resolvedInline = Resolve-DocHtmlTarget $relativeMd $path
        if (-not $resolvedInline) { return $m.Value }
        return '[`' + $path + '`](' + $resolvedInline + ')'
      }
    )

    return $linked
  }

  $tempPath = Join-Path $env:TEMP ('web2comics-md-' + [guid]::NewGuid().ToString() + '.md')
  Set-Content -Path $tempPath -Value $rewritten -Encoding UTF8
  try { $fragment = (ConvertFrom-Markdown -Path $tempPath).Html }
  finally { Remove-Item -Path $tempPath -Force -ErrorAction SilentlyContinue }

  $title = [System.IO.Path]::GetFileNameWithoutExtension([System.IO.Path]::GetFileName($file.FullName))
  $depth = ($relativeHtml.Split('/').Length) - 1
  $homePrefix = ''
  if ($depth -gt 0) { $homePrefix = ('../' * $depth) }

  $page = @"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>$title - Web2Comics Docs</title>
  <style>
    :root { --bg:#f7f4ed; --panel:#fff; --ink:#1d2a3f; --muted:#5c6b82; --line:#ddd6ca; --link:#155eef; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:"Segoe UI",Tahoma,Arial,sans-serif; color:var(--ink); background:var(--bg); line-height:1.6; }
    .wrap { max-width:980px; margin:0 auto; padding:18px; }
    .topbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:14px; padding:10px 12px; border:1px solid var(--line); background:#fff; border-radius:10px; }
    .topbar a { color:var(--link); text-decoration:none; font-weight:600; }
    article { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:20px; overflow-wrap:anywhere; }
    h1,h2,h3 { line-height:1.25; }
    pre { background:#0f172a; color:#e2e8f0; padding:12px; border-radius:8px; overflow:auto; }
    code { font-family:Consolas,"Courier New",monospace; font-size:0.92em; }
    a { color:var(--link); }
    table { border-collapse:collapse; width:100%; display:block; overflow-x:auto; }
    th,td { border:1px solid #cdd5e1; padding:6px 8px; text-align:left; vertical-align:top; }
    .footer { margin-top:12px; color:var(--muted); font-size:0.92rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <nav class="topbar">
      <a href="${homePrefix}../index.html">Docs Home</a>
      <a href="${homePrefix}../user-manual.html">User Manual</a>
      <a href="https://github.com/ApartsinProjects/Web2Comics" target="_blank" rel="noopener noreferrer">GitHub Repo</a>
      <a href="https://github.com/ApartsinProjects/Web2Comics#readme" target="_blank" rel="noopener noreferrer">Project README</a>
      <a href="https://www.apartsin.com" target="_blank" rel="noopener noreferrer">Creator Site</a>
      <a href="${homePrefix}../privacy.html">Privacy</a>
      <a href="${homePrefix}../support.html">Support</a>
    </nav>
    <article>
$fragment
    </article>
    <div class="footer">
      Generated from <code>$relativeMd</code> •
      Creator: <a href="https://www.apartsin.com" target="_blank" rel="noopener noreferrer">www.apartsin.com</a>
    </div>
  </div>
</body>
</html>
"@

  Set-Content -Path $outputPath -Value $page -Encoding UTF8
}

Write-Output "Converted $($mdSources.Count) markdown files to HTML under docs/HTML"
