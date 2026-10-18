# Keeps the room server up on this PC so the op-sim tunnel (cloudflared op-sim service,
# op-sim.macroservices.space -> :8787) has something to talk to. Runs dist/server.mjs, so
# after changing server code: pnpm --dir server build, then Start-ScheduledTask "OP Sim server"
# (a new watchdog takes over the port from the old server).
#
#   .\watchdog.ps1 -Install    elevated, once: boot-time task as SYSTEM, started right away
param([int] $Port = 8787, [switch] $Install)

$task = 'OP Sim server'
if ($Install) {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Port $Port"
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $trigger.Delay = 'PT30S'
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
        -Description "Runs and restarts the OP Sim room server on port $Port." -Force | Out-Null
    Start-ScheduledTask -TaskName $task
    "installed and started '$task'"
    return
}

$root = $PSScriptRoot
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

$env:PORT = $Port
$env:FIREBASE_SERVICE_ACCOUNT = Join-Path $root '.secrets\service-account.json'
$env:FIREBASE_DATABASE_URL = 'https://op-sim-ba397-default-rtdb.asia-southeast1.firebasedatabase.app'

function Log($m) { Add-Content (Join-Path $logs 'watchdog.log') ('{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) }

function Start-Server {
    # whoever had the port before (a hand-started server, the last watchdog's) goes
    foreach ($l in @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
        if ((Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue).Name -eq 'node') { Stop-Process -Id $l.OwningProcess -Force }
    }
    # Start-Process truncates the redirect, which would eat the crash we're restarting from
    $err = Join-Path $logs 'server-err.log'
    if ((Test-Path $err) -and (Get-Item $err).Length) { Copy-Item $err (Join-Path $logs 'server-err.prev.log') -Force }
    $p = Start-Process node 'dist/server.mjs' -WorkingDirectory $root -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logs 'server.log') -RedirectStandardError $err
    Log "server started (pid $($p.Id))"
    $p
}

function Healthy {
    try { (Invoke-WebRequest "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $false }
}

Log "watchdog up (pid $PID, port $Port)"
$server = Start-Server
$fails = 0
Start-Sleep 20
while ($true) {
    Start-Sleep 15
    if ($server.HasExited) { Log "server exited ($($server.ExitCode))" }
    elseif (Healthy) { $fails = 0; continue }
    elseif (++$fails -lt 3) { Log "health check failed ($fails/3)"; continue }
    else { Log 'up but not answering, restarting'; Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    $fails = 0
    Start-Sleep 5
    $server = Start-Server
}
