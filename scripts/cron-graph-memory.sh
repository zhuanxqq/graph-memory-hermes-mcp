#!/bin/bash
# graph-memory cron entry
# Runs sync-hermes-state.ts every 5 minutes via crontab

cd "$(dirname "$0")/.." || exit 1

export PATH="/opt/homebrew/bin:$HOME/.local/bin:$HOME/.nvm/versions/node/v22/bin:$PATH"

npx tsx scripts/sync-hermes-state.ts >> ~/.hermes/graph-memory-cron.log 2>&1
