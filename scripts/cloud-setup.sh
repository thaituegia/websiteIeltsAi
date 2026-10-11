#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

node --input-type=module -e 'if(Number(process.versions.node.split(".")[0])<24) throw new Error("Node.js 24+ is required")'
npm ci --include=dev --cache /workspace/.npm-cache --no-audit --no-fund

# Use the official local MongoDB only when no external URI was configured.
# dotenv reads an existing private .env without printing connection credentials.
if node --import dotenv/config --input-type=module -e 'const uri=process.env.MONGODB_URI;process.exit(!uri||/^mongodb:\/\/(?:127\.0\.0\.1|localhost):27017(?:\/|$)/.test(uri)?0:1)'; then
  npm run mongo:start
fi
npm run audit:content
npm run audit:fresh
npm run audit:references
npm run build
npm run seed
