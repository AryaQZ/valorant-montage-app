# VALORANT Montage Studio quality regression audit

**Status: investigation and guard repairs complete; upstream render reproduced; application quality restoration is still incomplete.** The app's production renderer does not yet call the upstream timeline planner or full render/audio pipeline, so the upstream render below is a verified reference, not an app-integrated replacement.

## Inputs and reproduction

- Existing project: `C:\Users\asus\Downloads\Valorant-Montage\VALORANT-Montage-Project.vmsproj.json`.
- Supplied rendered project: `C:\Users\asus\Downloads\Valorant-Montage\VALORANT-Montage-Final-1440p144.project.json`.
- Footage: the local raw recordings selected by the project; all processing stayed on this machine.
- Music: the user-supplied local `The_Weeknd_-_Blinding_Lights_(mp3.pm).mp3`; no media was uploaded.
- Upstream source pinned at `bd016ee02ac3d667f6849a136ab5f69edbd0edec` under `third_party/editing-gameplay-montages`.

The upstream horizontal reference-style pipeline was run from its own project workspace at its native 1920×1080/60 FPS profile. `music_tempo.py` measured 171 BPM and the track's bass re-entry at track beat 336. `music_grid.py` refined BEAT0 to 0.1112 s; the strong drum attacks do not stay on one constant grid, so the plan used measured attacks.

The original pipeline found and verified the selected shot frames with `kills_auto.py`, `kverify.py`, and `kill_rank.py`. `draft_ref_timeline.py` created a 5-take, 5-kill schedule. `ranges.py`, `prep.py`, `check_store.py`, `posmap.py`, and the upstream `run.sh` rendered the output with RIFE slow-motion subframes, the original camera/effect renderer, sample-domain sound mix, and peak guard.

## Actual renders and review

| Output | Measured result | Review |
|---|---|---|
| App baseline A: `artifacts/quality-regression-review/app-baseline-1440p60.mp4` | 2560×1440/60 FPS; 975 frames; 16.25 s; five 3.25 s clips; the provided music and five distinct measured attacks were present in this diagnostic baseline. | The overview was reviewed. It repeats nearly the same c9 source window twice, has no time remap or RIFE, has no transition, and schedules only impact zoom (max scale 1.018). |
| Original upstream golden: `artifacts/quality-regression-review/upstream-baseline/upstream-reference-native-1080p60.mp4` | Native 1920×1080/60 FPS; 765 frames; 12.75 s. | Retained unchanged as the first-run golden. Upstream QA found one low-motion stop and one c9 flash metric one frame early, so it is not the final corrected reference. |
| Corrected upstream reference B: `artifacts/quality-regression-review/upstream-baseline/upstream-corrected-native-1080p60.mp4` | Native 1920×1080/60 FPS; 723 frames; 12.05 s; 5/5 planned shots verified; music begins at 116.578 s. | `check.py`, `gate.py`, `sync_0.jpg`, and a full-duration overview were reviewed. There are no identical consecutive frames or one-frame motion stops. Two of five kill flashes are measurable on the exact shot frame; three are not measurable and are not counted as passes. `gate.py` reported no ERRORs and five WARNs. |

The app baseline and upstream render use the same selected source recordings and music file, but this is **not a controlled same-profile A/B**: the app uses 1440p60 while upstream is native 1080p60, and the app could not align its existing timeline to the upstream main-drop section. A second app render at the drop was stopped after strict preflight reported three unassigned impacts; it did not produce an output. Do not compare the outputs as if the app had achieved parity.

Reviewed image evidence:

- [App baseline overview](../artifacts/quality-regression-review/app-baseline-overview.jpg)
- [Corrected upstream full-duration overview](../artifacts/quality-regression-review/upstream-baseline/upstream-corrected-overview.jpg)
- [Corrected upstream shot-frame strips](../artifacts/quality-regression-review/upstream-baseline/sync_0.jpg)
- [Upstream `check.py` report](../artifacts/quality-regression-review/upstream-baseline/upstream-corrected-check.log)
- [Upstream gate warnings](../artifacts/quality-regression-review/upstream-baseline/upstream-corrected-gate.log)
- [Upstream audio report](../artifacts/quality-regression-review/upstream-baseline/audio_report.json)

The corrected B plan places c10@1147, c10@1336, c7@2191, c9@758, and c1@4472 on five unique measured attacks. The c9@758 shot was selected after the original c9@2163 candidate's flash check disagreed by one frame; all five final plan events pass `kverify.py`. The upstream `check.py` reports zero duplicated frames, zero motion stops, and ten one-frame jumps, all on planned kills/accents/cuts/transitions. Peak guard measured −1.32 dBFS; integrated loudness is −8.2 LUFS. Remaining upstream warnings include four unmeasured source gunshots (the first is +26.8 ms from its hit), three unmeasurable source flash checks, two unmeasurable bumps, and an unverified constant song grid. These remain warnings, not verified successes.

## Root cause report

| Regression | Source/runtime evidence | Effect on output |
|---|---|---|
| The app bypasses upstream timeline construction. | `apps/desktop/shared/director.ts::buildRuleProposal` orders reviewed event windows and looks for nearby attacks; it does not invoke `draft_ref_timeline.py` or construct the upstream beat-domain `SEGS` schedule. | The exported project had fixed 3.25 s clips, no upstream dynamic pacing, and no beat-driven velocity schedule. |
| The master render uses the app's smaller FFmpeg graph. | `services/worker/render.py::render_montage` calls `_build_filter_graph`; that graph applies the app schema's effects and transitions. It does not execute upstream `render.py`, `audio.py`, or the upstream `run.sh`. | The app baseline recorded one 1.018 impact zoom, no RIFE segments, no transitions, and no upstream layered sound design. Module presence in the repository was not an active render path. |
| App timeline audio sync cannot move a kill onto an attack. | `services/worker/render.py::preflight` audits existing impact timing against measured markers; the active render graph consumes that timeline. | The app can reject impacts that miss attacks, but cannot reproduce the upstream planner's shot/cut movement. At the upstream drop offset, strict preflight rejected three app impacts. |
| Older events did not retain enough verification context and one shot was one frame early. | Current `services/worker/upstream.py::detect_kills` runs upstream verify/rank; its adjacent-frame check now tests K−1/K+1 when an ammo candidate is suspect. The older project recorded c7@2190. Fresh upstream `kverify.py` found c7@2191 is the verified shot frame. | The correction preserves original evidence and records `frame_correction`; the user project itself still has to be refreshed/reviewed to replace the older event. |
| Two detections of the same kill-feed row became separate clips. | The app baseline contains c9 events at 2163 and 2167, with feed frames 2173/2174 and impacts 66,667 µs apart. Their 3.25 s source ranges overlap 97.95%. The older project timeline did not group them. | The same footage plays twice in adjacent clips. New rule proposals collapse duplicate upstream detections tied to the same feed row/shot neighborhood; imported timelines are now flagged and blocked. |
| QA previously allowed a technically valid file to look like a finished edit. | `services/worker/quality.py::run_quality_control` checked codec, frame count, manifest, and scheduled effects; it did not check near-identical source replays or whether a multi-kill Smooth/Clean timeline actually scheduled slow motion, motion blur, contextual accents, and a transition. | The supplied MP4 could receive a non-failing technical report despite missing music and edit structure. New QA/preflight gates make these conditions explicit. |

The **frame-count failure is not reproduced** by the current local auditor. Re-auditing the supplied file counts 2,340 decoded frames from FFprobe's per-frame timestamp pass, matching an independent probe. The supplied render still fails for real reasons: no music while 75% beat sync is requested, a near-duplicate c9 replay, no scheduled RIFE/speed ramp, and missing minimum Smooth/Clean edit structure.

## Upstream-to-app feature parity

| Capability | Upstream reference render | App baseline/runtime | Current status |
|---|---|---|---|
| VALORANT kill detection and shot verification | `kills_auto.py`, `kverify.py`, `kill_rank.py`; all five final events verified | Adapter can call these for candidate review; current exported project contains an older one-frame c7 event | Partially adopted; refresh the project event before export |
| Duplicate shot suppression | Upstream `kill_rank.py --no-dupes` plus timeline check | New rule proposal filters matching upstream feed/shot evidence; preflight rejects near-identical separate clips | Guard repaired; existing user project still needs the duplicate clip removed |
| Music onset detection | Upstream sample-domain `music_hits.py`/`beat_hits.py`; 921 measured attacks for this track | App stores measured attack markers and requires unique assignments within 80 ms | Analysis/gate connected; app still cannot reposition shots to the marker |
| Dynamic musical timeline | `draft_ref_timeline.py` uses measured attacks, lead frames, kill levels, take length, drops, and velocity anchors | `buildRuleProposal` remains window-based and does not call the planner | **Not at parity; main quality blocker** |
| RIFE | Original `prep.py` and real subframe store; `check_store.py` reports no missing/coarse frames or duplicate-source-frame repairs | App can run `render_rife_segment` when a slow segment is scheduled; this project schedules none | Capability exists, but absent from the app baseline output |
| Speed ramps/reverse | Upstream reference timeline emits anchored slow-motion/real-time maps; final project uses selective 0.15–0.23× slow sections | App schema/render supports forward time remap and RIFE; current project is all 1× | Missing from app output; reverse slow motion not integrated with upstream renderer |
| Visual effects/transitions | Upstream render executed blur-ins, camera/zoom/spin transitions, radial/flash accents, pulses, and compositing | App graph supports a smaller set (zoom, shake, flash, `tmix`, dip-to-black); current project schedules zoom only | **Not at parity** |
| Audio design | Upstream `audio.py` mixes measured source audio, music, risers, booms/swishes, and limiter with sample timing | App path uses its own FFmpeg audio graph and does not run upstream sound design | **Not at parity** |
| Independent QC | Upstream `check.py`, `gate.py`, `check_store.py`, `kverify.py`; output reviewed | App frame count is decoded and reported; new gates reject missing quality floor and repeated source windows | Technical QA improved; perceptual effect checking and upstream gate integration remain |
| 2560×1440/144 FPS | Upstream reference pipeline is native 1920×1080/60 FPS | App can export 2560×1440/144 FPS | Enhanced profile remains unvalidated; baseline parity must come first |

## Repairs made in this pass

- Added adjacent-frame verification to `services/worker/upstream.py::detect_kills` and a regression fixture for uniquely verified neighbor correction.
- Added `removeDuplicateUpstreamShots` to `apps/desktop/shared/director.ts::buildRuleProposal`, using the upstream kill-feed frame and 60 FPS shot frame evidence to avoid replaying one shot as two clips.
- Added `find_near_duplicate_plays` and a `source_replay` QA gate in `services/worker/quality.py`; `services/worker/render.py::preflight` blocks overlapping duplicate clips.
- Added a multi-kill Smooth/Clean quality floor for slow motion/ramping, zoom plus motion blur, a contextual flash or shake, and a restrained transition. Preflight blocks a master timeline that omits those scheduled requirements; QA reports `REQUESTED_BUT_MISSING` instead of a false pass.
- Kept frame counting based on FFprobe per-frame timestamps with `-count_frames` fallback; the real supplied output now reports 2,340 counted frames.
- Produced and reviewed the upstream native golden and corrected rerender. The corrected render is a reference artifact; it is not wired into the app master renderer yet.

## Current validation

Latest focused tests after the guard changes:

- `python -m unittest discover -s tests -v`: 43 passed, including the real FFmpeg end-to-end fixture.
- `npm test -- --run`: 11 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.

The upstream `check.py`/`gate.py` review is separate from these app tests; it found no gate errors in corrected B but retained five warnings.

## Remaining work and limits

1. Wire the upstream reference-style planner and its `render.py`/`audio.py` execution into the app's real master render job, with cancellation, progress, failure cleanup, and Windows path handling.
2. Convert the generated upstream anchors/effects into the app's versioned integer-microsecond/output-frame project model so the accepted result remains editable in the app. Current app-sidecar timeline edits do not represent the full upstream schedule.
3. Create a controlled app/upstream A/B at the same source selection, music section, timeline, output profile, and baseline 1080p60. The current app cannot produce that baseline at the upstream main drop; the diagnostic app attempt was stopped by strict preflight.
4. Close the upstream warnings for unmeasurable flash/audio/bump cues, listen to the final audio mix, and review a complete app-integrated output before claiming aesthetic acceptance.
5. Only after baseline parity, implement and validate the 2560×1440/144 FPS path, including temporal mapping, no duplicate/frozen frames, and synchronized audio.

Until these items are done, the app's editing-quality restoration is **not complete**, and the corrected upstream render must not be presented as an app render.
