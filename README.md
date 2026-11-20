# VALORANT Montage Studio

**Editor montage gameplay VALORANT lokal untuk Windows 10/11 (64-bit).**  
Proses video, deteksi kandidat kill, sinkronisasi beat musik, efek impact, dan laporan QA sepenuhnya berjalan lokal di PC Anda—tanpa mengunggah rekaman ke cloud dan tanpa mengakses proses game atau anti-cheat.

---

## Download & Install (Pengguna Windows)

> **Tidak perlu install Python.** Runtime worker Python 3.11 sudah dibundel langsung di dalam installer Windows.

1. Buka halaman **[GitHub Releases](https://github.com/AryaQZ/valorant-montage-app/releases)** dan unduh paket **`VALORANT-Montage-Studio-<versi>-Windows-x64.zip`** terbaru.
2. Ekstrak file `.zip`, lalu jalankan **`VALORANT-Montage-Studio-<versi>-Windows-x64.exe`** untuk memasang aplikasi.
   - *Catatan beta gratis (unsigned):* Jika muncul peringatan Windows SmartScreen (*"Windows protected your PC"*), verifikasi checksum di `SHA256SUMS.txt`, lalu klik **More info → Run anyway**.
3. Jika PC Anda belum memiliki **FFmpeg**, klik dua kali **`Install-FFmpeg.bat`** di dalam folder hasil ekstrak (memasang FFmpeg via `winget`), lalu buka **VALORANT Montage Studio** dari Desktop atau Start Menu.
4. *(Opsional — untuk deteksi kill otomatis lokal & RIFE slow-motion 1080p60)*: jalankan `scripts\setup-upstream.ps1` jika Anda ingin memasang runtime RIFE Vulkan opsional.

---

## Fitur Utama (`0.1.11-rc.2`)

- **100% Lokal & Non-Destruktif:** Rekaman gameplay dan musik tetap di perangkat Anda; proyek disimpan sebagai JSON tervalidasi dengan autosave otomatis, pemulihan crash, dan relink media hilang.
- **Review Kill & Timeline:** Deteksi kandidat kill lokal atau penandaan manual, preview cuplikan terisolasi, tombol **Abaikan** kandidat ekstra, urutan klip drag-and-drop, trim, speed ramp, reverse replay, serta pemeliharaan ancang-ancang kill terakhir dan banner **ACE**.
- **Sinkronisasi Musik & Efek Terverifikasi:** Analisis waveform/beat lokal, ducking musik otomatis, impact SFX stereo, limiter anti-clipping, efek zoom/flash/shake/motion blur/transisi, serta laporan QA `.qa.html` & `.qa.json` dari hasil decode aktual.
- **Dua Jalur Ekspor:**
  - **Manual (`2560 × 1440` @ `144 FPS` / `60 FPS`)**: kontrol penuh klip, trim, dan efek di timeline.
  - **Draft Otomatis / Native (`1920 × 1080` @ `60 FPS`)**: penjadwalan beat terukur, RIFE v4.25, efek native, dan gerbang QA upstream.

---

## Untuk Pengembang (Build dari Source)

### Prasyarat Build
- Windows 10/11 x64
- Node.js `22.12+`, Python `3.11+`, Git, serta FFmpeg & FFprobe (`libx264`) di `PATH`

### Menjalankan Mode Pengembangan & Tes
```powershell
.\scripts\setup.ps1
.\scripts\dev.ps1
.\scripts\test.ps1
```

### Membangun Installer + ZIP Siap Distribusi
```powershell
.\scripts\build.ps1
```
Skrip ini otomatis menyiapkan runtime Python bundel (`scripts\prepare-bundled-python.ps1`), membangun aplikasi Electron, membuat installer NSIS x64, dan mengemas **`VALORANT-Montage-Studio-<versi>-Windows-x64.zip`** beserta `Install-FFmpeg.bat` dan `SHA256SUMS.txt` di `apps\desktop\release\`.

Untuk merilis langsung ke **GitHub Releases**, cukup push tag versi (misalnya `git tag v0.1.11-rc.2 && git push origin v0.1.11-rc.2`) — workflow [windows-release.yml](.github/workflows/windows-release.yml) akan otomatis membangun, menjalankan tes, dan mengunggah file `.zip` & `.exe` ke halaman Releases.

---

## Batasan & Lisensi

- **Gratis / Nonkomersial:** Modul opsional Sign in with ChatGPT DevKit (`apps/desktop/vendor/siwc-devkit`) menggunakan **OpenAI Noncommercial License 1.0**. Fitur akun ChatGPT nyata (`F03`) dikeluarkan dari klaim rilis v1; seluruh alur montage bekerja penuh secara lokal tanpa login. Lihat [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Fitur ditunda ke backlog pasca-v1:** `B08` (hapus proyek), `E05` (pemutar musik terpisah), `G03` (split klip), `G05` (zoom skala timeline), `I05` (pilihan encoder CPU/GPU), dan `J08` (lirik/cover/preset vertikal).
- Lihat [Release Notes RC2](docs/RELEASE_NOTES_0.1.11-rc.2.md), [Matriks QA](docs/qa/FULL_QA_TEST_MATRIX.md), [Checklist Rilis](docs/qa/RELEASE_TODO.md), dan [Arsitektur](docs/architecture.md).
