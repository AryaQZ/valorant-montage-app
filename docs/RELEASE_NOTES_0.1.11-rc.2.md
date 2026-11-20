# Release Notes · VALORANT Montage Studio `0.1.11-rc.2` (Windows x64 Beta Candidate)

**Status:** Kandidat beta publik Windows x64 (gratis / nonkomersial, unsigned). Seluruh alur montage lokal dari impor hingga ekspor telah lulus regresi, **runtime Python 3.11 kini dibundel langsung di dalam installer** (pengguna tidak perlu memasang Python), dan aplikasi memakai ikon kustom baru.

## Yang Baru di `0.1.11-rc.2`

1. **Bundel Runtime Worker Python 3.11 (Tanpa Install Python):**
   - Installer Windows x64 kini membundel runtime CPython `3.11` terisolasi (`resources/python/python.exe` dengan `python311._pth`, mengabaikan `PYTHONHOME`/registry yang bentrok). Pengguna cukup memasang installer tanpa perlu menginstal Python di Windows.
   - Lisensi Python Software Foundation (`PSF-2.0`) disertakan di `resources/licenses/PYTHON-PSF-LICENSE.txt` dan tercatat di [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
2. **Banner Prasyarat FFmpeg & Skrip 1-Klik (`Install-FFmpeg.bat`):**
   - Jika FFmpeg/FFprobe belum terpasang di `PATH`, Studio menampilkan banner panduan jelas dengan tombol **Salin perintah** (`winget install -e --id Gyan.FFmpeg`) dan **Periksa ulang** tanpa crash.
   - Paket ZIP rilis menyertakan `Install-FFmpeg.bat` / `Install-FFmpeg.ps1` untuk memasang FFmpeg sekali klik.
3. **Ikon Aplikasi Kustom:**
   - Ikon multi-resolusi (`16–256 px`, `apps/desktop/build/icon.ico` & `icon.png`) diterapkan pada executable, jendela aplikasi, taskbar, installer NSIS, dan uninstaller.
4. **Paket ZIP Siap Unduh & GitHub Actions Release:**
   - Skrip [package-release-zip.ps1](../scripts/package-release-zip.ps1) dan workflow [.github/workflows/windows-release.yml](../.github/workflows/windows-release.yml) menghasilkan satu file `.zip` siap unduh dari halaman GitHub Releases (`VALORANT-Montage-Studio-0.1.11-rc.2-Windows-x64.zip`).

## Artefak & Checksum SHA-256 (Build Lokal RC2)

- **Paket ZIP (direkomendasikan untuk beta tester):** `VALORANT-Montage-Studio-0.1.11-rc.2-Windows-x64.zip`
  - Ukuran: `134.832.886` byte (`128,59 MiB`)
  - SHA-256: `F297CF260C6FEE8610CD3C7E16FE44CEA4204874BD8A4B54ABF3E551E2601F11`
- **Installer NSIS x64:** `VALORANT-Montage-Studio-0.1.11-rc.2-Windows-x64.exe`
  - Ukuran: `134.835.648` byte (`128,59 MiB`)
  - SHA-256: `59FB2D31D004BD538ED76A9DEF660B5C23E6E42BC92F330C7912ADF869F22574`
- **Signature Authenticode:** `NotSigned` *(beta gratis unsigned; klik **More info → Run anyway** pada prompt SmartScreen setelah memverifikasi SHA-256)*.

*(Catatan: build otomatis dari GitHub Actions saat tag `v0.1.11-rc.2` di-push akan menyertakan `SHA256SUMS.txt` sendiri untuk biner yang dibangun di runner `windows-latest`.)*

## Cara Install & Mulai Pakai (3 Langkah)

1. Unduh dan ekstrak **`VALORANT-Montage-Studio-0.1.11-rc.2-Windows-x64.zip`**.
2. Jalankan **`VALORANT-Montage-Studio-0.1.11-rc.2-Windows-x64.exe`** untuk memasang aplikasi (tidak perlu install Python).
3. Jika FFmpeg belum terpasang di PC Anda, klik dua kali **`Install-FFmpeg.bat`**, lalu buka **VALORANT Montage Studio**.

## Cakupan, Batasan, & Fitur Ditunda (Tetap Sama seperti RC1)

- **Gratis / Nonkomersial:** `siwc-devkit` berlisensi **OpenAI Noncommercial License 1.0**; fitur akun ChatGPT nyata (`F03`) dikeluarkan dari klaim v1 (seluruh alur utama 100% lokal).
- **Fitur ditunda ke backlog pasca-v1:** `B08` (hapus proyek), `E05` (pemutar musik terpisah), `G03` (split klip), `G05` (zoom skala timeline), `I05` (pilihan encoder CPU/GPU), dan `J08` (lirik/cover/preset vertikal).
- Lihat juga [RELEASE_NOTES_0.1.11-rc.1.md](RELEASE_NOTES_0.1.11-rc.1.md) dan [STAGE_5_INSTALLER_RC1.md](qa/STAGE_5_INSTALLER_RC1.md) untuk rincian peringatan QA native dan langkah rollback.
