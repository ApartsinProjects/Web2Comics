#!/usr/bin/env node
const path = require('path');
const { runComicEngine } = require('../src');
const { buildSnapshotPath, fetchUrlToHtmlSnapshot } = require('../src/url-fetch');

function parseArgs(argv) {
  const out = {
    inputPath: '',
    configPath: '',
    outputPath: '',
    debugDir: '',
    titleOverride: '',
    url: '',
    snapshotPath: '',
    fetchTimeoutMs: 45000
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' || arg === '-i') out.inputPath = argv[++i] || '';
    else if (arg === '--config' || arg === '-c') out.configPath = argv[++i] || '';
    else if (arg === '--output' || arg === '-o') out.outputPath = argv[++i] || '';
    else if (arg === '--debug-dir') out.debugDir = argv[++i] || '';
    else if (arg === '--title') out.titleOverride = argv[++i] || '';
    else if (arg === '--url') out.url = argv[++i] || '';
    else if (arg === '--snapshot-path') out.snapshotPath = argv[++i] || '';
    else if (arg === '--fetch-timeout-ms') out.fetchTimeoutMs = Number(argv[++i] || 45000);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--version' || arg === '-v') out.version = true;
  }
  return out;
}

function printHelp() {
  console.log([
    'Web2Comics Engine CLI',
    '',
    'Usage:',
    '  node engine/cli/comic-engine-cli.js --input <file.html|file.txt> --config <config.yml> --output <comic.png> [options]',
    '  node engine/cli/comic-engine-cli.js --url <https://...> --config <config.yml> --output <comic.png> [options]',
    '',
    'Options:',
    '  -i, --input <path>       Input HTML/TXT file',
    '  -c, --config <path>      YAML config path',
    '  -o, --output <path>      Output PNG path',
    '  --url <https://...>      Fetch URL with Playwright and snapshot HTML first',
    '  --snapshot-path <path>   Explicit path for saved URL HTML snapshot',
    '  --fetch-timeout-ms <n>   URL fetch timeout in ms (default: 45000)',
    '  --title <value>          Override generated title',
    '  --debug-dir <dir>        Save raw storyboard/result debug files',
    '  -h, --help               Show help',
    '  -v, --version            Show version'
  ].join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    console.log('web2comics-engine-cli v1');
    return;
  }

  if ((!args.inputPath && !args.url) || !args.configPath || !args.outputPath) {
    printHelp();
    process.exitCode = 2;
    return;
  }

  if (args.inputPath && args.url) {
    console.error('Use either --input or --url, not both.');
    process.exitCode = 2;
    return;
  }

  try {
    let effectiveInputPath = args.inputPath;
    if (args.url) {
      const snapshotPath = buildSnapshotPath(args.url, args.outputPath, args.snapshotPath);
      const snap = await fetchUrlToHtmlSnapshot(args.url, snapshotPath, {
        timeoutMs: args.fetchTimeoutMs,
        waitUntil: 'domcontentloaded'
      });
      effectiveInputPath = snap.snapshotPath;
      console.log(`Snapshot saved: ${snap.snapshotPath}`);
      if (snap.finalUrl && snap.finalUrl !== args.url) {
        console.log(`Resolved URL: ${snap.finalUrl}`);
      }
    }

    const result = await runComicEngine({
      rootDir: path.resolve(__dirname, '../..'),
      inputPath: effectiveInputPath,
      configPath: args.configPath,
      outputPath: args.outputPath,
      debugDir: args.debugDir,
      titleOverride: args.titleOverride
    });

    console.log(`Output: ${result.outputPath}`);
    console.log(`Panels: ${result.panelCount}`);
    console.log(`Size: ${result.width}x${result.height}, ${result.imageBytes} bytes`);
    console.log(`Elapsed: ${result.elapsedMs}ms`);
  } catch (error) {
    console.error('Engine failed:', error && error.message ? error.message : String(error));
    process.exitCode = 1;
  }
}

main();
