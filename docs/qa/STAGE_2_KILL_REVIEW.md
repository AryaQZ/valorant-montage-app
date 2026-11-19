# Tahap 2 · Review kill dan timeline

## Kasus replay lima kill

Pemindaian lokal baru menghasilkan enam kandidat. Lima cocok dengan tembakan yang sudah ditinjau pada frame sumber 1452, 1540, 1710, 1832, dan 2130. Kandidat tambahan ada pada frame 2076 atau 00:34,60. Pendeteksi menemukan perubahan amunisi dan muzzle flash pada frame tambahan. Bukti tembakan tersebut belum membuktikan kill atau kepemilikannya.

Kandidat yang tidak cocok dengan hasil review sebelumnya masih ditawarkan agar editor bisa memeriksa cuplikannya. Pada kasus ini, batas cuplikan kill terakhir sebelumnya juga memakai frame 2076 sebagai pembatas. Akibatnya bagian ancang-ancang berkurang walau kandidat itu belum pernah dikonfirmasi.

## Perubahan di 0.1.11-qa.4

- **Abaikan** menyimpan keputusan untuk rekaman dan kandidat yang dipilih. Kandidat tersebut keluar dari daftar review, permintaan review AI, dan perhitungan batas cuplikan. Pemindaian tetap memakai bukti asli dari worker.
- **Tampilkan kembali kandidat** mengembalikan kandidat yang pernah diabaikan untuk rekaman aktif. Undo editor juga dapat membatalkan keputusan.
- Keputusan diabaikan ikut disimpan dalam file proyek. Proyek lama tanpa data tersebut tetap dapat dimuat. Pengabaian tidak mengubah klip yang sudah diedit secara otomatis.

## Reproduksi

Tambahkan `-TestKillReview` pada perintah `scripts/qa-app.ps1` yang memakai replay WhatsApp 39 detik yang sama. Tes ini membutuhkan FFmpeg, FFprobe, dan runtime upstream. Hasilnya ditulis ke `kill-review-evidence.json`. Skenario menunggu pemindaian pertama, mengabaikan kandidat, memulihkannya, menyimpan dan membuka proyek, memindai lagi, lalu menambahkan lima kill yang sudah ditinjau ke timeline.

## Hasil kasus pertama

- Dalam editor dari paket Windows 0.1.11-qa.4, awal cuplikan 00:35,50 kembali dari 00:35,05 ke 00:33,50 setelah kandidat ekstra diabaikan. Batas akhir tetap 00:36,75.
- Tombol pemulihan mengembalikan kandidat, lalu keputusan mengabaikan ulang tersimpan. Proses Studio baru membuka proyek, menjalankan pemindaian sungguhan, dan menampilkan lima kandidat yang masih perlu ditinjau.
- Kelima kandidat dikonfirmasi dan ditambahkan melalui UI. File proyek menyimpan lima interval yang masing-masing berisi satu frame tembakan terverifikasi yang berbeda. Hash gameplay asli cocok.
- Tes kasus pertama menilai batas cuplikan dan timeline yang disimpan.

## Verifikasi penutup

- Menghapus satu highlight utama dari klip gabungan sebelumnya menghapus seluruh klip. Di paket pembanding, hasilnya tiga klip. Setelah perbaikan, ada empat klip dan shot kedua di klip gabungan tetap tersimpan. Aplikasi memilih ulang anchor dari impact yang tersisa dan menyesuaikan trim dengan batas highlight tersebut.
- UI paket Windows menyimpan urutan ID yang sama setelah urutan diubah, klip dilepas, undo/redo dicoba, dan klip ditambah kembali. Scrub dan playback berhenti pada 26,916667 detik. Setelah trim ke 24,97 detik, impact 25,666667 detik dan keyframe zoom 1,05 tersimpan. File video rusak membuat detektor menampilkan error dan tetap mempertahankan empat klip serta lima highlight. Anotasi manual dengan waktu, tag Headshot dan Multikill, dan kepemilikan Belum yakin berhasil disimpan.
- Pada dua rekaman pembanding, pemeriksaan piksel kill feed menemukan kecocokan pola headshot 0,901 dan 0,912. Ini memeriksa adanya cue pada baris feed. Kepemilikan dan kecocokan shot dengan baris yang tampil memerlukan konfirmasi. Pipeline worker pada cuplikan pembanding menghasilkan satu kandidat low yang tetap meminta review kepemilikan, tanpa label headshot otomatis. Angka ini tidak digunakan sebagai statistik akurasi detektor.
- Ekspor baru melalui dialog Windows dari aplikasi memakai draft lima kill yang sudah ditinjau dan sampel RIFE yang sudah diperiksa. Hasil 1920 × 1080 pada 60 FPS mendekode 718 frame. Shot terakhir cocok dengan frame sumber 2130, memakai 108 frame konteks sebelumnya, dan template ACE ditemukan pada 67 frame. Selisih beat terbesar yang diukur dari AAC hasil dekode adalah 9,03 ms. QA mencatat nol error dan enam peringatan, termasuk flash dan onset yang belum bisa diukur untuk sebagian tembakan.
- Lulus 63 tes Python dan 16 tes desktop. Pengujian ini menyelesaikan tahap 2 pada skenario dan rekaman di atas. Pengukuran akurasi pada koleksi berlabel yang lebih besar dan rilis publik berada di luar hasil ini.

Untuk mengulang pengukuran cue gunakan `scripts/qa-headshot-cue.py <rekaman> <hasil.json> --start <detik> --duration <detik>` dengan Python yang memiliki OpenCV dan NumPy. Script membaca bingkai lewat FFmpeg lokal, lalu menyimpan waktu dan skor.
