<#
.SYNOPSIS
  Keeps the Facebook Marketplace scraping path alive on the operator's machine.

  Two jobs:
    1. Ensure a dedicated Chrome is running with remote debugging (CDP) on
       127.0.0.1:9222 using an isolated profile (logged into Facebook).
    2. Maintain a reverse SSH tunnel to the agent host so its 127.0.0.1:9222
       maps to this machine's Chrome. Auto-reconnects if the link drops.

  The Seneschal scraper agent (running on the EC2 agent host, inside the VPC)
  connects to http://127.0.0.1:9222 -> tunnel -> this Chrome. Because it's a
  real, logged-in browser on a residential IP, Facebook doesn't challenge it.

.DESCRIPTION
  Run it once in a terminal, or register it to run at logon (see REGISTER
  below). It loops forever; Ctrl+C to stop.

.PARAMETER BoxHost
  SSH host of the agent host (Route53 A record -> EIP). Default browser.parthadae.com.

.PARAMETER RemotePort / LocalPort
  CDP port mapped on the box / listened on locally. Default 9222 both.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\fb-agent-tunnel.ps1

.NOTES
  REGISTER AT LOGON (so it survives reboots), run once in an elevated shell:

    $action  = New-ScheduledTaskAction -Execute "powershell.exe" `
      -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PWD\fb-agent-tunnel.ps1`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $set     = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName "FbAgentTunnel" -Action $action -Trigger $trigger -Settings $set

  To confirm the box sees your Chrome:
    ssh ubuntu@browser.parthadae.com "curl -s http://127.0.0.1:9222/json/version"
#>

[CmdletBinding()]
param(
  [string]$BoxHost    = "browser.parthadae.com",
  [string]$BoxUser    = "ubuntu",
  [int]   $RemotePort = 9222,
  [int]   $LocalPort  = 9222,
  [string]$ProfileDir = "$env:USERPROFILE\fb-scrape-profile",
  [string]$SshKey     = "$env:USERPROFILE\.ssh\id_ed25519",
  [string]$StartUrl   = "https://www.facebook.com/marketplace/"
)

$ErrorActionPreference = "Stop"

function Write-Log($msg) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg)
}

function Find-Chrome {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  throw "Could not find chrome.exe. Pass -ChromePath or install Chrome."
}

function Test-Cdp {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/json/version" -TimeoutSec 3
    return [bool]$r.Browser
  } catch { return $false }
}

function Ensure-Chrome {
  if (Test-Cdp) { return }
  $chrome = Find-Chrome
  Write-Log "Launching dedicated Chrome (CDP :$LocalPort, profile $ProfileDir)"
  $chromeArgs = @(
    "--remote-debugging-port=$LocalPort",
    "--remote-debugging-address=127.0.0.1",
    "--user-data-dir=`"$ProfileDir`"",
    "--no-first-run",
    "--no-default-browser-check",
    $StartUrl
  )
  Start-Process -FilePath $chrome -ArgumentList $chromeArgs | Out-Null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Cdp) { Write-Log "Chrome CDP is up."; return }
  }
  Write-Log "WARNING: Chrome started but CDP not reachable yet; continuing."
}

Write-Log "fb-agent-tunnel starting. Box=$BoxUser@$BoxHost  map box:$RemotePort -> local:$LocalPort"

while ($true) {
  try {
    Ensure-Chrome

    # -N: no remote command. ExitOnForwardFailure: die if the reverse bind
    # fails (e.g. a stale forward still holds the port) so we retry cleanly.
    $sshArgs = @(
      "-N",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-i", $SshKey,
      "-R", "$RemotePort`:127.0.0.1:$LocalPort",
      "$BoxUser@$BoxHost"
    )
    Write-Log "Opening reverse tunnel..."
    & ssh @sshArgs
    Write-Log "Tunnel exited (code $LASTEXITCODE). Reconnecting in 5s..."
  }
  catch {
    Write-Log "Error: $($_.Exception.Message). Retrying in 5s..."
  }
  Start-Sleep -Seconds 5
}
