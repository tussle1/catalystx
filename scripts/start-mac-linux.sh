#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-8787}"
export PORT
export HOST="${HOST:-0.0.0.0}"

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

if curl -sS --max-time 2 -X POST "http://127.0.0.1:41010/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"phaze_status","arguments":{}}}' >/dev/null 2>&1; then
  echo "[OK] Detected running Phaze MCP server at http://127.0.0.1:41010/mcp"
else
  echo "[Notice] Phaze MCP not reachable at 127.0.0.1:41010 yet (enable MCP server in Phaze -> Settings -> Experimental)."
fi

echo "Starting CatalystX Phaze Web Bridge on http://0.0.0.0:${PORT} ..."
exec node server/index.js
