$ErrorActionPreference = 'Stop'
Write-Host '=== VALORANT Montage Studio - FFmpeg Setup ===' -ForegroundColor Cyan

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
if ($ffmpeg -and $ffprobe) {
    Write-Host "FFmpeg dan FFprobe sudah terpasang di PATH:" -ForegroundColor Green
    Write-Host "  ffmpeg : $($ffmpeg.Source)"
    Write-Host "  ffprobe: $($ffprobe.Source)"
    Write-Host 'Anda sudah siap menggunakan VALORANT Montage Studio.' -ForegroundColor Green
    exit 0
}

$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
    Write-Warning 'winget tidak ditemukan di Windows ini.'
    Write-Host 'Silakan unduh FFmpeg (build full/essentials dengan libx264) dari https://www.gyan.dev/ffmpeg/builds/ lalu tambahkan folder bin ke PATH Windows.'
    exit 1
}

Write-Host 'Memasang FFmpeg (Gyan.FFmpeg) melalui winget...' -ForegroundColor Yellow
& winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -ne 0) {
    throw "Pemasangan winget gagal (exit code $LASTEXITCODE). Coba jalankan PowerShell sebagai Administrator atau pasang FFmpeg manual dari https://www.gyan.dev/ffmpeg/builds/."
}

Write-Host ''
Write-Host 'Selesai! Tutup lalu buka ulang VALORANT Montage Studio agar FFmpeg terbaca di PATH.' -ForegroundColor Green
