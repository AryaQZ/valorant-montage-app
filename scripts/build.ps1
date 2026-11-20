$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 22.12.0 or newer is required. Run scripts\setup.ps1 first.' }
$nodeVersion = [version]((& node -p 'process.versions.node').Trim())
if ($nodeVersion -lt [version]'22.12.0') { throw "Node.js 22.12.0 or newer is required; found $nodeVersion." }
& (Join-Path $PSScriptRoot 'prepare-bundled-python.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare bundled Python runtime.' }
Set-Location -LiteralPath (Join-Path $repoRoot 'apps\desktop')
& npm.cmd run package:win
if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed.' }
& (Join-Path $PSScriptRoot 'package-release-zip.ps1') -ReleaseDir (Join-Path (Get-Location) 'release')
if ($LASTEXITCODE -ne 0) { throw 'Release ZIP packaging failed.' }
Write-Host "Installer and downloadable ZIP output are in $(Join-Path (Get-Location) 'release')." -ForegroundColor Green
