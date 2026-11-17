$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$demoDir = Join-Path $env:TEMP 'VALORANT-Montage-Studio-Demo'
New-Item -ItemType Directory -Force -Path $demoDir | Out-Null
python scripts/generate_synthetic.py --output (Join-Path $demoDir 'synthetic-gameplay.mp4') --duration 5
Write-Host "Synthetic fixture created at $demoDir. Use Import recordings in the desktop editor to load it." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'dev.ps1')
