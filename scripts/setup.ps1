$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) { throw 'Git for Windows is required to initialize the pinned third-party submodules.' }
& $git.Source -C $repoRoot submodule update --init --recursive
if ($LASTEXITCODE -ne 0) { throw 'Pinned third-party dependency checkout failed.' }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 22.12.0 or newer is required. Install Node.js, then run this script again.' }
$nodeVersion = [version]((& node -p 'process.versions.node').Trim())
if ($nodeVersion -lt [version]'22.12.0') { throw "Node.js 22.12.0 or newer is required; found $nodeVersion." }

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw 'Python 3.11 or newer is required.' }
$pythonVersion = (& python -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])').Trim()
if ([version]$pythonVersion -lt [version]'3.11.0') { throw "Python 3.11 or newer is required; found $pythonVersion." }
Write-Host "Node.js $nodeVersion | Python $pythonVersion"

Set-Location -LiteralPath (Join-Path $repoRoot 'apps\desktop')
& npm.cmd install
if ($LASTEXITCODE -ne 0) { throw 'npm dependency installation failed.' }

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe -ErrorAction SilentlyContinue)) {
    Write-Warning 'FFmpeg and FFprobe are required for video import, previews, music analysis and export. Install a Windows FFmpeg build with libx264 and add its bin folder to PATH.'
} else {
    Write-Host 'FFmpeg and FFprobe found on PATH.' -ForegroundColor Green
}
Write-Host 'Setup complete. Run scripts\dev.ps1 to open the desktop editor.' -ForegroundColor Green
