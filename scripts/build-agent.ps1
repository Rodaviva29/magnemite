<#
.SYNOPSIS
  Cross-compiles the agent and packages the Magisk module.

.DESCRIPTION
  Everything runs inside the golang image, so no Go toolchain is needed on the
  machine doing the build.

  Pass -Server and -Token to bake a config.json into the module zip: flashing
  it then enrolls the box on first boot with no shell work per device.

.EXAMPLE
  ./scripts/build-agent.ps1

.EXAMPLE
  ./scripts/build-agent.ps1 -Server https://magnemite.example.com -Token <enrollment token>
#>
param(
    [string]$Version = "0.1.0",
    [string]$Server = "",
    [string]$Token = "",
    [switch]$SkipModule
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$goImage = "golang:1.23-alpine"

Write-Host "Building agent $Version"
$buildScript = @'
set -e
mkdir -p bin
build() {
  os=$1; arch=$2; extra=$3; out=$4
  echo "  $out"
  env CGO_ENABLED=0 GOOS=$os GOARCH=$arch $extra \
    go build -trimpath -ldflags "-s -w -X main.version=VERSION" -o "bin/$out" ./cmd/magnemite-agent
}
build linux   arm64 ""       magnemite-agent-linux-arm64
build linux   arm   GOARM=7  magnemite-agent-linux-arm
build linux   amd64 ""       magnemite-agent-linux-amd64
build windows amd64 ""       magnemite-agent-windows-amd64.exe
ls -la bin
'@ -replace "VERSION", $Version

docker run --rm -v "${root}/agent:/src" -w /src $goImage sh -c $buildScript
if ($LASTEXITCODE -ne 0) { throw "agent build failed" }

if ($SkipModule) { return }

# --- Magisk module ---------------------------------------------------------
$staging = Join-Path $root "dist/module"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force -Path "$staging/bin" | Out-Null

Copy-Item "$root/magisk-module/*" $staging -Recurse
Copy-Item "$root/agent/bin/magnemite-agent-linux-arm64" "$staging/bin/"
Copy-Item "$root/agent/bin/magnemite-agent-linux-arm" "$staging/bin/"

# Keep module.prop's version in step with the binary it ships.
$prop = Get-Content "$staging/module.prop" -Raw
$prop = $prop -replace "version=.*", "version=v$Version"
Set-Content -Path "$staging/module.prop" -Value $prop -NoNewline

if ($Server -and $Token) {
    Write-Host "Baking enrollment config for $Server into the zip"
    $config = @{ serverUrl = $Server; enrollmentToken = $Token } | ConvertTo-Json
    Set-Content -Path "$staging/config.json" -Value $config -NoNewline
} elseif ($Server -or $Token) {
    throw "-Server and -Token must be given together"
}

$zipPath = Join-Path $root "dist/magnemite-agent-$Version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }
# Compress-Archive would give the entries CRLF-unfriendly paths on some hosts;
# zip inside the container keeps the layout Magisk expects.
docker run --rm -v "${root}/dist:/work" -w /work alpine sh -c "apk add --no-cache zip >/dev/null && cd module && zip -r ../magnemite-agent-$Version.zip . -x '.*' && chmod 0644 ../magnemite-agent-$Version.zip"
if ($LASTEXITCODE -ne 0) { throw "module packaging failed" }

Remove-Item -Recurse -Force $staging
Write-Host ""
Write-Host "Module: $zipPath"
Write-Host "Flash it with the Magisk app, or: adb push <zip> /data/local/tmp/ && su -c 'magisk --install-module /data/local/tmp/<zip>'"
if (-not $Server) {
    Write-Host "No config baked in — write /data/adb/magnemite/config.json on the box before rebooting."
}
