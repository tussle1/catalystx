param(
  [int]$Port = 8787,
  [string]$Passcode = "",
  [switch]$Tunnel
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "=== CatalystX · Phaze Web Bridge (Windows Host Launcher) ===" -ForegroundColor Cyan

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..." -ForegroundColor Yellow
  npm install
}

# Quick probe of local Phaze MCP (127.0.0.1:41010/mcp)
try {
  $body = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"phaze_status","arguments":{}}}'
  $null = Invoke-RestMethod -Uri "http://127.0.0.1:41010/mcp" -Method Post -ContentType "application/json" -Headers @{ Accept = "application/json, text/event-stream" } -Body $body -TimeoutSec 2
  Write-Host "[OK] Detected running Phaze MCP server on 127.0.0.1:41010!" -ForegroundColor Green
} catch {
  Write-Host "[Notice] Phaze MCP did not respond on 127.0.0.1:41010 yet." -ForegroundColor Yellow
  Write-Host "         Open Phaze -> Client Settings -> Experimental -> Enable 'MCP server'." -ForegroundColor Yellow
}

$env:PORT = "$Port"
$env:HOST = "0.0.0.0"
if ($Passcode -ne "") {
  $env:BRIDGE_PASSCODE = $Passcode
  Write-Host "[Security] BRIDGE_PASSCODE protection enabled." -ForegroundColor Green
}

if ($Tunnel) {
  if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
    Write-Host "Starting Cloudflare Quick Tunnel for Chromebook HTTPS access..." -ForegroundColor Cyan
    Start-Process -NoNewWindow cloudflared -ArgumentList "tunnel --url http://127.0.0.1:$Port"
  } else {
    Write-Host "[Tip] Install cloudflared ('winget install Cloudflare.cloudflared') to get an instant HTTPS URL for your Chromebook." -ForegroundColor Yellow
  }
}

Write-Host "Starting Phaze Web Bridge on port $Port..." -ForegroundColor Cyan
node server/index.js
