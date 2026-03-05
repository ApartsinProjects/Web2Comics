#!/usr/bin/env node
// Backward-compatibility entrypoint for older Render start commands.
// Canonical bot entrypoint lives under telegram/src/webhook-bot.js.
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const canonicalBaseConfig = path.join(repoRoot, 'telegram/config/default.render.yml');
const configuredBaseConfig = String(process.env.RENDER_BOT_BASE_CONFIG || '').trim();
const resolvedConfiguredBaseConfig = configuredBaseConfig ? path.resolve(configuredBaseConfig) : '';

// If old deployments still point to render/config/default.render.yml, auto-heal.
if (!configuredBaseConfig || !fs.existsSync(resolvedConfiguredBaseConfig)) {
  if (fs.existsSync(canonicalBaseConfig)) {
    process.env.RENDER_BOT_BASE_CONFIG = canonicalBaseConfig;
  }
}

require('../../telegram/src/webhook-bot.js');
