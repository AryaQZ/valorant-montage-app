# Tahap 1 · Perlindungan proyek dan pemulihan

**Kandidat Windows:** 0.1.11-qa.3 · **Hasil tahap:** PASS dalam cakupan pemulihan yang diuji. Pengujian memakai profil, proyek, dan keluaran audit terpisah. Shortcut Desktop saat ini menunjuk 0.1.11-qa.2.

## Reproduksi

- Pada 0.1.11-qa.2, `Rekaman – relatif.mp4` di folder proyek ditandai hilang. Dialog buka proyek sebelumnya memeriksa path absolut saja.
- Setelah proses Python dihentikan, panggilan berikutnya gagal dengan `The local media worker is not connected`. Studio tidak membuat worker baru setelah proses lama berhenti.
- Saat membuka file proyek lama dengan ID yang sama, autosave terjadwal dari proses pembukaan proyek dapat menggantikan snapshot yang lebih baru.
- Saat pemulihan lagu, durasi MP3 yang diukur dari audio hasil decode adalah 79,909660 dtk dan durasi kontainernya 79,921633 dtk. Perbandingan persis kedua angka sempat menolak salinan yang identik.
- Uji awal pemantauan worker lewat stdin membuat FFmpeg Windows macet saat membaca frame untuk QA. Reproduksi terpisah mengisolasi konflik antara pembacaan pipe oleh worker dan FFmpeg. Pemantauan akhir memakai masa hidup proses Desktop.

## Perubahan

- Path relatif gameplay, musik, dan referensi ditafsirkan terhadap lokasi file proyek. Path dijadikan absolut saat proyek dibuka agar pemrosesan dan autosave memakai lokasi yang sama.
- Relink musik mempertahankan beat grid dan offset. Impor baru menyimpan SHA-256 berkas. Proyek lama tanpa hash memakai ukuran asli jika tersedia dan toleransi 100 ms untuk selisih durasi decode dan kontainer. Relink referensi memeriksa bahwa video dapat dibaca.
- Membuka proyek saja tidak memicu penulisan autosave. Penulisan snapshot untuk ID proyek yang sama diantrikan dan diterbitkan melalui file sementara. Status autosave lama tidak menimpa status proyek yang sedang dibuka.
- Permintaan berikutnya menyalakan worker baru setelah worker gagal. Render yang terputus dilaporkan ke editor. Studio mencoba membersihkan file parsial yang terdaftar untuk proses tersebut. Worker memantau masa hidup proses Desktop dan membatalkan render saat proses induknya berhenti.

## Ulangi pengujian

```powershell
.\scripts\qa-app.ps1 -Gameplay 'C:\QA\gameplay.mp4' -Music 'C:\QA\music.mp3' -Artifacts 'C:\QA\stage-1' -TestRecovery
```

Gunakan folder artefak baru. Pengujian crash menghentikan proses milik profil audit dan mengecek file asli melalui hash.

## Bukti hasil

- Build paket Windows, 63 tes Python, dan 15 tes desktop lulus. QA editor juga lulus untuk impor, Save As, pembukaan kembali, preview, dan ekspor 1440p144 singkat.
- Path relatif dengan spasi dan Unicode berhasil dibuka. Membuka proyek lama mempertahankan autosave yang lebih baru. Proyek baru diuji dengan pembatalan dan konfirmasi.
- File musik yang salah ditolak. Salinan lagu asli terhubung kembali dengan offset 125 ms dan beat grid yang sama. Video referensi terhubung kembali dan project fixture asal tetap utuh.
- Worker dihentikan saat editor aktif dan saat FFmpeg sedang menulis hasil. Studio membuat worker baru, membersihkan file parsial, dan berhasil merender ulang. Windows menghentikan proses turunan worker yang terputus.
- Proses Studio dihentikan mendadak setelah pemulihan proyek dan saat render sedang menulis. Studio yang baru dibuka membersihkan file parsial dari catatan render, memulihkan autosave, lalu memutar preview yang dirender ulang.
- SHA-256 rekaman dan musik asli cocok sebelum dan sesudah. SHA-256 ekspor QA yang sudah selesai juga cocok setelah skenario crash. Uji ini mencakup penghentian saat render menulis file parsial. Interupsi tepat saat publikasi beberapa file sekaligus belum diuji.
