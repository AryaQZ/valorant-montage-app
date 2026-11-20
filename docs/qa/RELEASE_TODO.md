# Checklist rilis VALORANT Montage Studio

**Versi awal:** 0.1.11-qa.2 · **Status:** NOT READY untuk rilis publik.

Matriks terakhir berisi 92 pemeriksaan lulus dalam cakupan uji, 2 belum tuntas (`A01` installer bersih & `F03` login akun ChatGPT nyata), dan 6 kemampuan belum tersedia. Build QA lokal dan proyek lama menjadi pembanding. Catat versi build, hasil, dan lokasi bukti sebelum mencentang tugas. Jalankan ulang tes yang terkait setelah setiap perubahan.

**Usulan cakupan rilis Windows pertama:** impor lokal, review kill, edit timeline, preview, ekspor 1080p60 dan 1440p144, simpan proyek, dan pemulihan. AI dapat ditawarkan jika alur akun sudah tervalidasi dan pemrosesan lokal tetap berfungsi saat AI tidak tersedia. Putuskan cakupan fitur tambahan sebelum menyiapkan kandidat rilis.

## 1. Lindungi proyek dan pulihkan pekerjaan

- [x] Uji proyek baru, simpan, Save As, buka ulang, proyek lama, JSON rusak, serta path relatif dan absolut dengan spasi dan Unicode. Verifikasi file proyek dan autosave yang tepat dibuka kembali. **B01, B11.**
- [x] Paksa aplikasi dan worker berhenti, masing-masing saat editor aktif dan saat render berjalan. Buka ulang proyek, pulihkan autosave, cek perubahan terakhir yang sudah tersimpan, lalu ulangi render. Verifikasi file keluaran yang sudah ada tetap utuh dan file parsial tidak muncul sebagai hasil selesai. **A10.**
- [x] Uji file gameplay, musik, dan referensi gaya yang dipindah. Sediakan jalur pemulihan untuk media yang belum bisa disambungkan ulang. Pastikan relink mempertahankan timestamp, klip, dan pengaturan musik. **B09.** Perbandingan hasil gaya referensi tetap ada di tahap 3, **C11**.

Lulus pada 0.1.11-qa.3, termasuk tes crash saat FFmpeg menulis file, pemulihan autosave, dan render ulang. [Bukti dan perintah uji tahap 1](STAGE_1_PROJECT_RECOVERY.md)

## 2. Benahi deteksi kill dan timeline

Tahap 2 lulus untuk satu replay lima kill, cuplikan pembanding, dan proyek fixture untuk kegagalan detektor. [Bukti review kill, timeline, dan ekspor](STAGE_2_KILL_REVIEW.md)

- [x] Ukur hasil lokal terhadap lima kill yang sebelumnya ditinjau. Enam kandidat meliputi satu tembakan berlebih. Uji dua shot rapat dalam satu klip dan cek cue headshot pada rekaman pembanding. Ukur kepemilikan hanya pada kill yang tersedia buktinya. **D03, D04.**
- [x] Uji **Cari kill otomatis → Lihat cuplikan → Konfirmasi → Masukkan ke montage** dan pengabaian serta pemulihan kandidat. Buka proyek, scan ulang, lalu verifikasi lima klip memiliki impact berbeda. Ekspor baru mempertahankan aksi terakhir dan ACE. **D07, D08.**
- [x] Uji kegagalan detektor dengan MP4 rusak dan jalur penandaan manual. Klip dan anotasi sesi sebelumnya tetap bisa diakses. **D10.**
- [x] Uji tambah, hapus, urutkan, trim, putar, geser posisi putar, ubah keyframe zoom dan efek, serta undo/redo. Simpan dan buka kembali proyek, lalu verifikasi range edit dan anchor. **G01, G04, G06, G07, G10.**

## 3. Buktikan render, musik, dan kualitas output

Tahap 3 lulus dalam cakupan uji worker lokal dan verifikasi independen FFprobe/FFmpeg dengan 5 perbaikan bug (`tmix` fade timing, `qa["file"]`, validasi model RIFE `flownet.bin`/`flownet.param` & preflight, zero-shift `motion_blur`, dan stereo `adelay :all=1` impact SFX). [Bukti dan pengukuran tahap 3](STAGE_3_RENDER_AUDIO_QA.md)

- [x] Uji impor beberapa file berbeda, rekaman berdurasi panjang, variasi frame rate, footage VFR, dan resolusi campuran. Periksa proxy, timestamp, konsumsi memori/disk, dan pemutaran hasil ekspor. Bandingkan hasil dengan dan tanpa video referensi yang sama. **C06, C07, C11.** *(Catatan: multi-select dialog UI paket **C02** tetap dibuka untuk tahap 4.)*
- [x] Jalankan alur lengkap untuk draft otomatis dan edit manual. Uji ekspor native 1080p60 serta montage 1440p144 berdurasi penggunaan nyata (`20,17 s` / `2904` frame, 3 sumber campuran). Cek frame yang benar-benar didekode, frame berulang di luar fade, bingkai hitam, timestamp, selisih audio/video, dan integritas file. Ulangi setelah batal render dan setelah membuka ulang proyek. **I03, I04, I07.**
- [x] Uji RIFE pada materi yang mendukung interpolasi (`0,25×` gerak gameplay nyata) dan ulangi dengan model kosong, model parsial, atau runtime tidak tersedia. Cek perubahan frame serta laporan jalur pemrosesan. Tangani kegagalan dengan pesan yang jelas atau opsi fallback sesuai profil. Ukur slow motion, reverse, transisi, exposure, dan RGB dari frame hasil render dengan kondisi efek aktif dan nonaktif. **H07, H08, J05.**
- [x] Validasi urutan, durasi, dan hasil pengaturan gaya serta prioritas beat dengan perbandingan sebelum/sesudah. Uji musik hilang, rusak, terlalu pendek, dan footage tanpa audio. Periksa track dan marker musik, sinkronisasi dari AAC yang sudah didekode, gain, ducking, efek bunyi, dan limiter. Jalankan kasus sengaja clipping (`0,0 dBFS`) untuk membuktikan QA menangkap masalah (`FAIL`). **E06, E07, F08, F09, G09, J03.**
- [x] Tinjau ulang enam peringatan render lima kill. Bedakan tembakan yang timing-nya tidak bisa diukur dari efek yang benar-benar salah frame (`0/6` salah frame). Periksa ulang pada rekaman `1080p` dengan gambar/suara lebih jelas. Bandingkan tahap yang masih berbeda dari upstream dan dokumentasikan perbedaan yang dipertahankan. **J04, J06.**

Bukti tersimpan di `artifacts/stage3-*` berupa MP4, JSON/HTML QA, dan pengukuran frame serta audio independen (67 tes Python dan 16 tes desktop lulus). Uji paket UI interaktif & akun tetap dilanjutkan di tahap 4.

## 4. Selesaikan QA pemakaian sehari-hari dan AI

Pengujian UI paket produksi (`A03, A05–A08, C02`) dan alur AI simulasi lokal (`F04–F06`) lulus dengan 1 perbaikan bug shortcut keyboard/modal (`shared/shortcuts.ts`, 67 tes Python dan 20 tes desktop lulus). Login akun nyata (`F03`) tetap `BLOCKED` menunggu persetujuan pengguna, dan 6 fitur belum tersedia menunggu keputusan cakupan rilis. [Bukti dan hasil tahap 4](STAGE_4_UI_AI_QA.md)

- [x] Uji startup mode pengembangan (`A03`), lalu fokuskan penerimaan pengguna pada build produksi. Gunakan proyek terisi untuk menguji impor multi-file nyata (`C02`), jendela sempit dan lebar (`820×680`–`1920×1040`), skala tampilan Windows (`100%–150%`), teks panjang, tombol kandidat kill, keyboard (`Ctrl+Z/Y/Shift+Z/S` aman input & modal), menu OS, fokus dialog, Escape, notifikasi, progres, dan tombol `Cancel` render UI. **A03, A05–A08, C02.**
- [x] Uji alur AI dengan respons tiruan lokal untuk izin/consent, model/effort + persistensi restart, batas 5 permintaan per proyek, triage kandidat kill, respons tidak valid, dan fallback lokal (`F04–F06`, nol kebocoran path/media/kredensial). Login dan permintaan akun nyata (**F03**) tetap **BLOCKED** menunggu persetujuan; alur lokal penuh tanpa login tetap berfungsi dari impor hingga ekspor.
- [x] Putuskan status setiap fitur yang belum tersedia. **Keputusan pemilik proyek (Tahap 4):** seluruh 6 fitur ditunda ke backlog pasca-v1 dan dicatat di release notes dengan ID yang sama — **B08** hapus proyek dengan konfirmasi, **E05** pemutar musik terpisah, **G03** split klip, **G05** zoom timeline, **I05** pemilihan encoder CPU/GPU, **J08** lirik/cover/preset vertikal. Fitur AI akun nyata (**F03**) juga dikeluarkan dari klaim rilis v1 (fokus rilis lokal penuh).

## 5. Uji installer, jalankan beta, lalu putuskan rilis

Kandidat Windows x64 **`0.1.11-rc.1`** sudah dibangun, diuji siklus NSIS (instalasi baru `0.1.11-qa.3`, upgrade in-place ke `0.1.11-rc.1`, diagnostik prasyarat tanpa FFmpeg, rollback, uninstall bersih dengan 16/16 data pengguna utuh), dan lulus regresi penuh `scripts/qa-app.ps1 -TestRecovery -TestKillReview -ReviewedProject` (`exit code 0`, 67 tes Python, 20 tes desktop, native 5-kill `718` frame). Status publik tetap **NOT READY** sampai verifikasi pada mesin Windows bersih tanpa lingkungan pengembangan, penandatanganan Authenticode, dan beta terbatas selesai. [Bukti kandidat RC1](STAGE_5_INSTALLER_RC1.md) · [Release notes RC1](../RELEASE_NOTES_0.1.11-rc.1.md)

- [ ] Buat kandidat Windows x64 dengan nomor versi yang sama di aplikasi dan installer (`0.1.11-rc.1` selesai + prasyarat FFmpeg/Python/RIFE terdokumentasi + siklus install/upgrade/rollback/uninstall lulus di workstation Windows 11 x64). **Tersisa:** ulangi instalasi & startup pada mesin/VM Windows bersih tanpa konfigurasi pengembangan. **A01, A02, A09.**
- [ ] Siapkan installer yang ditandatangani untuk distribusi publik, checksum SHA-256, release notes, dan langkah pemasangan serta pemulihan. *(Release notes, langkah pasang/rollback, dan SHA-256 `A07AC46F...` sudah siap di [RELEASE_NOTES_0.1.11-rc.1.md](../RELEASE_NOTES_0.1.11-rc.1.md); **tersisa:** sertifikat penandatanganan Authenticode dan tinjauan lisensi nonkomersial DevKit untuk distribusi publik.)*
- [ ] Jalankan regresi lengkap terhadap kandidat, dengan media lokal dan proyek audit terpisah dari proyek pengguna. Simpan log, screenshot, dan render. *(Regresi penuh `qa-app.ps1` pada `0.1.11-rc.1` sudah **lulus 100%** di workstation audit di `artifacts/stage5-rc1/qa-rc1/`; **tersisa:** pengulangan skenario utama pada mesin/profil Windows bersih.)*

  ```powershell
  .\scripts\qa-app.ps1 -Gameplay 'C:\QA\gameplay.mp4' -Music 'C:\QA\music.mp3' -Artifacts 'C:\QA\hasil-rc1' -ReviewedProject 'C:\QA\reviewed.vmsproj.json' -TestRecovery -TestKillReview
  ```

- [ ] Jalankan beta terbatas dengan kandidat yang sama (`0.1.11-rc.1`). Minta peserta menjalankan impor, review kill, preview, ekspor, dan buka ulang proyek. Catat temuan yang bisa direproduksi dan uji ulang perbaikannya pada kandidat berikutnya.
- [ ] Tandai **READY** dan distribusikan hanya jika seluruh skenario inti pada build produksi lulus, nol P0/P1 dalam cakupan rilis, efek dan beat sudah diverifikasi dari render, installer serta upgrade lulus di Windows bersih, dan setiap peringatan atau fitur yang ditunda tercatat. Simpan build sebelumnya (`0.1.11-qa.2` / `0.1.11-qa.3`) untuk rollback.

[Matriks QA](FULL_QA_TEST_MATRIX.md) · [Status kesiapan](RELEASE_READINESS.md) · [Cara menjalankan regresi](REGRESSION_TEST_REPORT.md)
