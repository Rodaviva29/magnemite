<#
.SYNOPSIS
  Runs N simulated Android TV boxes against the hub.

.DESCRIPTION
  Each fake agent enrolls, connects, heartbeats and runs the real install
  pipeline — real download, real .apkm extraction — with only `pm`, `dumpsys`
  and `getprop` stubbed out. That makes it the honest way to check that the
  scheduler, the concurrency cap and the dashboard hold up at fleet scale
  before touching 200 real boxes.

.EXAMPLE
  ./scripts/fake-fleet.ps1 -Count 200 -Token <enrollment token>

.EXAMPLE
  # Make every commit fail once, to exercise the uninstall fallback everywhere
  $env:MAGNEMITE_FAKE_COMMIT_ERROR = "INSTALL_FAILED_UPDATE_INCOMPATIBLE"
  $env:MAGNEMITE_FAKE_COMMIT_ERROR_ONCE = "1"
  ./scripts/fake-fleet.ps1 -Count 20 -Token <enrollment token>
#>
param(
    [int]$Count = 10,
    [string]$Server = "http://localhost:3001",
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$StateDir = ".dev/fleet",
    [switch]$Reset
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$binary = Join-Path $root "agent/bin/magnemite-agent-windows-amd64.exe"
if (-not (Test-Path $binary)) {
    throw "Agent binary not found at $binary. Build it first: ./scripts/build-agent.ps1"
}

if ($Reset -and (Test-Path $StateDir)) {
    Remove-Item -Recurse -Force $StateDir
}
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

Write-Host "Starting $Count fake devices against $Server"
$procs = @()

for ($i = 1; $i -le $Count; $i++) {
    $serial = "fake-{0:D3}" -f $i
    $config = Join-Path $StateDir "$serial.json"

    $args = @(
        "-fake-root",
        "-fake-serial", $serial,
        "-config", $config,
        "-server", $Server
    )
    # The token is only needed until a device has one of its own.
    if (-not (Test-Path $config)) {
        $args += @("-enroll-token", $Token)
    }

    $log = Join-Path $StateDir "$serial.log"
    $procs += Start-Process -FilePath $binary -ArgumentList $args `
        -RedirectStandardOutput $log -RedirectStandardError "$log.err" `
        -NoNewWindow -PassThru

    # Enrollment is a write per device; a small stagger keeps the burst honest
    # without making the test take all day.
    Start-Sleep -Milliseconds 50
}

$pidFile = Join-Path $StateDir "pids.txt"
$procs.Id | Out-File -Encoding ascii $pidFile

Write-Host ""
Write-Host "$($procs.Count) agents running. Logs: $StateDir/*.log"
Write-Host "Stop them with:"
Write-Host "  Get-Content $pidFile | ForEach-Object { Stop-Process -Id `$_ -ErrorAction SilentlyContinue }"
