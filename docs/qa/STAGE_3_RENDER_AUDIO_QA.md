# Tahap 3 · Verifikasi Render, Musik, dan Kualitas Output

Tahap 3 memverifikasi jalur render manual (`2560 × 1440 @ 144 FPS` dan `60 FPS`), jalur native (`1920 × 1080 @ 60 FPS`), interpolasi RIFE dan pemulihannya, perbandingan efek aktif/nonaktif, audio/musik/beat dari AAC hasil decode, video referensi gaya, serta tinjauan enam peringatan native lima kill.

Semua pengujian menggunakan media lokal pada profil data (`VMS_DATA_DIR`) dan folder artefak terpisah di bawah `artifacts/stage3-*`. SHA-256 seluruh berkas media sumber di `artifacts/handover/fixtures/` diverifikasi cocok sebelum dan sesudah pengujian.

## Lingkungan & Regresi

- **Base commit**: `2dea4014a99b7704b931b1d332ad3f22e3c55910` (branch `dev`, kandidat `0.1.11-qa.4`)
- **Toolchain lokal**: Python `3.12.5` (worker), Python `3.11` (`.build-tools/upstream-venv` dengan NumPy, OpenCV, SciPy, `rife_ncnn_vulkan_python`, model `RIFE v4.25 / ncnn Vulkan`), Node `22.12.0`, FFmpeg/FFprobe `9.0.2-full_build` (`libx264`).
- **Regresi akhir**: **67 tes Python** (`python -m unittest discover -s tests -v`), `tsc --noEmit`, dan **16 tes desktop** (`vitest`) lulus.

## Kasus 1 · Ekspor Manual 1440p144 Berdurasi Nyata & Multi-Source Campuran (`C06, C07, I04, I07`)

- **Fixture**: 3 rekaman berbeda resolusi, FPS/VFR, dan sample rate audio — `WhatsApp Video 2026-11-18 at 23.05.09.mp4` (`848×478`, `60/1` CFR, AAC 44,1 kHz, 5 kill ter-review), `VALORANT   2026-11-14 22-44-09.mp4` (`1920×1080`, VFR `~49,37` FPS, `118,1 MB`, AAC 48 kHz), `VALORANT   2026-11-14 22-45-26.mp4` (`1920×1080`, VFR `~49,43` FPS, `119,1 MB`, AAC 48 kHz) — ditambah `Megan_Trainor_-_Untouchable..._(mp3.pm).mp3` (`79,92 s`).
- **Impor & proxy**: `1,29 s` (`848×478` CFR), `4,70 s` (`1080p` VFR #1), `5,16 s` (`1080p` VFR #2); analisis musik `4,50 s` (`62,64 BPM`, `292` `measured_attack` markers); disk profil `51,37 MB`.
- **Bug direproduksi & diperbaiki**:
  1. `tmix` (`motion_blur`) sebelum `fade` (`dip_to_black`) menggeser PTS warmup sehingga awal Klip 7 memiliki 3 frame hitam identik (`f=2436–2438`, `YAVG=16`, memicu `WARN`) dan fade-out akhir Klip 1 telat 3 frame.
  2. `qc["file"]` pada `.qa.json` / `.qa.html` masih menunjuk path sementara `.vms-*.partial.mp4`.
- **Perbaikan**: `services/worker/render.py` menormalkan `setpts=N/({fps}*TB)` sebelum `fade` serta menetapkan `qc["file"] = str(destination)`. Ditambahkan tes regresi `test_motion_blur_with_dip_to_black_preserves_fade_timing_and_final_qa_path`.
- **Hasil retest** (`artifacts/stage3-case1-manual-1440p144-retest/case1-retest-evidence.json`):
  - **Cancel & reopen (`I07`)**: batal render di tengah FFmpeg (`1,7%` / `37,28 s`) melempar `InterruptedError` dalam `0,21 s`, tanpa memublikasikan MP4/QA dan tanpa sisa `.partial.mp4`.
  - **Ekspor ulang penuh (`I04`)**: `816,26 s` (`worker_rife_cache_hit: true`), `54,29 MB`, `2560×1440`, `144/1` CFR, **`2904/2904` frame** (header, `count_frames`, PTS, dan `framemd5` cocok), `pts_max_delta_error = 0,556 µs`, **`max_identical_frame_run = 1`** (`0` duplikat di seluruh 2.904 frame), `blackdetect(d=0.04) = 0`, `freezedetect(d=0.08) = 0`, A/V container drift **`-0,021 ms`** (PCM decode penuh `-4,834 ms`), peak `-1,6 dBFS`, `qa["file"]` menunjuk MP4 final.

## Kasus 2 · RIFE, Pemulihan Model/Runtime Hilang, & Bukti Reverse (`H07, J05`)

- **Bukti RIFE aktif (`0,25×` slow-mo `60 → 144 FPS`, `173` frame)**: `status = PASS`, `231/231` frame, `max_identical_frame_run = 1`. Pada `99` sampel frame tengah bergerak (`0,2 ≤ frac ≤ 0,8`, rata-rata `MAD(lo, hi) = 6,806`): `mean MAD vs lo = 4,628`, `vs hi = 4,717` (`min = 1,535`), `vs linear blend = 2,826`, langkah antar-frame berurutan `1,045` — membuktikan RIFE menghasilkan frame optical-flow baru.
- **Bukti Reverse (`0,5× reverse` pada gameplay nyata, `H07`)**: `status = PASS`, `180/180` frame, `audio_drift = -21 µs`, `rife_gate = NOT_APPLICABLE`, pencocokan 10 sampel frame output ke sumber menghasilkan urutan mundur monoton `[1469, 1467, 1464, 1462, 1460, 1457, 1455, 1453, 1450, 1450]` (span mundur `19` frame).
- **Bug direproduksi & diperbaiki**:
  1. `reference.create_reference_draft` berjalan `83,74 s` dan sukses tanpa error meski direktori model RIFE kosong (`flownet.bin`/`flownet.param` hilang).
  2. `upstream.render_rife_segment` dan `_normalize_vfr_source` hanya mengecek `flownet.bin`, sehingga folder model tanpa `flownet.param` baru gagal di subprocess `rife_segment.py`.
  3. `render.preflight` mode `master` tidak memperingatkan pengguna sebelum render ketika slow motion tidak punya RIFE, dan `fallback_warnings` bersifat generik.
- **Perbaikan**: menambahkan `rife_model_ready()` (`flownet.bin` + `flownet.param`) dan `rife_unavailable_reason()` di `services/worker/upstream.py`, memakainya di `reference.py` (`create_reference_draft`, `reference_preflight`, `render_reference`) dan `render.py` (`preflight` warning + alasan fallback spesifik). Ditambahkan `test_missing_or_incomplete_rife_model_is_reported_before_draft_and_preflight` di `tests/test_reference.py`.
- **Hasil retest** (`artifacts/stage3-case2-rife-fallback-retest/case2-evidence.json`):
  - Model kosong: `preflight` manual memberi `1` warning jelas; `master` fallback ke FFmpeg (`231/231` frame, beda `mean MAD 2,605` vs RIFE, `rife_gate = REQUESTED_BUT_MISSING`, `state = needs_review`); `rough_preview` tetap `PASS`; native `create_reference_draft` gagal cepat dalam `0,83 s` dengan pesan jelas.
  - Partial model (tanpa `flownet.param`): `capabilities.rife_model_available = false` dan `render_rife_segment` langsung kembali `None` tanpa exception.
  - Runtime Python RIFE hilang: preflight manual memberi warning runtime, `master` fallback dengan alasan spesifik, dan native gagal cepat dengan instruksi `scripts/setup-upstream.ps1`.

## Kasus 3 · Perbandingan Efek Aktif vs Nonaktif (`H08, J06`)

- **Jalur manual (`youtube_60`, `impact = f24`, `join = f48`)**:
  - `impact_zoom (1,07×)`: MAD impact `19,942`, area tenang `0,000`.
  - `impact_flash (0,22, 3f)`: `ΔY = +59,445` (`MAD 59,243`), area tenang `0,000`.
  - `screen_shake (14 px, 12f)`: `MAD 10,645` (peak `11,164` di `f23`), area tenang `0,105`.
  - `dip_to_black (6f di f48)`: `YAVG ON = 0,0` vs `OFF = 109,47`, kurva mulus, `f10` tenang `0,000`.
  - **Bug direproduksi & diperbaiki (`motion_blur`)**: `tmix=frames=3:enable=...` menggeser seluruh klip `-2` frame (`quiet_pre_impact_mean_mad_f0_7 = 8,996`, `peak_mad_frame = 33`). Diperbaiki di `services/worker/render.py` memakai cabang `split` + `tpad(stop=half)` + `tmix` + `trim(start_frame=half)` + `blend=all_expr=B:enable=...` + tes `test_motion_blur_does_not_shift_frames_outside_impact_window`. Retest (`artifacts/stage3-case3-effects-ab-retest/case3a-retest-evidence.json`): area tenang **`0,000`**, MAD impact **`2,782`**, peak `3,298` di `f29` (dalam `[21..32]`).
- **Jalur native (`1080p60`, 3 kill, `effects_intensity = 0,45` vs `0,0`, `498` frame identik, `shot_frame = [19, 211, 402]`)** (`artifacts/stage3-case3-effects-ab/case3-evidence.json`):
  - **Exposure / Flash**: `ΔY = +10,241` (`f19`), `+15,624` (`f211`), `+22,986` (`f402`), meluruh di `f+1..f+5`; di `f-1` hanya `+0,13..+0,15`.
  - **RGB Chromatic Split (`H08`)**: saat ON, tepi kiri/kanan terukur `left_dx = +1`, `right_dx = -1..-3`, kenaikan `edge |R-B|` hingga `+9,623` (`f402`); saat OFF `left_dx = 0, right_dx = 0` di semua impact.
  - **Color grading dasar**: pada frame tenang `f196` vs sumber `f1525`, saturasi `HSV-S` naik `0,2976 → 0,4229` (`ON`) / `0,4255` (`OFF`), kontras `std(Y)` `48,66 → 54,49`.
  - **Transisi `bwhip` (`join = f191`)**: `rgb_mad` ON vs OFF memuncak di `47,318` pada `f191`.

## Kasus 4 · Audio, Musik, Beat AAC, Limiter, Clipping QA, & Rule Director (`E06, E07, F08, F09, G09, J03, J04`)

- **Gain A/B (`E06`)**: RMS PCM hasil decode AAC berubah konsisten dari `-17,031` (`game=1.0, music=0.0`) → `-16,913` (`music=0.18`) → `-15,811` (`music=0.60`) → `-18,348 dBFS` (`game=0.25, music=0.60`), semua `PASS`.
- **Sidechain ducking (`E07`)**: pada pita `< 350 Hz` (terisolasi dari burst gameplay `1000 Hz`), musik turun **`-3,254 dB`** selama burst (`-25,402` vs `-22,148 dBFS`) dengan `0,0 dB` sebelum burst dan pulih sesudah burst.
- **Bug direproduksi & diperbaiki (`Impact SFX`, `E07`)**: `adelay={hit_sample}S` tanpa `:all=1` hanya menunda kanal kiri (`505,17 ms`), sedangkan kanal kanan bocor di awal video (`1,92 ms`, pre-impact `-53,25 dBFS`). Diperbaiki di `services/worker/render.py` menjadi `adelay={hit_sample}S:all=1` + tes `test_impact_sfx_delays_both_stereo_channels_to_impact_frame`. Retest (`artifacts/stage3-case4-audio-music-beat-retest/case4-evidence.json`): pre-impact **`-120,0 dBFS`**, onset stereo **`505,17 ms`** (88 Hz single kill, freq dominan `76 Hz`) dan **`505,21 ms`** (72 Hz multikill, `60 Hz`), RMS jendela impact `-33,96 dBFS` (`+6,02 dB` setelah kedua kanal sejajar).
- **Limiter & Fixture Clipping (`E08, J03`)**: gain ekstrem `150%` tetap ditahan limiter di **`-0,5 dBFS` (`PASS`)**. Fixture sengaja clipping (`+12 dB`, `0,0 dBFS`) ditangkap QA dengan **`status = FAIL`** (`Peak audio di bawah -0.1 dBFS. → FAIL`).
- **Kasus negatif & no-audio (`E04, E09`)**: musik hilang, `.mp3` korup, dan musik terlalu pendek (`offset 79 s`) semuanya diblokir `preflight`. Footage tanpa audio tanpa musik menghasilkan `anullsrc` + `WARN` silence; dengan musik menghasilkan `PASS` (`-9,9 dBFS`).
- **Beat sync manual dari AAC hasil decode (`E10, J04`)**: misaligned (`offset +250 ms`, `priority=0.75`) diblokir `preflight` (lolos pada `priority=0.0`). Aligned 3 klip (`priority=0.75`) lulus `PASS` (`3/3` frame-accurate, `max_delta_us = 7797 µs`), dengan cross-correlation AAC vs musik asli `+4,989 ms` dan selisih 3 impact visual vs attack AAC **`+0,434 ms`**, **`-0,972 ms`**, **`-12,786 ms`** (di bawah 1 frame `60 FPS`).
- **Rule Director sweep (`F08, F09, G09`)** (`artifacts/stage3-case4-audio-music-beat/case4-director-evidence.json`): perubahan `beat_sync_priority`, `effects_intensity`, `music.offset_us`, dan `event_weights` secara deterministik mengubah urutan klip, `beat_targets`, dan parameter zoom.

## Kasus 5 · Video Referensi Gaya (`C11`) & Audit 6 Peringatan Native + Perbedaan Upstream (`J04, J06`)

- **A/B Video Referensi Gaya (`C11`)** (`artifacts/stage3-case5-ref-and-warnings/case5-evidence.json`):
  - Tanpa referensi: `718` frame, `visual_reference = null`, `fade_s = 0,27`.
  - Dengan referensi nyata `VALORANT 22-44-09.mp4` (`52,93 s`): `ref_analyze.py` menganalisis penuh (`roll_share = 0,0`, `fade_s = 0,27`), `718` frame, 5 kill & beat sync tetap utuh.
  - Dengan referensi sintetis `synth-style-reference.mp4` (ending fade `0,55 s`): `ref_analyze.py` mendeteksi `fade_s = 0,567`, meneruskan ke `vms-ending.json`, dan mengubah draft menjadi **`728` frame** (+10 frame ending fade) sementara 5 kill (`1452, 1540, 1710, 1832, 2130`), `shot_frame`, `final_action`, `ACE`, dan musik tidak diubah.
- **Audit 6 peringatan native 5-kill (`stage2-signoff/native-1080p60.qa.json`)**:
  - **0 dari 6 peringatan adalah efek salah frame**; seluruhnya merupakan karakteristik keterukuran sumber terkompresi `WhatsApp 478p` (`127 kbps` AAC) atau perilaku lagu:
    1. `gameplay-jump` (`f=559`): jeda 1 frame dari sumber asli selama ancang-ancang kill terakhir (dekat frame `2076`).
    2. `gunshot-unmeasured` (`4` kill: K2–K5): pengukuran langsung mengonfirmasi hanya **K1 (`+24,17 dB`)** yang menonjol di atas noise floor (`-45,4 dBFS`); K2–K5 berada di ambient `-27,4..-21,3 dBFS` dengan rise hanya `+3,16..+6,57 dB`.
    3. `kill-flash` (`K4@f1832`): delta luma positif tersebar di `K-1` (`17,98`) dan `K` (`22,53`) pada sumber asli.
    4. `flash-unmeasured` (`K1, K2`): unmeasured oleh template otomatis pada `478p` terkompresi / dekat fade pembuka (sebagai pembanding, rekaman `1080p` `22-44-09.mp4 @ 49,95 s` menghasilkan lonjakan top-5% `119,88` vs `22,5–63,0` pada `478p`).
    5. `bump-unmeasured` (`beat 5.556`): unmeasured karena berdekatan dengan transisi/ramp.
    6. `grid-unmeasured` (`concentration 0.34`): drum lagu tidak satu fase tetap; Studio memakai `measured_attacks` per-hit (`max_delta = 9,03 ms`).
- **Perbedaan Studio vs upstream yang dipertahankan**:
  - Studio mewajibkan review manual kandidat kill & kepemilikan, menolak pemutaran ulang jendela duplikat, mengunci `auto_bullet=False` / `hit_lead_frames=0` / `cut_lead_frames=0` demi akurasi frame, melindungi frame pre-shot asli (`_native_pre_shot_frames`), mempertahankan ancang-ancang kill terakhir (`_preserve_final_action`) dan banner ACE (`_preserve_ace`), membatasi referensi video hanya sebagai visual hint (`roll_share`, `fade_s`) tanpa mengganti musik/event pengguna, serta menonaktifkan alur lirik/cover/preset vertikal (`J08`).
  - Catatan batasan upstream: `draft_ref_timeline.py` mensyaratkan `length >= 8 s` sekaligus spasi maks 2-kill `≤ 7,0 s` (sehingga 2-kill terpisah ditolak upstream, sedangkan 3+ kill valid); pada subset 3-kill (`498` frame), `gate.py` juga melaporkan `stall` 1 frame di `f=375` sebelum `bwhip` (berbeda dari kontrol 5-kill yang `0` error).
