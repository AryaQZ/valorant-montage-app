# Release Notes · VALORANT Montage Studio `0.1.11-rc.1` (Windows x64 Candidate)

**Status:** Kandidat rilis beta terbatas / QA (**NOT READY** untuk distribusi publik — installer belum ditandatangani Authenticode dan uji Windows bersih tanpa lingkungan pengembangan serta beta terbatas masih diperlukan sebelum rilis publik).

## 1. Cakupan Rilis v1 (Lokal-Pertama)

`0.1.11-rc.1` memfokuskan rilis perdana Windows pada alur montage lokal penuh dari awal hingga ekspor tanpa bergantung pada akun cloud:

- **Perlindungan & pemulihan proyek (Tahap 1):** proyek baru, simpan, Save As (termasuk spasi & Unicode), path relatif/absolut, autosave atomik, tombol pulihkan autosave, relink gameplay/musik/referensi gaya tanpa kehilangan timestamp/beat grid/offset, serta pemulihan crash & pembersihan berkas parsial.
- **Review kill & timeline (Tahap 2):** deteksi kandidat kill lokal (`kills_auto.py` + fallback replay), preview cuplikan terisolasi, tombol **Abaikan** & pulihkan kandidat persisten per proyek, penandaan manual, tambah/hapus/urutkan/trim klip, keyframe zoom, speed ramp, reverse, undo/redo, serta pemeliharaan ancang-ancang kill terakhir dan banner ACE.
- **Render, musik, efek, & QA output (Tahap 3):**
  - Jalur manual `2560 × 1440 @ 144 FPS` & `60 FPS` (termasuk sumber campuran CFR/VFR, cancel & render ulang).
  - Jalur draft otomatis / native `1920 × 1080 @ 60 FPS` (RIFE v4.25 optical flow, efek exposure + chromatic RGB split + `bwhip`, sinkronisasi beat dari AAC hasil decode).
  - Perbaikan Tahap 3: normalisasi PTS `fade` pasca-`tmix`, path MP4 final di laporan `.qa.json`/`.qa.html`, validasi model RIFE (`flownet.bin` + `flownet.param`) & pesan fallback yang jelas, zero-shift `motion_blur`, dan `adelay :all=1` stereo untuk impact SFX.
- **Pemakaian sehari-hari & transparansi UX (Tahap 4):**
  - Impor multi-file nyata, tata letak responsif & skala DPI (`820×680`–`1920×1040`, `100%–150%`), guard shortcut keyboard (`Ctrl+Z/Y/Shift+Z/S` aman input teks/angka, modal `<dialog>`, dan status `busy`), fokus modal & `Escape`, toast + progress bar + tombol `Cancel` render di UI.
  - Label opsi AI diperjelas menjadi *Pindai lokal + urutkan via AI (metadata)* dengan indikator jatah proyek dan pesan error transparan.

## 2. Prasyarat Windows x64 & Deteksi Otomatis

| Komponen | Persyaratan | Cara deteksi / pemasangan |
| --- | --- | --- |
| **Sistem operasi** | Windows 10 / Windows 11 64-bit (`x64`) | Diperiksa oleh installer x64 |
| **FFmpeg & FFprobe** | Wajib untuk impor, proxy, analisis musik, render, dan QA (harus mendukung `libx264`) | Studio memeriksa `PATH` saat startup; jika tidak ada, lencana menampilkan **`FFMPEG REQUIRED`** dengan pesan diagnostik jelas. Pasang build Windows FFmpeg (`libx264`) dan tambahkan folder `bin` ke `PATH`. |
| **Python 3.11+** | Wajib untuk worker media lokal (`services/worker`) | Studio menjalankan `python -m services.worker` (atau override `VMS_PYTHON`). |
| **Runtime upstream (opsional)** | Python `3.11` dengan `numpy`, `opencv`, `scipy`, dan `rife-ncnn-vulkan-python` | Diperlukan untuk deteksi kill otomatis lokal, analisis attack musik terukur, dan RIFE v4.25. Pasang lewat `scripts\setup-upstream.ps1`. Tanpa runtime ini, penandaan manual dan fallback FFmpeg tetap berjalan dengan peringatan jelas. |

## 3. Batasan, Peringatan Diketahui, & Fitur yang Dikeluarkan dari Klaim v1

- **Installer belum ditandatangani (unsigned):** Windows SmartScreen akan menampilkan peringatan penerbit tidak dikenal sampai sertifikat code-signing dikonfigurasi untuk rilis publik.
- **Akun ChatGPT nyata (`F03`) dikeluarkan dari klaim rilis v1:** Alur AI telah diuji dengan simulator lokal (`F04–F06`), namun verifikasi login akun ChatGPT nyata belum dijalankan. Seluruh alur utama Studio bekerja 100% lokal tanpa login. Perhatikan juga bahwa `apps/desktop/vendor/siwc-devkit` menggunakan **OpenAI Noncommercial License 1.0** (lihat `THIRD_PARTY_NOTICES.md`).
- **Peringatan QA native & batasan upstream yang tercatat:**
  - Kontrol 5-kill native membawa 6 peringatan QA (`0/6` efek salah frame; seluruhnya terkait keterukuran sumber `478p` terkompresi / ayunan drum lagu).
  - Skrip upstream `draft_ref_timeline.py` mewajibkan durasi draft `>= 8 dtk` dan membatasi jarak 2-kill `<= 7,0 dtk` (sehingga draft native terpisah cocok untuk `3+` kill); pada subset 3-kill teramati 1 frame `stall` sebelum `bwhip`.
  - Interupsi mendadak tepat di antara penulisan sidecar QA dan publikasi MP4 masih berada di luar jendela uji crash saat ini.

## 4. Fitur Ditunda ke Backlog Pasca-v1 (Keputusan Tahap 4)

Enam fitur berikut **belum tersedia** di `0.1.11-rc.1` dan resmi ditunda ke backlog dengan ID matriks QA tetap:

- **`B08`** — Hapus proyek dengan konfirmasi dari dalam aplikasi.
- **`E05`** — Pemutar musik terpisah (musik saat ini diputar melalui preview montage).
- **`G03`** — Split klip langsung di timeline.
- **`G05`** — Kontrol zoom skala timeline (terpisah dari zoom jendela).
- **`I05`** — Pemilihan encoder CPU/GPU (jalur manual saat ini mengunci CPU `libx264` demi determinisme).
- **`J08`** — Alur lirik, cover art, dan preset vertikal `9:16` dari upstream.

## 5. Verifikasi Checksum, Pemasangan, Upgrade, Uninstall, & Rollback

### Artefak & Checksum SHA-256

- **Installer kanonik (uji penuh `qa-app.ps1`):** `VALORANT-Montage-Studio-0.1.11-rc.1-Windows-x64.exe`
- **Ukuran:** `125.760.356` byte (`119,93 MB`)
- **SHA-256:** `A07AC46F4033243801C305A23359862457F9524FB302E45FF12A1DC18244BAF5`
- **Signature Authenticode:** `NotSigned` *(unsigned RC untuk QA/beta internal)*

Verifikasi berkas sebelum memasang di PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 .\VALORANT-Montage-Studio-0.1.11-rc.1-Windows-x64.exe
```

### Langkah Pemasangan, Upgrade, & Pemulihan (Rollback)

1. **Instalasi baru / Upgrade:** Jalankan `VALORANT-Montage-Studio-0.1.11-rc.1-Windows-x64.exe` (atau silent `/S /D=<folder>`). Upgrade di folder yang sama memperbarui biner aplikasi dan resource worker tanpa menghapus proyek, autosave, atau pengaturan pengguna di `%APPDATA%\VALORANT Montage Studio`.
2. **Backup sebelum upgrade:** Simpan salinan proyek `.vmsproj.json` penting dan simpan installer versi sebelumnya (`0.1.11-qa.3` atau portable `0.1.11-qa.2`) untuk rollback cepat.
3. **Rollback:** Tutup aplikasi, lalu jalankan kembali installer versi sebelumnya ke folder instalasi yang sama. Data pengguna dan proyek di `%APPDATA%\VALORANT Montage Studio` tetap utuh.
4. **Uninstall:** Jalankan `Uninstall VALORANT Montage Studio.exe` dari Settings → Installed Apps atau folder instalasi. Uninstall menghapus biner aplikasi dan entri registry tanpa menghapus file media asli maupun proyek pengguna.
