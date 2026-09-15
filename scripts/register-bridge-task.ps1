# Registers the "myOS Bridge" scheduled task so the bridge auto-starts at log on
# and stays running (scripts\start-bridge.ps1 daemon). Run once per machine:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-bridge-task.ps1
# No admin needed (per-user, Interactive logon). Remove with:
#   Unregister-ScheduledTask -TaskName 'myOS Bridge' -Confirm:$false
#
# Reachability: the bridge listens on 4177; `tailscale serve --bg 4177` (persistent)
# exposes it at https://kai-1.tailc15d1c.ts.net for the phone over the tailnet.

$ErrorActionPreference = 'Stop'
$repo   = Split-Path -Parent $PSScriptRoot
$script = Join-Path $repo 'scripts\start-bridge.ps1'
$taskName = 'myOS Bridge'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" `
    -WorkingDirectory $repo

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal `
    -Description 'Keeps the myOS bridge (server/index.mjs, port 4177) running so the app is reachable on localhost and over Tailscale.' `
    -Force | Out-Null

Write-Output "Registered '$taskName' (At log on)."
Start-ScheduledTask -TaskName $taskName
Write-Output "Started '$taskName'."
