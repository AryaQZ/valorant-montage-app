$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 22.12.0 or newer is required. Run scripts\setup.ps1 first.' }
$nodeVersion = [version]((& node -p 'process.versions.node').Trim())
if ($nodeVersion -lt [version]'22.12.0') { throw "Node.js 22.12.0 or newer is required; found $nodeVersion." }
Set-Location -LiteralPath (Join-Path $repoRoot 'apps\desktop')
& npm.cmd run package:win
if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed.' }
Write-Host "Installer output is in $(Join-Path (Get-Location) 'release')." -ForegroundColor Green
