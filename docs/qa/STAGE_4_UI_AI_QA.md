# Tahap 4 · QA Pemakaian Sehari-hari & Alur AI (Offline/Simulasi)

Tahap 4 memverifikasi startup mode pengembangan (`A03`), paket produksi pada proyek terisi penuh — termasuk impor multi-file nyata (`C02`), tata letak responsif & zoom skala DPI (`A05`), shortcut keyboard & menu OS (`A06`), manajemen fokus dialog modal & tombol Escape (`A07`), notifikasi toast, progress bar, serta tombol `Cancel` render di UI (`A08`) — serta alur AI opsional menggunakan endpoint simulasi lokal tanpa akun nyata maupun permintaan berbayar (`F04–F06`), sambil menjaga batas kejujuran `F03` (login akun nyata masih `BLOCKED`).

Seluruh pengujian paket menggunakan profil `userData` terisolasi dan folder artefak baru di bawah `artifacts/stage4-*`. Hash SHA-256 keenam berkas fixture di `artifacts/handover/fixtures/` diverifikasi identik sebelum dan sesudah pengujian. Tidak ada rekaman, audio, frame gameplay, proyek pengguna, atau kredensial OAuth yang dikirim ke model maupun GitHub.

## Lingkungan & Regresi

- **Base commit**: `2dea4014a99b7704b931b1d332ad3f22e3c55910` (branch `dev`, kandidat kode `0.1.11-qa.4` + perbaikan Tahap 3 & 4; shortcut Desktop tetap di `0.1.11-qa.2`)
- **Toolchain lokal**: Node `22.12.0` (`.build-tools/node-v22.12.0-win-x64`), Python `3.12.5` (worker), Python `3.11` (`.build-tools/upstream-venv` + RIFE v4.25), FFmpeg/FFprobe `9.0.2-full_build`.
- **Regresi akhir**: **67 tes Python** (`python -m unittest discover -s tests -v`), `tsc --noEmit`, dan **20 tes desktop** (`vitest`, termasuk 4 tes baru di `apps/desktop/shared/shortcuts.test.ts`) lulus.

## Kasus 4.1A · Startup Mode Pengembangan (`A03`)

- **Runner & bukti**: `artifacts/stage4-case1-ui-sweep/run_a03_dev_startup.mjs`, `a03-dev-startup-evidence.json`, `a03-dev-startup-verified.json`.
- **Hasil**:
  - `npm.cmd run dev` (`electron-vite dev`) membangun `dist-electron/main` dan `dist-electron/preload`, menjalankan Vite dev server di `http://localhost:5173/` (`HTTP 200`, `869` byte, memuat judul `VALORANT Montage Studio`).
  - Electron meluncur tanpa crash, menyalakan worker Python dari root repo, memuat renderer Vite, dan mengirim `GET /v1/capabilities` ke worker (`2026-11-20 08:27:53,992 INFO GET /v1/capabilities`).
  - Catatan teknis: pada Windows, `app.getPath('appData')` menggunakan `SHGetKnownFolderPath` alih-alih env `APPDATA`, sehingga mode dev standar menulis log worker ke `%APPDATA%\VALORANT Montage Studio\logs\worker.log` (tanpa mengubah proyek atau pengaturan pengguna); seluruh uji paket QA tetap meng-override `app.setPath('userData', ...)` ke profil artefak terisolasi.

## Kasus 4.1B · Sweep UI Paket Produksi pada Proyek Terisi (`C02, A05, A06, A07, A08`)

- **Build uji**: unpacked production bundle terisolasi (`electron-builder --win dir --x64`) di `artifacts/stage4-case1-ui-sweep/` (reproduksi awal) dan `artifacts/stage4-case1-ui-sweep-retest/` (verifikasi pasca-perbaikan).
- **Impor multi-file nyata (`C02`)**:
  - Satu panggilan dialog `Import gameplay recordings` memilih **3 rekaman nyata berbeda**: `WhatsApp Video 2026-11-18 at 23.05.09.mp4` (`848×478`, `CFR / unknown`), `VALORANT   2026-11-14 22-44-09.mp4` (`1920×1080`, `VFR`), dan `VALORANT   2026-11-14 22-45-26.mp4` (`1920×1080`, `VFR`).
  - Ketiga kartu muncul dengan thumbnail, metadata durasi/resolusi/codec/VFR, dan toast `"3 rekaman masuk ke Media Library."`. Impor ulang path duplikat (termasuk beda kapitalisasi huruf) mempertahankan jumlah `3` dengan toast `"Rekaman sudah ada di Media Library."`.
- **Tata letak responsif & zoom skala DPI pada proyek terisi (`A05`)**:
  - Ruang kerja diisi penuh: `3` rekaman nyata, musik `Megan_Trainor_-_Untouchable..._(mp3.pm).mp3` (waveform + beat markers + nama file panjang), `4` kandidat kill aktif di panel review, `2` highlight tersimpan, `2` klip pada timeline, trim bar, dan clip inspector.
  - Diuji pada **12 kombinasi viewport & zoom** (`1920×1040` @ `100% / 125% / 150%`, `1480×940` @ `100%`, `1280×760` @ `100% / 125%`, `1180×760` @ `100%`, `1024×768` @ `100%`, `820×680` @ `100%` pada tab **Pengaturan** dan **Director**).
  - Hasil pengukuran DOM aktual: **`0` horizontal page overflow** (`rootOverflowX = 0`), **`0` topbar overflow**, **`0` tombol topbar/kontrol aksi terpotong**, dan **`0` overflow judul musik panjang** di seluruh 12 kombinasi.
- **Bug UI direproduksi & diperbaiki (`A06, A07`)**:
  - **Reproduksi** (`artifacts/stage4-case1-ui-sweep/stage4-ui-sweep-evidence.json`): handler `keydown` global di `apps/desktop/renderer/src/App.tsx` menjalankan `Ctrl+Z` / `Ctrl+Y` / `Ctrl+S` tanpa mengecek fokus input teks/angka, modal `<dialog>` terbuka, atau status `busy`. Akibatnya:
    1. Menekan `Ctrl+Z` saat fokus berada di `<input type="number">` (`Music offset`) membajak input dan diam-diam membatalkan klip pada timeline (`inputCtrlZHijackedTimeline: true`).
    2. Menekan `Ctrl+Z` saat `<dialog class="export-modal">` sedang terbuka ikut mengubah timeline di belakang modal (`modalCtrlZHijackedTimeline: true`).
  - **Perbaikan**: mengekstrak guard shortcut murni `resolveGlobalShortcut` & `isEditableShortcutTarget` di `apps/desktop/shared/shortcuts.ts` (+ 4 unit test di `apps/desktop/shared/shortcuts.test.ts`) dan menghubungkannya ke `App.tsx`:
    - Memblokir seluruh shortcut global saat `busy`, modal `<dialog open>` aktif, atau tombol `AltGr` (`altKey`) ditekan.
    - Melewatkan `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` ke kontrol browser native ketika fokus berada pada `<input>` teks/angka, `<textarea>`, atau elemen `contentEditable` (sambil tetap mempertahankan undo/redo setelah interaksi checkbox/slider dan `Ctrl+S` di luar modal).
  - **Retest pasca-perbaikan** (`artifacts/stage4-case1-ui-sweep-retest/stage4-ui-sweep-evidence.json`):
    - **`A06` PASS**: `Ctrl+Z` (`2 → 1` klip), `Ctrl+Y` (`1 → 2`), `Ctrl+Z` (`2 → 1`), `Ctrl+Shift+Z` (`1 → 2`), `Ctrl+S` menyimpan JSON proyek, menu aplikasi Windows (`File`, `Edit`, `View`, `Window`) terverifikasi, dan **`inputCtrlZHijackedTimeline: false`**.
    - **`A07` PASS**: `<dialog class="export-modal">` terbuka di top-layer (`:modal`), fokus awal masuk ke modal, `Tab` berputar tertahan di dalam modal (`4/4` `inModal: true`), **`modalCtrlZHijackedTimeline: false`**, **`modalCtrlSTriggeredSave: false`**, dan tombol `Escape` menutup dialog lalu mengembalikan fokus tepat ke tombol pembuka `Ekspor video ↗`.
- **Progres, notifikasi toast, & tombol `Cancel` UI (`A08`)**:
  - Input highlight manual tidak valid menampilkan `toast error` dan dapat ditutup melalui tombol `×` (`toastDismissed: true`).
  - Ekspor `1440p144` nyata via dialog memunculkan `.render-dock` (`EXPORTING MASTER`, `Memulai render`, progress bar, tombol `Cancel`). Mengklik tombol **`Cancel`** di UI menghentikan render dengan bersih (`toast info`: `"Render dibatalkan pengguna."`), tidak menampilkan `.qa-dock`, mengaktifkan kembali tombol editor, dan meninggalkan `0` file output/parsial di folder ekspor.

## Kasus 4.2 · Alur AI Offline/Simulasi & Persistensi Restart (`F04, F05, F06`; `F03` BLOCKED)

- **Runner & bukti**: `artifacts/stage4-case2-ai-sim/stage4-ai-sim.mjs`, `stage4-ai-sim-evidence.json`, `stage4-ai-restart-evidence.json`.
- **Metode**: mengganti `ChatGPTClient` di paket uji terisolasi dengan simulator lokal (nol panggilan jaringan nyata, nol akun/kredensial nyata, nol permintaan berbayar) sambil mengeksekusi kode asli Electron main (`safeProjectMetadata`, `killReviewMetadata`, `consumeAIRequest`, `persistAISettings`, `validateAIProposal`, `validateKillReview`, `supportsAIEffort`) dan UI React (`DirectorPanel`, `Review kill`).
- **Hasil**:
  - **Baseline tanpa login (`signed_out_offline`: PASS)**: saat `NOT CONNECTED`, tombol AI (`Generate with ChatGPT`, `Cari kill otomatis using AI Model`, dropdown `Effort AI`) nonaktif, sementara impor video/musik, penandaan manual, dan `Generate rule-only draft` berjalan 100% lokal.
  - **Katalog model, effort, & persistensi restart (`F04`: PASS dalam cakupan simulasi)**:
    - Memilih `gpt-6.2-sol` + `high` mengirim `reasoningEffort: "high"`.
    - Memilih model non-effort `gpt-4o-mini` menonaktifkan dropdown effort (`"Studio memakai effort bawaan model ini."`) dan mengirim `reasoningEffort: null` (tidak disertakan).
    - Memilih `gpt-6.1-sol` + `xhigh` lalu `medium` mengirim nilai effort yang sesuai dan menyimpannya ke `profile/ai-settings.json`.
    - Proses Electron kedua (`phase = restart`) memuat ulang `selectedModel = "gpt-6.1-sol"`, `selectedEffort = "medium"`, dan hitungan kuota per proyek (`5` dan `2`) secara utuh tanpa token/kredensial di berkas pengaturan maupun `worker.log`.
    - *Batas cakupan*: refresh katalog model dari akun ChatGPT nyata tetap bergantung pada verifikasi akun nyata (**`F03`**).
  - **Privasi metadata, persetujuan, & batas 5 permintaan per proyek (`F05`: PASS)**:
    - Sebelum checkbox persetujuan dicentang, `Generate with ChatGPT` nonaktif (`generateDisabledWithoutConsent: true`). Menolak dialog konfirmasi `Cari kill otomatis using AI Model` mengirim `0` permintaan (`declinedSentZeroRequests: true`).
    - Seluruh `7` payload keluar yang tertangkap (`59 B` tes koneksi, `19.613 B` proposal proyek, `1.179 B` triage 6 kandidat kill — semuanya jauh di bawah batas `100 KB`) hanya memuat field allowlist terstruktur dengan **`0` temuan kebocoran** (tanpa path berkas, nama file media, hash, byte audio/video, atau token OAuth).
    - Hitungan `Jatah AI proyek` naik akurat (`1..5 dari 5`). Pada `5 dari 5`, tombol `Generate with ChatGPT` dan `Test subscription connection` nonaktif, `Generate rule-only draft` tetap aktif, dan panggilan IPC langsung ditolak oleh main process dengan `"Per-project ChatGPT request cap reached (5)"`.
  - **Triage kandidat kill AI & fallback respons rusak (`F06`: PASS dalam cakupan simulasi)**:
    - Pada `6` kandidat nyata hasil detektor lokal (`WhatsApp Video`), respons simulasi valid memprioritaskan ulang urutan kartu kandidat di UI (urutan terbalik `00:35.50 → 00:24.20` dengan lencana `Prioritas AI` / `Perlu cek ulang` dan disclaimer review manual).
    - Respons triage AI yang rusak (`index: 99`) ditolak `validateKillReview` (`"Tinjauan AI tidak memuat daftar kandidat yang lengkap."`), menampilkan toast `"Tinjauan AI gagal. Kandidat dari pemindaian lokal tetap tersedia."`, dan mempertahankan seluruh `6` kandidat lokal.
    - Proposal Director AI yang mengarang event fiktif ditolak `validateAIProposal` 2× percobaan dan otomatis jatuh balik ke **`RULE-ONLY DRAFT`** lokal. (Selain itu, respons uji awal dengan beat target > 80 ms dan zoom > batas Smooth/Clean juga terverifikasi langsung ditolak oleh validator lokal.)
    - *Batas cakupan*: kualitas ranking pada akun/model langsung belum diukur tanpa persetujuan akun nyata (**`F03`**).
  - **Status `F03`**: tetap **`BLOCKED`** hingga ada persetujuan pengguna untuk pengujian sign-in akun ChatGPT nyata. Jika rilis perdana tidak menunggu verifikasi akun nyata, klaim AI opsional harus dibatasi/dikeluarkan dari klaim rilis dan Studio tetap berfungsi penuh secara lokal dari impor hingga ekspor.

## Keputusan Cakupan 6 Fitur `NOT IMPLEMENTED` & Transparansi UX AI (Disetujui Pemilik Proyek)

- **Keputusan rilis Windows v1**:
  1. Seluruh 6 fitur `NOT IMPLEMENTED` (**B08, E05, G03, G05, I05, J08**) resmi **ditunda ke backlog pasca-v1** dan akan dicatat di release notes dengan ID yang sama.
  2. Fitur AI akun ChatGPT nyata (**F03**) **dikeluarkan dari klaim rilis v1**; rilis perdana berfokus pada alur lokal penuh (impor, review kill, timeline, preview, ekspor `1080p60` & `1440p144`, QA, simpan & pemulihan).
- **Perbaikan transparansi UX dari temuan pengguna di lapangan (`apps/desktop/renderer/src/App.tsx`)**:
  - Tombol `"Cari kill otomatis using AI Model"` sebelumnya terkesan seolah AI menonton video untuk mendeteksi kill, padahal deteksi tetap 100% lokal (video/audio tidak pernah dikirim ke ChatGPT) dan AI hanya mengurutkan skor metadata kandidat lokal.
  - Blok `catch` pada `detectKillCandidates` sebelumnya menelan pesan error `aiReviewKills`, sehingga saat permintaan AI gagal pengguna tidak melihat penyebabnya.
  - Diperbaiki: menempatkan tombol lokal `Cari kill otomatis` sebagai tombol utama, mengganti label opsi AI menjadi `Pindai lokal + urutkan via AI (metadata)` beserta keterangan batas metadata & indikator `Jatah AI proyek: X/5` langsung di panel Review kill, serta menampilkan pesan error aman (`getError(error)`) jika tinjauan AI gagal.

| ID | Fitur | Status saat ini | Keputusan rilis perdana Windows |
| --- | --- | --- | --- |
| **B08** | Hapus proyek dengan konfirmasi | Belum ada tombol/IPC hapus proyek | **Ditunda ke pasca-v1 (backlog `B08`)** |
| **E05** | Pemutar musik terpisah | Waveform & beat marker tampil, belum ada transport audio musik mandiri | **Ditunda ke pasca-v1 (backlog `E05`)** |
| **G03** | Split klip di timeline | Timeline mendukung tambah, hapus, geser urutan, trim IN/OUT, ramp, reverse | **Ditunda ke pasca-v1 (backlog `G03`)** |
| **G05** | Zoom skala timeline | Klip mengalir horizontal dengan scroll; zoom jendela terpisah | **Ditunda ke pasca-v1 (backlog `G05`)** |
| **I05** | Pemilihan encoder CPU/GPU | Worker sudah mendeteksi encoder FFmpeg (`libx264`, `nvenc`, `amf`, `qsv`), namun renderer manual masih mengunci `libx264` | **Ditunda ke pasca-v1 (backlog `I05`)** |
| **J08** | Lirik, cover, & preset vertikal (9:16) | Tersedia di skrip upstream, belum dibuka di UI Studio | **Ditunda ke pasca-v1 (backlog `J08`)** |
