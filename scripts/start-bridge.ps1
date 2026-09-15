# myOS bridge daemon — keeps the Express bridge (server/index.mjs) running so the
# app is always reachable: on localhost, and over Tailscale via the persistent
# `tailscale serve` proxy (https://kai-1.tailc15d1c.ts.net -> 127.0.0.1:4177).
#
# Registered as the "myOS Bridge" scheduled task (At log on). It loops: start
# node, and if the process exits (crash, or SILVER/vault not yet mounted at boot)
# wait a few seconds and restart. One node process, no console window.
#
# Manual use: powershell -ExecutionPolicy Bypass -File scripts\start-bridge.ps1
# Stop: end the "myOS Bridge" task, or taskkill the node on port 4177.

$ErrorActionPreference = 'Continue'

$repo = Split-Path -Parent $PSScriptRoot            # ...\myos
$entry = Join-Path $repo 'server\index.mjs'

# node: prefer PATH, fall back to the standard install location
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }

$logDir = Join-Path $env:LOCALAPPDATA 'myOS'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir 'bridge.log'

function Write-Log($msg) {
    "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))  $msg" | Add-Content -Path $log -Encoding UTF8
}

Write-Log "daemon start (node=$node entry=$entry)"

while ($true) {
    try {
        # Run node in-line; its stdout/stderr are appended to the log. Blocks
        # until the bridge exits, then we restart it below.
        & $node $entry *>> $log
        Write-Log "bridge exited (code $LASTEXITCODE) - restarting in 5s"
    } catch {
        Write-Log "launch error: $($_.Exception.Message) - retrying in 5s"
    }
    Start-Sleep -Seconds 5
}
