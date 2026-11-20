# Tahap 5 · Kandidat Installer Windows x64 (`0.1.11-rc.1`) & Regresi Penuh

Tahap 5 menyiapkan kandidat rilis **`0.1.11-rc.1`** dengan nomor versi selaras di aplikasi dan installer NSIS x64, menjalankan siklus penuh installer Windows (instalasi baru, upgrade, rollback, uninstall, dan diagnostik prasyarat), serta mengeksekusi regresi penuh end-to-end melalui `scripts/qa-app.ps1`.

**Status rilis publik tetap `NOT READY`** sampai tiga gerbang eksternal selesai: (1) uji pada mesin/VM Windows bersih tanpa lingkungan pengembangan, (2) penandatanganan Authenticode untuk distribusi publik, dan (3) beta terbatas dengan pengguna. Kandidat `0.1.11-rc.1` **siap untuk uji beta internal/terbatas (unsigned)** dengan prasyarat yang terdokumentasi di [RELEASE_NOTES_0.1.11-rc.1.md](../RELEASE_NOTES_0.1.11-rc.1.md).

## 1. Artefak Build & Checksum SHA-256

- **Versi kandidat:** `0.1.11-rc.1` (selaras di `apps/desktop/package.json`, `package-lock.json`, judul jendela `VALORANT Montage Studio · Versi 0.1.11-rc.1`, metadata PE `FileVersion`, registry Uninstall `DisplayVersion`, dan nama installer).
- **Installer kanonik (diverifikasi end-to-end oleh `qa-app.ps1`):**
  - Path lokal: `artifacts/stage5-rc1/qa-rc1/release/VALORANT-Montage-Studio-0.1.11-rc.1-Windows-x64.exe`
  - Ukuran: `125.760.356` byte (`119,93 MB`)
  - SHA-256: `A07AC46F4033243801C305A23359862457F9524FB302E45FF12A1DC18244BAF5` (`SHA256SUMS.txt` tersedia di folder yang sama)
  - Status Authenticode: `NotSigned` *(belum ada sertifikat code-signing terpasang)*
- **Installer uji siklus NSIS (`artifacts/stage5-rc1/release/`):**
  - Ukuran: `125.760.444` byte · SHA-256: `452B012AABD199C250BB93D0D0E7CF67E6A22420917D16FD1E5E5EC485C6213E`
- **Pembanding versi sebelumnya (rollback):** `artifacts/handover/builds/0.1.11-qa.3/VALORANT-Montage-Studio-0.1.11-qa.3-Windows-x64.exe` (`125.757.966` byte, SHA-256 `1CF10C31CD31B0700BE2389BAAD0CB8DD26A3A64702776A822AF322BFB064C4C`).

## 2. Siklus Installer NSIS & Diagnostik Prasyarat (`artifacts/stage5-rc1/stage5-installer-evidence.json`)

Diujikan pada Windows 11 Home x64 (`10.0.26300`) ke direktori instalasi terpisah (`artifacts/stage5-rc1/installed-app`), dengan pencadangan & verifikasi SHA-256 seluruh 16 berkas pengguna (`ai-settings.json` + 15 file `autosave/*.vmsproj.json`) dan shortcut Desktop:

| Langkah | Hasil | Bukti Aktual |
| --- | --- | --- |
| **Instalasi baru (`0.1.11-qa.3`)** | **PASS** | Exit code `0`, PE `FileVersion = 0.1.11-qa.3`, registry Uninstall `DisplayVersion = 0.1.11-qa.3`. |
| **Upgrade in-place (`→ 0.1.11-rc.1`)** | **PASS** | Exit code `0`, PE `FileVersion = 0.1.11-rc.1`, registry `DisplayVersion = 0.1.11-rc.1`; seluruh 10 berkas bundel (`app.asar`, worker, `flownet.bin` + `flownet.param`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, lisensi SIWC & upstream, perbaikan Tahap 3 SFX `:all=1` & guard RIFE) hadir; **16/16 hash data pengguna identik**. |
| **Peluncuran biner terinstal `0.1.11-rc.1`** | **PASS** *(catatan sesi)* | Proses biner terinstal berjalan stabil tanpa crash; judul jendela versi `VALORANT Montage Studio · Versi 0.1.11-rc.1` diverifikasi langsung di dalam Electron oleh seluruh 8 fase `qa-app.ps1`. |
| **Diagnostik prasyarat (PATH tanpa FFmpeg)** | **PASS** | Worker bundel melaporkan `media.available = false`, `diagnostic = "FFmpeg, FFprobe tidak ditemukan di PATH."` (tidak crash). |
| **Rollback (`→ 0.1.11-qa.3`)** | **PASS** | Exit code `0`, PE & registry kembali ke `0.1.11-qa.3`, **16/16 hash data pengguna identik**. |
| **Uninstall bersih** | **PASS** | Exit code `0`, biner & entri registry Uninstall terhapus bersih, **16/16 hash data pengguna tetap utuh**. |
| **Perlindungan shortcut Desktop** | **PASS** | Shortcut `%USERPROFILE%\Desktop\VALORANT Montage Studio.lnk` dipulihkan identik (SHA-256 `EF074328...`, target tetap `win-unpacked-0.1.11-qa.2`). |

## 3. Regresi Penuh Kandidat `0.1.11-rc.1` (`scripts/qa-app.ps1`)

Perbaikan kecil kompatibilitas Windows PowerShell 5.1 diterapkan di `scripts/qa-app.ps1` (helper `Invoke-Logged` untuk redirect stderr native CLI, UTF-8 tanpa BOM lewat `[IO.File]::WriteAllText`, dan `$null = $p.Handle` agar `$p.ExitCode` terisi pada fase crash `37`).

Perintah eksekusi:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\qa-app.ps1 `
  -Gameplay "artifacts\handover\fixtures\WhatsApp Video 2026-11-18 at 23.05.09.mp4" `
  -Music "artifacts\handover\fixtures\Megan_Trainor_-_Untouchable..._(mp3.pm).mp3" `
  -Artifacts "artifacts\stage5-rc1\qa-rc1" `
  -ReviewedProject "artifacts\stage5-rc1\reviewed-abs.vmsproj.json" `
  -TestRecovery -TestKillReview
```

Seluruh fase selesai dengan **`exit code 0`** (`artifacts/stage5-rc1/qa-rc1/`):
- **Build & Tes Otomatis**: `npm run build` lulus, **67 tes Python** lulus, `tsc --noEmit` lulus, **20 tes desktop (`vitest`)** lulus.
- **Paket & UI Produksi (`0.1.11-rc.1`)**: `ui-evidence.json` (`finished: true`), `restart-evidence.json` (`finished: true`).
- **Pemulihan & Crash**: `recovery-evidence.json` (`finished: true`), `crash-idle` (exit `37`, worker ikut berhenti), `crash-render` (exit `37`, parsial teramati, MP4 terputus tidak dipublikasikan), `after-crash-evidence.json` (`finished: true`, parsial terhapus, SHA-256 ekspor sebelumnya utuh).
- **Review Kill & Timeline**: `kill-review-evidence.json` (`finished: true`), `timeline-evidence.json` (`finished: true`).
- **Ekspor Native 5-Kill `1080p60`**: `native/native-1080p60.mp4` mendekode tepat **`718` frame (`1920×1080 @ 60/1 FPS`)**, `0` error QA, dan 6 peringatan yang sama seperti audit Tahap 3.
- **Integritas Media Sumber**: hash SHA-256 gameplay dan musik diverifikasi tidak berubah sepanjang seluruh fase.

## 4. Gerbang Tersisa Sebelum Status Publik `READY`

1. **Mesin/VM Windows bersih (`A01`)**: ulangi instalasi NSIS, deteksi prasyarat tanpa `.build-tools`, dan skenario inti pada profil/VM Windows bersih tanpa lingkungan pengembangan.
2. **Code signing & lisensi distribusi**: tandatangani installer dengan sertifikat Authenticode untuk distribusi publik dan tinjau cakupan **OpenAI Noncommercial License 1.0** pada `apps/desktop/vendor/siwc-devkit` (`THIRD_PARTY_NOTICES.md`) sebelum distribusi komersial.
3. **Beta terbatas**: jalankan beta terbatas dengan kandidat `0.1.11-rc.2` (impor, review kill, preview, ekspor, buka ulang proyek) dan catat temuan yang bisa direproduksi.

## 5. Pembaruan Kandidat `0.1.11-rc.2` (Python Bundel, Ikon Kustom, & Paket ZIP GitHub)

- **Runtime Python 3.11 dibundel (`scripts/prepare-bundled-python.ps1`, `apps/desktop/electron/worker-python.ts`):** biner `VALORANT Montage Studio.exe` (`0.1.11-rc.2`) diverifikasi meluncur tanpa Python di `PATH` (`PATH = C:\Windows\System32;C:\Windows`) dan dengan `PYTHONHOME` rusak; proses anak `resources\python\python.exe` berjalan otomatis, melayani `GET /v1/capabilities`, lalu berhenti bersih saat aplikasi ditutup (`artifacts/stage5-rc2/bundled-python-evidence.json`).
- **Banner prasyarat FFmpeg & ikon kustom:** saat FFmpeg tidak ada di `PATH`, `.prereq-banner` tampil jelas (`FFMPEG REQUIRED`, perintah `winget install -e --id Gyan.FFmpeg`, `rootOverflowX = 0`, tombol `Periksa ulang` merespons langsung; `artifacts/stage5-rc2/prereq-banner-evidence.json`). Ikon multi-resolusi `apps/desktop/build/icon.ico` & `icon.png` terpasang tanpa peringatan default icon.
- **Paket ZIP & GitHub Releases:** `VALORANT-Montage-Studio-0.1.11-rc.2-Windows-x64.zip` (`134.832.886` byte, SHA-256 `F297CF260C6FEE8610CD3C7E16FE44CEA4204874BD8A4B54ABF3E551E2601F11`) dan workflow `.github/workflows/windows-release.yml` disiapkan agar siapa saja dapat mengunduh satu `.zip` dari halaman GitHub Releases, mengekstrak, memasang, dan langsung memakai aplikasi.
- **Regresi akhir RC2:** **67 tes Python** + `tsc --noEmit` + **24 tes desktop** (termasuk 4 tes baru `electron/worker-python.test.ts`) lulus. Lihat [RELEASE_NOTES_0.1.11-rc.2.md](../RELEASE_NOTES_0.1.11-rc.2.md).
