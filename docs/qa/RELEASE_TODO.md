# Checklist rilis VALORANT Montage Studio

**Versi awal:** 0.1.11-qa.2 · **Status:** NOT READY untuk rilis publik.

Matriks terakhir berisi 72 pemeriksaan lulus dalam cakupan uji, 22 belum tuntas, dan 6 kemampuan belum tersedia. Build QA lokal dan proyek lama menjadi pembanding. Catat versi build, hasil, dan lokasi bukti sebelum mencentang tugas. Jalankan ulang tes yang terkait setelah setiap perubahan.

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

- [ ] Uji impor beberapa file berbeda, rekaman berdurasi panjang, variasi frame rate, footage VFR, dan resolusi campuran. Periksa proxy, timestamp, konsumsi memori/disk, dan pemutaran hasil ekspor. Bandingkan hasil dengan dan tanpa video referensi yang sama. **C02, C06, C07, C11.**
- [ ] Jalankan alur lengkap dari build produksi melalui UI untuk draft otomatis dan edit manual. Uji ekspor native 1080p60 melalui dialog Windows serta montage 1440p144 berdurasi penggunaan nyata. Cek frame yang benar-benar didekode, frame berulang di luar fade, bingkai hitam, timestamp, selisih audio/video, dan integritas file. Ulangi setelah batal render dan setelah membuka ulang proyek. **I03, I04, I07.**
- [ ] Uji RIFE pada materi yang mendukung interpolasi dan ulangi dengan model atau runtime tidak tersedia. Cek perubahan frame serta laporan jalur pemrosesan. Tangani kegagalan dengan pesan yang jelas atau opsi fallback sesuai profil. Ukur slow motion, reverse, transisi, exposure, dan RGB dari frame hasil render dengan kondisi efek aktif dan nonaktif. **H07, H08, J05.**
- [ ] Validasi urutan, durasi, dan hasil pengaturan gaya serta prioritas beat dengan perbandingan sebelum/sesudah. Uji musik hilang, rusak, terlalu pendek, dan footage tanpa audio. Periksa track dan marker musik di timeline, sinkronisasi dari AAC yang sudah didekode, gain, ducking, efek bunyi, dan limiter. Jalankan kasus sengaja clipping untuk membuktikan QA menangkap masalah. **E06, E07, F08, F09, G09, J03.**
- [ ] Tinjau ulang enam peringatan render lima kill. Bedakan tembakan yang timing-nya tidak bisa diukur dari efek yang benar-benar salah frame. Periksa ulang pada rekaman dengan suara dan gambar yang lebih jelas. Bandingkan tahap yang masih berbeda dari upstream dan dokumentasikan perbedaan yang dipertahankan. **J04, J06.**

Bukti yang dibutuhkan berupa MP4, JSON/HTML QA, dan pengukuran frame serta audio. Angka 144 FPS pada metadata hanya memverifikasi format. Bukti interpolasi harus berasal dari pemrosesan dan pemeriksaan frame.

## 4. Selesaikan QA pemakaian sehari-hari dan AI

- [ ] Uji startup mode pengembangan, lalu fokuskan penerimaan pengguna pada build produksi. Gunakan proyek terisi untuk menguji jendela sempit dan lebar, skala tampilan Windows, teks panjang, tombol kandidat kill, keyboard, menu, fokus dialog, Escape, notifikasi, progres, dan pembatalan. Simpan screenshot sebelum dan sesudah jika ada perbaikan. **A03, A05–A08.**
- [ ] Uji alur AI dengan respons tiruan untuk izin, model/effort, batas per proyek, respons tidak valid, dan fallback lokal. Uji login dan permintaan nyata hanya setelah ada persetujuan yang diperlukan. Jika verifikasi akun belum bisa dilakukan, keluarkan AI dari klaim rilis dan pastikan pengguna dapat menyelesaikan montage lokal dari awal hingga ekspor. Media mentah tetap diproses lokal. **F03–F06.**
- [ ] Putuskan status setiap fitur yang belum tersedia. Jika masuk cakupan rilis, implementasikan dan uji di UI. Jika ditunda, catat di release notes dan pindahkan ke backlog dengan ID yang sama. **B08** hapus proyek dengan konfirmasi, **E05** pemutar musik terpisah, **G03** split klip, **G05** zoom timeline, **I05** pemilihan encoder CPU/GPU, **J08** lirik/cover/preset vertikal.

## 5. Uji installer, jalankan beta, lalu putuskan rilis

- [ ] Buat kandidat Windows x64 dengan nomor versi yang sama di aplikasi dan installer. Tetapkan versi Windows yang didukung serta cara memasang atau mendeteksi prasyarat FFmpeg, Python, dan RIFE. Installer harus diuji pada Windows bersih tanpa konfigurasi pengembangan. Uji startup, instalasi baru, upgrade dari versi lama, uninstall, dan rollback. Pastikan upgrade menjaga proyek dan pengaturan pengguna. **A01, A02, A09.**
- [ ] Siapkan installer yang ditandatangani untuk distribusi publik, checksum SHA-256, release notes, dan langkah pemasangan serta pemulihan. Verifikasi berkas distribusi sama dengan yang diuji.
- [ ] Jalankan regresi lengkap terhadap kandidat, dengan media lokal dan proyek audit terpisah dari proyek pengguna. Simpan log, screenshot, dan render. Ulangi skenario utama pada mesin atau profil Windows bersih.

  ```powershell
  .\scripts\qa-app.ps1 -Gameplay 'C:\QA\gameplay.mp4' -Music 'C:\QA\music.mp3' -Artifacts 'C:\QA\hasil-rc1' -ReviewedProject 'C:\QA\reviewed.vmsproj.json' -TestRecovery
  ```

- [ ] Jalankan beta terbatas dengan kandidat yang sama. Minta peserta menjalankan impor, review kill, preview, ekspor, dan buka ulang proyek. Catat temuan yang bisa direproduksi dan uji ulang perbaikannya pada kandidat berikutnya.
- [ ] Tandai **READY** dan distribusikan hanya jika seluruh skenario inti pada build produksi lulus, nol P0/P1 dalam cakupan rilis, efek dan beat sudah diverifikasi dari render, installer serta upgrade lulus, dan setiap peringatan atau fitur yang ditunda tercatat. Simpan build sebelumnya untuk rollback.

[Matriks QA](FULL_QA_TEST_MATRIX.md) · [Status kesiapan](RELEASE_READINESS.md) · [Cara menjalankan regresi](REGRESSION_TEST_REPORT.md)
