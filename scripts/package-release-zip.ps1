param(
    [string]$ReleaseDir,
    [string]$OutputZip
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repoRoot = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content -LiteralPath (Join-Path $repoRoot 'apps\desktop\package.json') -Raw | ConvertFrom-Json
$version = $pkg.version

if (-not $ReleaseDir) {
    $ReleaseDir = Join-Path $repoRoot 'apps\desktop\release'
}
$ReleaseDir = [IO.Path]::GetFullPath($ReleaseDir)
$installerName = "VALORANT-Montage-Studio-$version-Windows-x64.exe"
$installerPath = Join-Path $ReleaseDir $installerName
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw "Installer not found: $installerPath"
}

if (-not $OutputZip) {
    $OutputZip = Join-Path $ReleaseDir "VALORANT-Montage-Studio-$version-Windows-x64.zip"
}
$OutputZip = [IO.Path]::GetFullPath($OutputZip)

$stageDir = Join-Path $ReleaseDir "_zip-stage-$version"
if (Test-Path -LiteralPath $stageDir) { Remove-Item -LiteralPath $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

try {
    Copy-Item -LiteralPath $installerPath -Destination $stageDir -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts\install-ffmpeg.ps1') -Destination (Join-Path $stageDir 'Install-FFmpeg.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination $stageDir -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot 'THIRD_PARTY_NOTICES.md') -Destination $stageDir -Force

    $batContent = @"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-FFmpeg.ps1"
pause
"@
    [IO.File]::WriteAllText((Join-Path $stageDir 'Install-FFmpeg.bat'), $batContent, [Text.Encoding]::ASCII)

    $installerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
    [IO.File]::WriteAllText((Join-Path $stageDir 'SHA256SUMS.txt'), "$installerHash  $installerName`r`n", [Text.Encoding]::ASCII)

    $readmeText = @"
VALORANT Montage Studio $version (Windows 10/11 64-bit)
============================================================

CARA INSTALL & PAKAI (3 LANGKAH):
1. Jalankan "$installerName" untuk memasang aplikasi.
   - Runtime Python sudah dibundel di dalam installer (tidak perlu install Python).
   - Build beta gratis ini belum ditandatangani (unsigned): jika Windows SmartScreen
     muncul, klik "More info" -> "Run anyway".
2. Jika PC Anda belum memiliki FFmpeg, klik dua kali "Install-FFmpeg.bat"
   (memasang FFmpeg via winget).
3. Buka "VALORANT Montage Studio" dari Desktop / Start Menu dan langsung edit montage!

QUICK START (ENGLISH):
1. Run "$installerName" to install (Python runtime is bundled; no Python install needed).
   If Windows SmartScreen warns about an unsigned beta build, click "More info" -> "Run anyway".
2. If FFmpeg is not yet installed on your PC, double-click "Install-FFmpeg.bat".
3. Launch "VALORANT Montage Studio" from the Desktop or Start Menu.

CHECK SHA-256:
  $installerHash  $installerName

LISENSI / LICENSE:
Gratis / nonkomersial. Lihat LICENSE dan THIRD_PARTY_NOTICES.md.
"@
    [IO.File]::WriteAllText((Join-Path $stageDir 'CARA-INSTALL-README.txt'), $readmeText, [Text.UTF8Encoding]::new($false))

    if (Test-Path -LiteralPath $OutputZip) { Remove-Item -LiteralPath $OutputZip -Force }
    [IO.Compression.ZipFile]::CreateFromDirectory($stageDir, $OutputZip, [IO.Compression.CompressionLevel]::Optimal, $false)

    $zipHash = (Get-FileHash -LiteralPath $OutputZip -Algorithm SHA256).Hash
    $zipName = Split-Path -Leaf $OutputZip
    $sumsPath = Join-Path (Split-Path -Parent $OutputZip) 'SHA256SUMS.txt'
    $sumsContent = "$zipHash  $zipName`r`n$installerHash  $installerName`r`n"
    [IO.File]::WriteAllText($sumsPath, $sumsContent, [Text.Encoding]::ASCII)

    Write-Host "Release ZIP created: $OutputZip" -ForegroundColor Green
    Write-Host "  ZIP SHA-256 : $zipHash"
    Write-Host "  EXE SHA-256 : $installerHash"
} finally {
    if (Test-Path -LiteralPath $stageDir) { Remove-Item -LiteralPath $stageDir -Recurse -Force }
}
