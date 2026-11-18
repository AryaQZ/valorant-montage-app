$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
python -m unittest discover -s tests -v
if ($LASTEXITCODE -ne 0) { throw 'Python worker tests failed.' }

$desktopDir = Join-Path $repoRoot 'apps\desktop'
Set-Location -LiteralPath $desktopDir
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 22.12.0 or newer is required to run desktop checks.' }
$nodeVersion = [version]((& node -p 'process.versions.node').Trim())
if ($nodeVersion -lt [version]'22.12.0') { throw "Node.js 22.12.0 or newer is required; found $nodeVersion." }
& npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Desktop TypeScript check failed.' }
& npm.cmd run test
if ($LASTEXITCODE -ne 0) { throw 'Desktop tests failed.' }
