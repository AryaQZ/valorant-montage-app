# Upstream pipeline adoption

> **Current status (2026-11-18):** This document records the earlier technical adoption checkpoint, not full montage-quality parity. See [the quality regression audit](QUALITY_REGRESSION_AUDIT.md) for the real-footage/music renders and current source-path findings. The app's master renderer still calls its local FFmpeg filter graph; it does not yet invoke the upstream reference-style planner, renderer, or audio mixer. The native upstream renders are reference artifacts, not app-integrated output.

## Provenance

- Repository: `https://github.com/gustavomenani/editing-gameplay-montages`
- Pinned commit: `bd016ee02ac3d667f6849a136ab5f69edbd0edec`
- License: MIT; notice and source are retained under `third_party/editing-gameplay-montages`.
- RIFE model: upstream RIFE v4.25 ncnn/Vulkan bundle. `flownet.bin` SHA-256: `10de487a095e61cb2971c39e3b5e17005a70fba6201c77fb96e063f4423b583f`.
- Original project target: 1920×1080/60 FPS horizontal or 1080×1920/60 FPS vertical. The 2560×1440/144 FPS master is this application's adaptation, not an upstream capability.

## Compatibility matrix

| Pipeline stage | Upstream implementation retained | Studio integration | Current boundary |
|---|---|---|---|
| VALORANT kill feed and shot frame | `scripts/kills_auto.py`, `scripts/ingest.py`, `scripts/mkpts.py` | Local worker adapter at `services/worker/upstream.py`; maps the upstream 60 FPS working frame through its ingest origin and back to the source frame rate. | Results are review candidates. The `verified` flag from upstream is displayed as evidence, not treated as human confirmation. No cross-recording duplicate identity model is claimed. |
| Measured music attacks | `scripts/music_hits.py`, with its sample-domain onset definition | Local music analysis adds upstream attack candidates to the existing beat grid. `services/worker/quality.py` audits every displayed impact against its nearest attack. | Upstream attack measurement depends on the local preliminary BPM/phase estimate; short or incompatible tracks use the existing local analyzer. The director uses beat proximity as a soft ordering cost; it does not retime every kill onto an unrelated beat. |
| RIFE slow motion | `scripts/rifeutil.py` RIFE v4.25 plus its `Tween` edge-step correction | `services/worker/rife_segment.py` renders frame-indexed forward slow-motion segments. Lossless segment files are cached using source SHA-256, source range, speed ratio, output profile, model hash, GPU index, and renderer version. | RIFE is used only after the source stream's CFR metadata and sampled PTS pass checks. VFR, reverse, missing runtime/model, or failed GPU jobs use FFmpeg's timestamp-aware `minterpolate` fallback and are listed in QC. The fallback is not called RIFE. |
| Speed, reverse and timing | Upstream frame-indexed timeline semantics | Version 2 JSON stores segment ranges in integer microseconds and boundaries in integer output frames. Forward nonlinear ramps and a short reverse replay are editable in the inspector. | Reverse replay uses FFmpeg interpolation, not the RIFE helper. |
| Visual/audio finish | Upstream reference renderer's impact timing, motion blur and audio protection concepts | FFmpeg applies restrained impact zoom with editable keyframes, contextual flash/shake/`tmix` blur, optional dip-to-black, exact-frame synthetic impact thumps, music sidechain ducking, and a final limiter. | This is a compatible FFmpeg adaptation; it is not a byte-for-byte port of the upstream OpenCV linear-light renderer or its complete sound-design library. |
| Final quality gate | `scripts/gate.py`, `scripts/check.py`, `scripts/syncaudit.py` concepts | The final MP4 is independently reopened with FFprobe/FFmpeg. QC records frame count, CFR/PTS error, duplicate-frame runs, black/silence intervals, audio duration/start/peak, event-to-attack offsets, rendered effects, interpolation provenance, and timeline hash. | The manifest proves that the filter graph was built and tied to the timeline; it is not an automatic aesthetic judgment. Kill visibility and interpolation artifacts still require contact-sheet/human review. |

## Reproduced upstream baseline

Run date: 2026-11-17. Input stayed local and was not uploaded. The selected recording is a dual-view VALORANT recording with overlays; it is a technical integration sample, not an approved style reference.

- Source: 2560×1440 at 120 FPS, 17.809 seconds.
- Original upstream ingest: `src/c1.mkv`, 1920×1080/60, 1,068 frames. Every 60 FPS working frame exactly matched a 120 FPS source frame, so ingest recorded 0 RIFE calls and 0 ms maximum mapping error.
- Original upstream preparation then generated 509 RIFE subframes and repaired 12 duplicate source frames. `check_store.py` reported no missing/too-coarse entries and no repeated-frame run.
- Original upstream reference render: 1920×1080/60, 120 frames, 2.000 seconds, with the upstream reference-style effects pipeline.
- Upstream kill scan returned one own-feed candidate: working shot frame `K=513`, feed frame `520`, `medium` confidence, ammo method. It remains unconfirmed by a human; upstream's `verified=true` does not establish that the actual shot is clear in this recording.
- Upstream audio analysis marked the candidate `silent` because it found no clean gunshot. The run did not invent a gunshot or report successful audio alignment.

The rerunnable timeline, normalised source, detector output, review sheet, upstream render and prep artifacts are under `artifacts/adoption-preview-2026-11-17/upstream-reference`. Reproduction helper: `artifacts/adoption-preview-2026-11-17/upstream-reference/make_timeline.py`.

## Integrated app render

`artifacts/app-rife-preview-final.mp4` is a 58-frame test render from the same local recording. Its project deliberately uses a manually selected 200 ms range at half speed; the event is labeled `manual_annotation_baseline`, not an automatically verified kill. The app generated the slow segment with the pinned RIFE model, applied impact zoom and flash, encoded 2560×1440/144 FPS, mixed a synthetic local click fixture with the exact displayed impact, and ran final-file QC. The click track is a test fixture, not a user song.

Measured QC: 58 decoded frames, CFR `144/1`, monotonic PTS with maximum cadence error 0.556 μs, maximum identical-frame run 1, audio drift −7 μs, audio peak −13.6 dBFS, no detected black interval or ≥1-second silence, and a measured 0 μs impact-to-click offset. The output's render manifest records the timeline hash and RIFE cache key. This verifies the rendering path, not the quality of a complete montage or the correctness of automatic kill selection.

The desktop preview modes also rendered and passed final-file QC: `artifacts/app-rough-preview-720p30.mp4` is 1280×720/30 with effects and RIFE deliberately disabled; `artifacts/app-effects-preview-1440p60.mp4` is 2560×1440/60 with effects active. Both retain the same 400 ms content timing and report the synthetic attack offset within one output frame.

## Implementation gates

| Brief ID | Status at this checkpoint |
|---|---|
| ADOPT-00/01 | Existing app inspected; source checkpoint and branch created; upstream clone, license, commit, dependencies, scripts and model hash recorded. |
| ADOPT-02/03 | Upstream diagnostics and a real-media baseline completed; baseline report is reproducible from saved local artifacts. |
| ADOPT-04 | Upstream candidate detection is connected to the event-review UI. Candidate acceptance is manual. Cross-recording duplicate matching and ranking by visual quality remain incomplete. |
| ADOPT-05 | Upstream measured attacks are integrated; the rule director softly scores proximity; rendered event/attack offsets are reported. Full phrase/story-arc planning and automatic retiming remain incomplete. |
| ADOPT-06 | Version 2 integer-frame timeline, v1 migration, trims, order, speed-map segments, reverse, effect toggles/keyframe, and project save/reopen are connected. Full multi-track keyframe editing/undo coverage remains incomplete. |
| ADOPT-07 | Real effects and a RIFE slow-motion master are demonstrated. Separate 720p30 rough and 1440p60 effects-inclusive preview jobs are connected to the desktop. |
| ADOPT-08 | Master export was measured at exactly 2560×1440/144 FPS. No silent 1080p60 substitution. |
| ADOPT-09 | CFR forward slow motion uses upstream RIFE and a provenance-keyed cache. VFR and reverse interpolation use the disclosed FFmpeg fallback. |
| ADOPT-10/11 | Sample-synchronous 48 kHz mix, frame-synchronized impact SFX, music sidechain ducking, limiter and final-file timing/audio/frame QC are connected. A synthetic known-onset fixture measured 0 μs offset. Subjective mix quality on licensed real songs still needs review. |
| ADOPT-12/13 | Worker renders and both preview modes run as cancellable jobs; RIFE helper cancellation and partial/output safety are connected. Cancellation-during-RIFE and a complete multi-source, three-kill GUI acceptance session remain untested. |
| ADOPT-14/15/16 | Reference-style matching, optional vertical framing, and clean-machine packaged-installer validation remain incomplete. The explicit 1440p60 export profile, optional upstream runtime setup, and package assets are included. |

No code path accesses the VALORANT process, memory, inputs, or anti-cheat. Gameplay and music stay on device; OAuth material stays in Electron's credential store.
