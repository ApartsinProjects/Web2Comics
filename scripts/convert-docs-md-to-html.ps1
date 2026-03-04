$ErrorActionPreference = 'Stop'
$repo = 'e:\Projects\Web2Comics'
$docsRoot = Join-Path $repo 'docs'
$htmlRoot = Join-Path $docsRoot 'HTML'

if (Test-Path $htmlRoot) { Remove-Item -Recurse -Force $htmlRoot }
New-Item -ItemType Directory -Path $htmlRoot | Out-Null

$mdFiles = Get-ChildItem -Path $docsRoot -Recurse -File -Filter *.md

function Convert-LinkTarget([string]$target) {
  if ([string]::IsNullOrWhiteSpace($target)) { return $target }
  $wrapped = $false
  $trimmed = $target.Trim()
  if ($trimmed.StartsWith('<') -and $trimmed.EndsWith('>')) {
    $wrapped = $true
    $trimmed = $trimmed.Substring(1, $trimmed.Length - 2)
  }

  $base = $trimmed
  $suffix = ''
  $hashIdx = $trimmed.IndexOf('#')
  $qIdx = $trimmed.IndexOf('?')
  $cut = -1
  if ($hashIdx -ge 0 -and $qIdx -ge 0) { $cut = [Math]::Min($hashIdx, $qIdx) }
  elseif ($hashIdx -ge 0) { $cut = $hashIdx }
  elseif ($qIdx -ge 0) { $cut = $qIdx }
  if ($cut -ge 0) {
    $base = $trimmed.Substring(0, $cut)
    $suffix = $trimmed.Substring($cut)
  }

  if ($base -match '^(https?:|mailto:|tel:|#)') { return $target }

  $normalized = $base -replace '\\','/'
  if ($normalized -match '^docs/') { $normalized = $normalized.Substring(5) }
  if ($normalized.ToLower().EndsWith('.md')) {
    $normalized = $normalized.Substring(0, $normalized.Length - 3) + '.html'
  }

  $rebuilt = $normalized + $suffix
  if ($wrapped) { return '<' + $rebuilt + '>' }
  return $rebuilt
}

foreach ($file in $mdFiles) {
  $relativeMd = $file.FullName.Substring($docsRoot.Length + 1) -replace '\\','/'
  $relativeHtml = [System.IO.Path]::ChangeExtension($relativeMd, '.html')
  $outputPath = Join-Path $htmlRoot ($relativeHtml -replace '/', [System.IO.Path]::DirectorySeparatorChar)
  $outDir = Split-Path -Parent $outputPath
  if (!(Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

  $raw = Get-Content -Raw -Path $file.FullName
  $rewritten = [regex]::Replace(
    $raw,
    '\[(?<text>[^\]]+)\]\((?<url>[^)]+)\)',
    {
      param($m)
      $text = $m.Groups['text'].Value
      $url = $m.Groups['url'].Value
      $newUrl = Convert-LinkTarget $url
      return '[' + $text + '](' + $newUrl + ')'
    }
  )

  $tempPath = Join-Path $env:TEMP ('web2comics-md-' + [guid]::NewGuid().ToString() + '.md')
  Set-Content -Path $tempPath -Value $rewritten -Encoding UTF8
  try { $fragment = (ConvertFrom-Markdown -Path $tempPath).Html }
  finally { Remove-Item -Path $tempPath -Force -ErrorAction SilentlyContinue }

  $title = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
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
      <a href="https://github.com/ApartsinProjects/Web2Comics#readme" target="_blank" rel="noopener noreferrer">Project README</a>
      <a href="${homePrefix}../privacy.html">Privacy</a>
      <a href="${homePrefix}../support.html">Support</a>
    </nav>
    <article>
$fragment
    </article>
    <div class="footer">Generated from <code>$relativeMd</code></div>
  </div>
</body>
</html>
"@

  Set-Content -Path $outputPath -Value $page -Encoding UTF8
}

Write-Output "Converted $($mdFiles.Count) markdown files to HTML under docs/HTML"
