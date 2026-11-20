# Full QA test matrix

PASS verifies the scoped behavior described in Evidence. FAIL is a reproduced defect. BLOCKED includes incomplete execution, missing account approval, and partial evidence. NOT IMPLEMENTED indicates an absent required feature. The native-only and legacy workflows are recorded separately.

| ID | Behavior | Result | Evidence or gap |
| --- | --- | --- | --- |
| A01 | Windows installer | BLOCKED | `0.1.11-rc.1` NSIS x64 installer built and verified on Windows 11 workstation for fresh install (`0.1.11-qa.3`), in-place upgrade (`→ 0.1.11-rc.1`), stripped-PATH missing-FFmpeg diagnostic, rollback (`→ 0.1.11-qa.3`), clean uninstall, and 16/16 user autosave/settings preservation. Clean non-dev Windows VM test and Authenticode signing remain open. |
| A02 | Packaged startup | PASS | Isolated Electron run exercised the production renderer. The unmodified Windows executable also opened the 0.1.11-qa.2 renderer from its bundled ASAR. |
| A03 | Development startup | PASS | `npm run dev` (`electron-vite dev`) built main/preload, served Vite at `http://localhost:5173/` (`200 OK`), launched Electron, booted the Python worker, and handled renderer `GET /v1/capabilities`. |
| A04 | Editor-to-Director navigation | PASS | In production bundle opened Director, accepted local proposal and returned to settings. |
| A05 | Resizable workspace and zoom | PASS | Populated workspace (3 real videos, music waveform, 4 kill candidates, 2 events, 2 clips, trim & clip inspector) swept across 12 viewport/DPI zoom states (`820×680` to `1920×1040`, `100%–150%`, Edit & Director): 0 horizontal overflow, 0 clipped controls. |
| A06 | Global keyboard/menu actions | PASS | Fixed global `Ctrl+Z`/`Y` hijacking text/numeric inputs (`shared/shortcuts.ts` + 4 unit tests). Retest in packaged UI verified `Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z`, `Ctrl+S`, Windows OS menu (`File/Edit/View/Window`), and input-safe undo. |
| A07 | Escape and modal focus | PASS | Fixed modal-open shortcut guard. Retest verified `<dialog.export-modal>` opens top-layer `:modal`, traps `Tab` focus, blocks `Ctrl+Z`/`Ctrl+S` behind modal, closes on `Escape`, and restores focus to `Ekspor video ↗`. |
| A08 | Progress/notifications | PASS | Packaged UI verified error/info/success toasts + `×` dismiss, `.render-dock` progress bar + `Cancel` button during real 1440p144 export, clean cancellation (`Render dibatalkan pengguna.`), UI recovery, and zero partial/published files. |
| A09 | Close and reopen | PASS | Closed the isolated desktop test process and launched a new one from the production renderer bundle. Opened the saved autosave and decoded the restored source. |
| A10 | Crash and worker restart | PASS | Stage 1 exercised abrupt Desktop/worker exit in the editor and during active FFmpeg. Restored an autosave, removed interrupted partials, rendered again and preserved a previous export by SHA-256. |
| B01 | New project | PASS | Packaged UI tested declining and confirming New Project. The previous autosave stayed readable and the editor cleared after confirmation. |
| B02 | Save and overwrite via approved path | PASS | DOM save through Electron into a new test path; project JSON reopened in the runner. |
| B03 | Save As | PASS | Packaged UI wrote distinct original and Unicode Save As copies. |
| B04 | Open valid project | PASS | Packaged UI reopened project with trim and speed remap. |
| B05 | Reject corrupt JSON/schema | PASS | Intentionally malformed project rejected without clearing the current edit. |
| B06 | Autosave | PASS | Autosave writes local snapshots through the worker; inspected isolated profile after edits. |
| B07 | Recovery UI | PASS | In an isolated profile, reloaded the desktop renderer, opened a genuine autosave through the new button, and confirmed the edited timeline and playable source returned. Abrupt exit is tracked separately. |
| B08 | Delete project with confirmation | NOT IMPLEMENTED | No user-facing project deletion command. |
| B09 | Missing media relink | PASS | Packaged UI relinked gameplay, moved music and a video reference. Preserved ranges, remapping, beat grid and song offset. Wrong-song selection was rejected. |
| B10 | Paths with spaces and Unicode | PASS | Real footage path with spaces; Save As Unicode filename validated. |
| B11 | Relative path resolution | PASS | A project-relative Unicode filename resolved from the JSON location and its video played. Loaded media paths are resolved to absolute paths for rendering and saving. |
| B12 | v1/v2 schema migration | PASS | Schema migration regression tests with v1/v2 fixtures. |
| B13 | Draft fingerprint round-trip | PASS | Integrated hashing code regression with 1.0 and 1; legacy v1 hash tests also pass. |
| C01 | Single video | PASS | Exact original WhatsApp source imported and decoded by production UI. |
| C02 | Multi-select videos | PASS | Packaged UI Open Dialog imported 3 distinct real recordings (`848×478` CFR + two `1920×1080` VFR clips) in one call with thumbnails/metadata, and deduplicated mixed-case repeat imports. |
| C03 | Duplicate imports | PASS | Production UI baseline duplicated identical path; regression kept one media entry. |
| C04 | Invalid or corrupt media | PASS | Actual FFprobe rejected malformed MP4 and MP3. |
| C05 | Cancel import | PASS | Dialog cancellation left media count at zero. |
| C06 | Large media | PASS | Imported, proxied (4.70–5.16 s), and rendered two 118–119 MB 1080p VFR gameplay clips into a 20.17 s 1440p144 master (54.3 MB MP4, 51.4 MB profile cache). Multi-GB stress runs remain separate. |
| C07 | VFR and mixed resolution | PASS | Mixed 848×478 60 CFR and two 1920×1080 VFR (~49.37 / ~49.43 FPS) sources rendered to 2560×1440 144 CFR (2904/2904 decoded frames, 0 duplicates, 0.556 µs max PTS error, -0.021 ms A/V drift). VFR RIFE normalization is covered by unit tests. |
| C08 | FFprobe metadata | PASS | Original source independently counted as 848 × 478 / 60 FPS by FFprobe. |
| C09 | Poster and video proxy | PASS | Actual real source proxy decoded in the production UI; generated VFR fixture has proxy and thumbnail. |
| C10 | Proxy recreation/portable project | PASS | Forced bad proxy path in test project. Packaged UI reopened with playable regenerated proxy. |
| C11 | Visual style reference | PASS | Stage 3 native A/B on the 5-kill project compared no reference (718 frames, fade 0.27 s), real 1080p reference (52.93 s analyzed, 718 frames), and synthetic fade reference (fade 0.567 s -> 728 frames) while preserving all five kills and song sync. |
| D01 | Kill feed and replay fallback | PASS | Fresh original WhatsApp recording through local upstream ingest, feed detection and replay fallback produced six candidates. |
| D02 | Shot and frame mapping | PASS | Fresh scan returned frames 1452, 1540, 1710, 1832, 2076 and 2130 with shot verification. Player ownership requires review. |
| D03 | Headshot evidence | PASS | Sampled two real kill feeds and measured headshot glyph matches. Unverified ownership remained pending in the worker comparison. This is cue validation. |
| D04 | Grouped multikill | PASS | Grouped a pair of independently reviewed shots from the real replay in a QA project. Removing the primary kept the surviving event and clip. Automated grouping cases cover multiple impact counts. |
| D05 | Duplicate candidates and repeated plays | PASS | Schema/candidate overlap regressions and worker duplicate-play gate; no independently labeled false-positive corpus. |
| D06 | Rank and confidence | PASS | Real native plan retained reviewed evidence, ranks and measured beat attachment. |
| D07 | Candidate preview and confirmation | PASS | In the five-kill replay, reviewed the limited last-kill window, rejected and restored an extra candidate, reopened and rescanned the project, then confirmed five independent shots into five clips. |
| D08 | Manual tags ownership and time markers | PASS | Saved and checked manual timing, both Headshot and Multikill tags, and unknown ownership in a packaged-editor test. Closing action and ACE cues were independently verified in the native export. |
| D09 | Final action and ACE | PASS | Native decoded final action matched four source frames; CV template verified the ACE HUD (best correlation 0.996). |
| D10 | Detection failure | PASS | FFprobe rejected an intentionally invalid local MP4. Existing clips and annotations survived, and manual entry remained available. |
| E01 | Music import and local decode | PASS | Real named MP3 was verified and decoded by the native worker and imported by the packaged UI. |
| E02 | Waveform and tempo | PASS | Actual imported song yielded local PCM waveform and BPM. |
| E03 | Measured attacks and strong-beat grid | PASS | Actual upstream music analysis and native plan used five measured attack assignments. |
| E04 | Music offset and length checks | PASS | Worker tests and real preflight reject unavailable/mismatched music for requested beat sync. |
| E05 | Standalone music preview | NOT IMPLEMENTED | No standalone music transport. |
| E06 | Music and gameplay gain | PASS | Five-level gain A/B measured from decoded 48 kHz AAC PCM (-17.03 to -15.81 / -18.35 dBFS across gameplay 0.0–1.0 and music 0.0–0.60). |
| E07 | Ducking and impact audio | PASS | Decoded AAC <350 Hz music band attenuated -3.254 dB during gameplay burst (0.0 dB pre/post). Fixed stereo adelay (:all=1); single-kill 88 Hz and multikill 72 Hz impact SFX landed at 505.17/505.21 ms (target 500 ms) with -120.0 dBFS pre-impact. |
| E08 | Limiter and peak probe | PASS | Actual output peak measured on master (-0.5 dBFS under 150% extreme gain); injected unavailable probe regression warns. |
| E09 | Missing/silent audio | PASS | Real synthetic silent stream and no-audio footage flagged by final-file QA; missing, corrupt, and too-short music blocked in preflight. |
| E10 | Rendered beat synchronization | PASS | Independently measured all five decoded native attacks within 9.03 ms and three aligned manual 60 FPS impacts within 12.79 ms from decoded AAC (+4.99 ms global xcorr). |
| F01 | Rule-only Director | PASS | Rule-only Director produced and accepted an editable draft in packaged UI; rendered afterward. |
| F02 | Native automatic draft and regenerate | PASS | Fresh native project plan produced five selected impacts with measured attacks. Full preview/export assessed separately. |
| F03 | AI account/sign-in/session | BLOCKED | Live sign-in and account eligibility require approved account interaction. |
| F04 | Models and effort | PASS | Packaged Electron with simulated catalog verified model switching, `reasoningEffort` (`high`/`xhigh`/`medium`/omitted on unsupported model), and persistence across app restart. Live account catalog discovery remains gated on `F03`. |
| F05 | Metadata consent and limits | PASS | Packaged UI verified consent checkbox gate, declined kill-review confirmation (0 requests), 0 privacy/credential leaks across 7 captured requests (`<= 19.6 KB`), and 5-request per-project cap in both UI and direct Electron IPC. |
| F06 | AI kill ranking | PASS | Packaged UI verified simulated AI kill-candidate triage reordering & badges on 6 real local candidates, plus malformed AI triage & proposal rejection falling back cleanly to local candidates and `RULE-ONLY DRAFT`. Live ranking accuracy remains gated on `F03`. |
| F07 | AI proposal validation and fallback | PASS | Local schema rejects invented AI events and invalid ranking. No live paid/account request. |
| F08 | Order and duration decisions | PASS | Rule Director sweep on the five-kill project verified deterministic energy-curve ordering, clip durations (1824 frames), and event_weights reprioritization. |
| F09 | Beat priority and style controls | PASS | Verified beat_sync_priority (0.0/0.75/1.5), effects_intensity (0.0/0.45/1.0), and music.offset_us (0/5 s) in Rule Director, manual preflight/render, and native A/B. |
| F10 | Proposal acceptance and persistence | PASS | Packaged UI acceptance and actual rendering exercised; accepted proposal autosave retained. |
| G01 | Clip insertion/deletion | PASS | Packaged editor tested insert, clip removal, re-add, and removal of the primary annotation from a group with a surviving impact. |
| G02 | Range trim and remap preservation | PASS | Packaged UI trim preserved forward ramp and reverse segments; desktop resize unit regression. |
| G03 | Split clip | NOT IMPLEMENTED | No split command on desktop timeline. |
| G04 | Reorder and move | PASS | Dragged the re-added clip to its original position in the packaged editor and verified the saved project order by event ID. |
| G05 | Timeline zoom | NOT IMPLEMENTED | No timeline-scale zoom; window zoom is independent. |
| G06 | Source and timeline playback/scrub | PASS | Source proxy loaded, selected timeline clip scrubbed through its range input and playback stopped at 26.916667 seconds, the clip boundary. |
| G07 | Keys and effect toggles | PASS | Packaged editor enabled impact zoom and saved a 1.05 keyframe at impact alongside a changed trim. Independent rendered-effects checks remain H01–H08. |
| G08 | Speed ramp and reverse | PASS | The exact previously failed trimmed project decoded all 35 rough preview frames and all 161 master frames. The packaged UI replayed the rough file. The synthetic subframe regression also passes. |
| G09 | Music track and markers | PASS | Verified 480-point waveform, 292 measured attack markers, offset_us propagation in Rule Director, preflight gating, and decoded-AAC alignment in manual render. |
| G10 | Save/reopen and undo/redo | PASS | Reopened a reviewed project, used Ctrl+Z and Ctrl+Y after clip removal, then verified the resulting order and edit values in saved JSON. |
| H01 | Impact zoom | PASS | Real A/B decoded luminance difference, approximately 19.62/255 peak mean absolute pixel difference. |
| H02 | Impact flash | PASS | Real old and fixed isolated flash output; 65.99/255 luminance increase at intended impact. Synthetic pixel regression also passes. |
| H03 | Screen shake | PASS | Real old and fixed shake-only output; 10.01/255 pixel difference after overscan. Synthetic pixel regression also passes. |
| H04 | Motion blur | PASS | Fixed 2-frame tmix shift with centered split/blend passthrough; verified 0.000 quiet-frame MAD and 2.782/3.298 peak MAD inside the impact window plus unit regression. |
| H05 | Dip-to-black and native transitions | PASS | Fixed tmix-before-fade PTS shift (max_identical_frame_run=1, exact 6-frame fade curve); native bwhip measured 47.32 RGB MAD at join frame 191. |
| H06 | Forward variable speed/RIFE | PASS | Verified 0.25× RIFE v4.25 optical-flow frames on moving gameplay (mean MAD 4.63 vs lo, 4.72 vs hi, 2.83 vs linear blend across 99 mid-frames) plus 512 s native RIFE store check. |
| H07 | Reverse and FFmpeg fallback | PASS | Rendered 0.5× reverse on real gameplay (180/180 frames PASS, monotonic backward source match 1469->1450) and FFmpeg minterpolate fallback when RIFE model/runtime is absent (231/231 frames, 2.605 mean MAD vs RIFE). |
| H08 | Color/exposure and chromatic effects | PASS | Native 1080p60 A/B (effects_intensity 0.45 vs 0.0) proved impact exposure boost (+10.24 to +22.99 luma), lateral RGB split (left_dx=+1, right_dx=-1..-3, edge |R-B| up to +9.62 vs 0 OFF), and base saturation/contrast grade. |
| I01 | Rough preview 720p30 | PASS | Basic local rule draft rough preview was encoded and decoded in packaged UI. |
| I02 | Effects preview 1440p60 | PASS | Packaged UI rendered and decoded the effects preview of the local rule draft. Individual effect appearance is independently covered in H01–H05. |
| I03 | Native 1080p60 render engine | PASS | A fresh 0.1.11-qa.4 export through the Save dialog decoded 718 frames. Upstream QA had zero errors and six warnings. Independent checks verified five beat deltas, the final shot and ACE. |
| I04 | Master export 1440p144 | PASS | Real-usage 20.17 s mixed-source (3 files, CFR+VFR) 2560×1440 144 FPS master recovered after cancel and project reopen; 2904/2904 decoded frames, 0 duplicates, 0 black, 0.556 µs max PTS error, -0.021 ms A/V drift, final QA path fixed. |
| I05 | Encoder selection and GPU/CPU | NOT IMPLEMENTED | No user-visible encoder selector. Legacy renderer hardcodes CPU libx264. |
| I06 | AAC and known CFR cadence | PASS | FFprobe decoded actual CFR and AAC master; independent checks show -0.021 ms container / -4.834 ms decoded PCM A/V delta. |
| I07 | Render progress/cancel/retry | PASS | Real mid-FFmpeg cancellation at 1.7% on 1440p144 export cleaned partial output with zero publication, followed by reopened-project cache-hit re-export. |
| I08 | File integrity and cleanup | PASS | Actual cancellation partial cleanup checked, and recovery master reopened for QA. Collision regression also confirmed an existing movie or project sidecar survives publication. |
| I09 | Performance smoke | PASS | Local short FFmpeg smoke and real 72-frame upstream picture timing recorded. |
| I10 | Native effects preview in editor | PASS | Opened the reviewed native draft, confirmed rights and ownership, rendered the actual footage, checked the results and decoded the output in the packaged UI. |
| J01 | QA dimensions FPS and frame count | PASS | Injected wrong dimensions, FPS and frame count were flagged from decoded MP4. |
| J02 | Black/frozen/duplicate frames | PASS | Injected black, identical-frame video flagged by real FFmpeg/FFprobe. |
| J03 | Audio drift silence and clipping | PASS | Decoded silence/drift checks and intentional +12 dB clipped-audio fixture (0.0 dBFS) flagged FAIL by worker QA; limiter held 150% gain at -0.5 dBFS. |
| J04 | Beat gate and attack alignment | PASS | Decoded five native attacks within 9.03 ms, three manual 60 FPS attacks within 12.79 ms, rejected misaligned/absent music, and audited the six native warnings (0/6 wrong-frame effects). |
| J05 | RIFE fallback status | PASS | Verified active RIFE v4.25 optical-flow output, missing/partial model (flownet.bin+flownet.param) and missing runtime guards in preflight/native draft, manual FFmpeg fallback (needs_review), and rough_preview PASS. |
| J06 | Visual/transition evidence | PASS | Verified manual & native effects ON vs OFF from decoded RGB frames and documented retained Studio vs upstream differences (including upstream 2-kill length/spacing limit and 3-kill stall observation). |
| J07 | Manifest consistency and QA reports | PASS | Actual worker emitted project sidecar, JSON and HTML with normalized final MP4 path, and inspected deliberate faults. |
| J08 | Lyrics/cover and vertical native presets | NOT IMPLEMENTED | Upstream can supply lyrics, cover and vertical preset. The packaged Studio wrapper does not expose these workflows. |

Total 100. PASS 92, FAIL 0, BLOCKED 2, NOT IMPLEMENTED 6. See [release checklist](RELEASE_TODO.md), [stage 3 evidence](STAGE_3_RENDER_AUDIO_QA.md), [stage 4 evidence](STAGE_4_UI_AI_QA.md), and [stage 5 RC1 evidence](STAGE_5_INSTALLER_RC1.md).
