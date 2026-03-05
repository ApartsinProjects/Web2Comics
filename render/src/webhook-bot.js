#!/usr/bin/env node
// Backward-compatibility entrypoint for older Render start commands.
// Canonical bot entrypoint lives under telegram/src/webhook-bot.js.
require('../../telegram/src/webhook-bot.js');
