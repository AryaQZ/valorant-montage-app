# End-to-end test report

## Inputs and execution boundary

Verified the exact local WhatsApp recording (848 × 478, 60 FPS, 39.071458 seconds) and the requested Untouchable MP3 by resolved path and SHA-256. Native work and UI automation used independent test profiles. No real account or paid API calls were made. No video/audio content was sent to a model. Reanalysis used FFmpeg, upstream audio analysis, NumPy and SciPy. Librosa was unavailable in both checked Python environments.

## Real scenarios

| Case | Recorded evidence | Result |
| --- | --- | --- |
| A. Basic workflow | Production-bundle Electron run imported the original, decoded its proxy, rejected duplicate media, created an annotation, and saved/reopened a project. The fresh local worker scan independently returned six shot candidates. | PASS for basic import/edit/save/reopen, local rule draft, both preview modes and master export. Real scan was a separate worker integration case. |
| B. Beat-driven workflow | Fresh native 1920 × 1080/60, 718 decoded frames, five reviewed shots. Prep generated and checked the new 4×/16× RIFE store. Independent decoded AAC alignment deltas were −3.90, +1.48, +9.03, +5.63 and +2.86 ms. Stereo peak was −1.54 dBFS. | FAIL. Audio alignment measured successfully. Native gate found a stall at frame 286 and muzzle-flash mismatch at frame 460. |
| C. Manual editing | Production UI preserved speed/reverse after trim and reopened a Unicode Save As project. Original complex ramp+reverse rough preview first failed with an unconnected audio pad. Audio routing is fixed, but the same complex timeline subsequently exposed runaway FFmpeg buffering. | FAIL. Simpler reverse regression decodes; the exact complex case is unresolved. |
| D. High-quality export | Actual worker cancel/retry generated 2560 × 1440 at 144 FPS with 69 decoded frames and zero audio duration drift. Packaged UI generated a separate 88-frame 144 FPS master with one audio stream, −7 μs audio drift and no adjacent identical decoded frames. This is a short baseline, with effects/ramp deliberately disabled for the recovery run. | PASS for that file and settings. Long 144 FPS visual quality and complex 144 FPS RIFE/optical-flow parity remain open. |
| E. Failure recovery | Malformed JSON preserved the current editor timeline. Corrupt MP4/MP3 rejected. Missing original blocked export. Missing proxy rebuilt. Cancellation left no final/partial output and retry succeeded. | Partial. Missing-media relink, clean restart and unavailable-RIFE UI recovery were not fully tested. |

## Actual output checks

- Native final-action audit matched four requested source positions. The final decoded shot at output frame 613 matched source frame 2130 with correlation 0.992. The ACE HUD template was also found in the final output. Its best locally measured correlation was 0.996.
- Compared real same-source rendered frames with effects disabled. Zoom, flash, shake and blur changed decoded pixels. Flash was absent before its fix and increased grayscale mean by 65.99 levels at frame 10 after the fix. Shake had zero difference before the fix and maximum mean absolute difference 10.01 levels afterward.
- Two-clip dip-to-black changed the join frame from average grayscale 115.76 to 0.007. The failed native transition is a separate effect path.
- The native QA report remains FAIL. A frame sheet showing the relevant output regions is provided as separate local evidence. Frame ordering in the sheet is 284–287, 457–461.
- The intentional fault fixture triggered resolution/FPS/frame-count errors plus black frames, frozen frames, silence and A/V duration warnings. It is excluded from the montage artifacts.

## Evidence files

The audit output folder contains `native-1080p60.mp4`, its QA report, `recovery-1440p144.mp4`, the stock picture comparison and real effect variants. The evidence subfolder contains structured measurements, renderer QA results, failure baselines and relevant logs.

## Follow-up on 0.1.11-qa.2

- The exact edited project that failed in scenario C now plays its complete 35-frame rough preview and renders a 161-frame 2560 × 1440 master at 144 FPS. The master used 13 newly generated RIFE assets. The FFmpeg QA reports WARN because its legacy effect check records authored effects and still requires visual verification.
- For scenario B, the production-bundle editor rendered and decoded a new native 1920 × 1080/60 preview with all 718 frames. It reused the previously generated 4×/16× RIFE samples with unchanged source positions. The upstream pixel gate reported zero errors and six warnings. Decoded AAC attack deltas for five reviewed kills were −3.90, +1.48, +9.03, +5.63 and +2.86 ms. Stereo true peak was −1.3 dBFS. The editor exported the authored frame for the last kill and retained 108 frames of lead-in. The ACE source template matched 67 output frames.
- For scenario E, the packaged editor relinked a missing video and recovered its edited speed map from a real autosave after a window reload. The original source files matched their prior SHA-256 hashes. Full process-crash recovery remains open.
