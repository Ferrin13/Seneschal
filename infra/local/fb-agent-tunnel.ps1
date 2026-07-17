<#
.SYNOPSIS
  Keeps the Facebook Marketplace scraping path alive on the operator's machine.

  Jobs:
    1. Ensure a dedicated Chrome is running with remote debugging (CDP) on
       127.0.0.1:9222 using an isolated profile (logged into Facebook).
    2. Maintain a single SSH connection to the agent host carrying two tunnels
       (auto-reconnects if the link drops):
         - REVERSE -R 9222: box 127.0.0.1:9222 -> this machine's Chrome CDP.
         - FORWARD -L 7234: this machine 127.0.0.1:7234 -> the private Temporal
           frontend (temporal.parthadae.internal:7233) inside the VPC.
    3. (Optional, -StartTemporalUi) Launch the Temporal Web UI in Docker,
       pointed at the forwarded frontend. Both the local port (7234) and the
       UI port (8088) are deliberately NON-default so they don't collide with
       a local Temporal dev server (7233 / 8080).

  The Seneschal scraper agent (running on the EC2 agent host, inside the VPC)
  connects to http://127.0.0.1:9222 -> reverse tunnel -> this Chrome. Because
  it's a real, logged-in browser on a residential IP, Facebook doesn't
  challenge it.

.DESCRIPTION
  Run it once in a terminal, or register it to run at logon (see REGISTER
  below). It loops forever; Ctrl+C to stop.

.PARAMETER BoxHost
  SSH host of the agent host (Route53 A record -> EIP). Default browser.parthadae.com.

.PARAMETER RemotePort / LocalPort
  CDP port mapped on the box / listened on locally. Default 9222 both.

.PARAMETER TemporalLocalPort
  Local port that forwards to the private Temporal frontend. Default 7234
  (NOT 7233, to avoid clashing with a local Temporal dev server).

.PARAMETER StartTemporalUi
  Also run the Temporal Web UI container (temporalio/ui) pointed at the
  forwarded frontend. Requires Docker Desktop running.

.PARAMETER TemporalUiPort
  Host port the Temporal Web UI listens on. Default 8088 (NOT 8080, to avoid
  clashing with a local Temporal UI). Open http://localhost:<port>.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\fb-agent-tunnel.ps1

.EXAMPLE
  # Also bring up the Temporal Web UI at http://localhost:8088
  powershell -ExecutionPolicy Bypass -File .\fb-agent-tunnel.ps1 -StartTemporalUi

.NOTES
  REGISTER AT LOGON (so it survives reboots), run once in an elevated shell:

    $action  = New-ScheduledTaskAction -Execute "powershell.exe" `
      -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PWD\fb-agent-tunnel.ps1`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $set     = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName "FbAgentTunnel" -Action $action -Trigger $trigger -Settings $set

  To confirm the box sees your Chrome:
    ssh ubuntu@browser.parthadae.com "curl -s http://127.0.0.1:9222/json/version"

  Temporal CLI against the forwarded frontend:
    temporal --address localhost:7234 task-queue describe --task-queue browser-box
#>

[CmdletBinding()]
param(
  [string]$BoxHost            = "browser.parthadae.com",
  [string]$BoxUser            = "ubuntu",
  [int]   $RemotePort         = 9222,
  [int]   $LocalPort          = 9222,
  [string]$ProfileDir         = "$env:USERPROFILE\fb-scrape-profile",
  [string]$SshKey             = "$env:USERPROFILE\.ssh\id_ed25519",
  [string]$StartUrl           = "https://www.facebook.com/marketplace/",
  [string]$TemporalRemoteHost = "temporal.parthadae.internal",
  [int]   $TemporalRemotePort = 7233,
  [int]   $TemporalLocalPort  = 7234,
  [switch]$StartTemporalUi,
  [int]   $TemporalUiPort     = 8088,
  [string]$TemporalUiImage    = "temporalio/ui:latest"
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

function Ensure-TemporalUi {
  if (-not $StartTemporalUi) { return }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Log "WARNING: -StartTemporalUi set but 'docker' not found; skipping UI."
    return
  }
  $name = "seneschal-temporal-ui"
  # Native docker writes benign messages to stderr, which $ErrorActionPreference
  # = 'Stop' would escalate to a terminating error. Localize it to 'Continue'
  # and gate on $LASTEXITCODE instead.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $running = (& docker ps --filter "name=^/$name$" --format "{{.Names}}" 2>$null | Select-Object -First 1)
    if ($running -eq $name) {
      Write-Log "Temporal UI already running at http://localhost:$TemporalUiPort"
      return
    }
    # Only remove a leftover container if one actually exists (avoids the
    # "No such container" stderr noise).
    $exists = (& docker ps -a --filter "name=^/$name$" --format "{{.Names}}" 2>$null | Select-Object -First 1)
    if ($exists -eq $name) {
      & docker rm -f $name 2>$null | Out-Null
    }
    # The UI connects to the forwarded frontend via host.docker.internal, which
    # Docker Desktop maps to the host loopback where -L binds $TemporalLocalPort.
    $dockerArgs = @(
      "run", "-d", "--rm",
      "--name", $name,
      "-p", "$TemporalUiPort`:8080",
      "-e", "TEMPORAL_ADDRESS=host.docker.internal:$TemporalLocalPort",
      "-e", "TEMPORAL_UI_PORT=8080",
      $TemporalUiImage
    )
    & docker @dockerArgs 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Log "Temporal UI up at http://localhost:$TemporalUiPort (namespace: default)"
    } else {
      Write-Log "WARNING: failed to start Temporal UI container (docker exit $LASTEXITCODE)."
    }
  } finally {
    $ErrorActionPreference = $prev
  }
}

Write-Log "fb-agent-tunnel starting. Box=$BoxUser@$BoxHost"
Write-Log "  reverse -R box:$RemotePort -> local Chrome CDP :$LocalPort"
Write-Log "  forward -L local:$TemporalLocalPort -> ${TemporalRemoteHost}:$TemporalRemotePort"

Ensure-TemporalUi

while ($true) {
  try {
    Ensure-Chrome

    # -N: no remote command. ExitOnForwardFailure: die if either bind fails
    # (e.g. a stale forward still holds a port) so we retry cleanly.
    #   -R : box CDP  -> local Chrome (Facebook scraping)
    #   -L : local    -> private Temporal frontend (for the UI / CLI)
    $sshArgs = @(
      "-N",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-i", $SshKey,
      "-R", "$RemotePort`:127.0.0.1:$LocalPort",
      "-L", "$TemporalLocalPort`:$TemporalRemoteHost`:$TemporalRemotePort",
      "$BoxUser@$BoxHost"
    )
    Write-Log "Opening tunnels (reverse CDP + forward Temporal)..."
    & ssh @sshArgs
    Write-Log "Tunnels exited (code $LASTEXITCODE). Reconnecting in 5s..."
  }
  catch {
    Write-Log "Error: $($_.Exception.Message). Retrying in 5s..."
  }
  Start-Sleep -Seconds 5
}
