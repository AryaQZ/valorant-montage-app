# Pembelajaran editing VALORANT dan penerapannya di Studio

Perubahan ini berlaku pada alur native **Generate draft → Director → Export**. Buka **Inspector → Referensi gaya** untuk memilih video contoh lokal bila diperlukan. Impor rekaman dan musik, tinjau kandidat di **Find kills**, lalu jalankan **Generate draft**. Director menampilkan nomor kill, posisi aksen, dan frame untuk meninjau setup, impact, serta konfirmasi. Frame setup dan konfirmasi adalah titik tinjau dari timeline.

| Pembelajaran dari v3–v9 | Penerapan di Studio |
| --- | --- |
| Analisis MP3 berjalan setelah FFmpeg dan Python digunakan secara lokal. | FFmpeg membaca media dan alat upstream mengekstrak tempo serta posisi attack secara numerik. Venv librosa dipakai untuk audit pembanding eksperimen. Worker memakai analisis numerik upstream yang sudah tersedia. |
| Replay feed dapat punya lebih banyak kill daripada hasil deteksi otomatis. Ammo step dalam satu spray juga bisa mendahului peluru yang membunuh. | Generate draft memperlihatkan bahwa hasil otomatis adalah kandidat dan melaporkan yang belum punya bukti impact. Highlight yang dipilih harus punya bukti upstream. Pemeriksaan draft membandingkan urutan serta frame sumber dan meminta persis satu posisi output per impact terpilih. |
| v5 dan v6 mendekatkan attack ke frame, tetapi pilihan aksennya masih terasa tidak konsisten. Potongan musik yang bertumpuk di v5 juga menimbulkan gangguan fase. | Planner mencari kick atau snare berulang yang kuat, satu untuk tiap kill independen. Ia memeriksa lagi waktu asli tiap aksen. Musik diputar pada 1×. Jika pola teratur tak muat, Director menjelaskan penggunaan aksen terukur dengan jarak fleksibel. Rangkaian dekat atau yang dikelompokkan pengguna tetap satu take, dan draft yang memecahnya perlu ditinjau ulang sebelum export. |
| v7 memberi pola musikal yang lebih mudah diikuti. Empat kill mengikuti empat snare pada posisi yang sama di empat birama. | Director menampilkan jenis ketukan, jarak beat, dan jumlah impact yang berhasil dicocokkan. Gambar memakai frame 60 FPS terdekat dengan attack, dengan lead visual nol dan shot asli terikat pada frame sumber. |
| Referensi Lalala menunjukkan pentingnya buildup, area bidik yang terbaca, dan perubahan visual yang singkat. V8 mencoba penanda target, lalu v9 menghapus penanda itu sesuai feedback. | Gerak awal take membantu memilih cut langsung, whip, atau roll. Pada cut langsung, blur keluar juga dinonaktifkan selama dua frame sebelumnya. Referensi opsional memberi prioritas roll dan durasi fade pada native export. Pendekatan dan perlambatan tetap menggunakan peta waktu upstream dan RIFE. Penanda review tampil di Director. |
| v4 mengangkat suara konfirmasi dari gameplay, dan snare harus tetap jelas saat tembakan. | Mixer menonjolkan bagian tonal gameplay setelah onset, merendahkan musik sesaat setelah attack, lalu memulihkannya dengan fade. Lapisan dipersingkat ketika kill berikutnya dekat. QA mencatat layer yang benar-benar dipakai dan tingkat kepastian onset aslinya. |
| Preview pendek v7 terasa punya ekor layar hitam terlalu panjang. | Draft membawa target layar hitam sekitar 0,25 detik dan fade pendek, disesuaikan pembulatan pada ketukan dan ruang bagi aksi terakhir. |

## Batas yang terukur

- Accent grid referensi yang sudah mencampur musik dan gameplay bisa ambigu. Studio memakai hasil visual referensi untuk transisi dan fade. Penempatan kill memakai musik proyek.
- Review manual selama eksperimen mengoreksi tiga anchor di dua rekaman ini. Deteksi otomatis tetap butuh review manusia untuk menjamin cakupan raw. Perubahan ini juga tidak memasukkan donor tembakan yang dipilih manual khusus untuk kill terakhir di v7.
- Audio konfirmasi berasal dari ekor gameplay yang disaring, jadi suara game yang bertumpuk masih mungkin ikut terdengar. Output QA membedakan onset yang terukur dengan estimasi.
- Native export memakai 1920 × 1080 pada 60 FPS. Preview dan export manual mempertahankan jalur tersendiri. Draft native lama bisa dibuka menggunakan konfigurasi asalnya. Generate draft menerapkan style baru dan membuat ID draft baru.

## Verifikasi implementasi

- Worker Studio membuat draft lalu menjalankan job Export pada dua rekaman asli, Blinding Lights, dan referensi Lalala. Draft memasangkan empat impact dengan empat snare pada pola empat birama berurutan. Selisih attack terhadap frame terdekat mencapai maksimum 6,99 ms.
- Penyelarasan diperiksa pada 469 frame di 1080p60 dengan dekode penuh. Render memakai satu frame asli untuk mencegah kilatan muncul sebelum impact pada sumber yang diinterpolasi. Shutter slow motion membantu meratakan gerakan setelah tembakan.
- Mix memakai lagu pada 1× dan empat lapisan suara konfirmasi. Gate memberi **0 error dan 5 peringatan**, termasuk onset tembakan terakhir yang masih memakai estimasi serta dua muzzle flash yang belum terukur otomatis.
- 52 tes Python, 11 tes desktop, pemeriksaan TypeScript, serta build Electron lulus. Installer lokal Windows x64 dibangun dengan worker yang sama.
