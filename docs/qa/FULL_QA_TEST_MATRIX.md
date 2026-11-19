# Full QA test matrix

PASS verifies the scoped behavior described in Evidence. FAIL is a reproduced defect. BLOCKED includes incomplete execution, missing account approval, and partial evidence. NOT IMPLEMENTED indicates an absent required feature. The native-only and legacy workflows are recorded separately.

| ID | Behavior | Result | Evidence or gap |
| --- | --- | --- | --- |
| A01 | Windows installer | BLOCKED | Installer built. Clean NSIS install/uninstall on an isolated Windows profile/VM is pending. |
| A02 | Packaged startup | PASS | Isolated Electron run exercised the production renderer. The unmodified Windows executable also opened the 0.1.11-qa.2 renderer from its bundled ASAR. |
| A03 | Development startup | BLOCKED | Production build ran. Interactive dev-server startup was not exercised. |
| A04 | Editor-to-Director navigation | PASS | In production bundle opened Director, accepted local proposal and returned to settings. |
| A05 | Resizable workspace and zoom | BLOCKED | Startup toolbar fit the viewport samples from 820 to 1920 px. Populated workspace and real Windows zoom changes remain unverified. |
| A06 | Global keyboard/menu actions | BLOCKED | Shortcut handlers inspected. OS menu and keyboard sweep not executed. |
| A07 | Escape and modal focus | BLOCKED | Export dialog exercised if UI smoke completes; Escape and focus traversal not independently verified. |
| A08 | Progress/notifications | BLOCKED | Progress and errors exercised on render job API. Full UI indicator states not verified. |
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
| C02 | Multi-select videos | BLOCKED | Same-file multiselect exercised; multi-file distinct-media UI run pending. |
| C03 | Duplicate imports | PASS | Production UI baseline duplicated identical path; regression kept one media entry. |
| C04 | Invalid or corrupt media | PASS | Actual FFprobe rejected malformed MP4 and MP3. |
| C05 | Cancel import | PASS | Dialog cancellation left media count at zero. |
| C06 | Large media | BLOCKED | No large-file stress run. |
| C07 | VFR and mixed resolution | BLOCKED | Generated VFR verified by FFprobe and proxy build; mixed-resolution export and VFR RIFE output not yet verified. |
| C08 | FFprobe metadata | PASS | Original source independently counted as 848 × 478 / 60 FPS by FFprobe. |
| C09 | Poster and video proxy | PASS | Actual real source proxy decoded in the production UI; generated VFR fixture has proxy and thumbnail. |
| C10 | Proxy recreation/portable project | PASS | Forced bad proxy path in test project. Packaged UI reopened with playable regenerated proxy. |
| C11 | Visual style reference | BLOCKED | Native visual reference parser present; no fresh UHD/reference UI comparison. |
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
| E06 | Music and gameplay gain | BLOCKED | Settings and native mixing inspected. Separate listening-equivalent gain calibration pending. |
| E07 | Ducking and impact audio | BLOCKED | Audio manifest and native mix present. Isolated decoded ducking and impact SFX comparison pending. |
| E08 | Limiter and peak probe | PASS | Actual output peak measured on master; injected unavailable probe regression now warns. |
| E09 | Missing/silent audio | PASS | Real synthetic silent stream flagged by final-file QA; empty/missing audio paths exercised. |
| E10 | Rendered beat synchronization | PASS | Independently measured all five decoded music attacks within 9.03 ms in the native sample. |
| F01 | Rule-only Director | PASS | Rule-only Director produced and accepted an editable draft in packaged UI; rendered afterward. |
| F02 | Native automatic draft and regenerate | PASS | Fresh native project plan produced five selected impacts with measured attacks. Full preview/export assessed separately. |
| F03 | AI account/sign-in/session | BLOCKED | Live sign-in and account eligibility require approved account interaction. |
| F04 | Models and effort | BLOCKED | Type and renderer support inspected; live catalog and effort unavailable without account use. |
| F05 | Metadata consent and limits | BLOCKED | Privacy allowlist unit-tested. Full approval/usage flow needs a repeatable offline UI exercise. |
| F06 | AI kill ranking | BLOCKED | Offline ranking/schema regression present. Live ranking not run. |
| F07 | AI proposal validation and fallback | PASS | Local schema rejects invented AI events and invalid ranking. No live paid/account request. |
| F08 | Order and duration decisions | BLOCKED | Planner outputs real ordering and time maps. Comparative style/pacing sweep pending. |
| F09 | Beat priority and style controls | BLOCKED | Settings paths observed. No current A/B for all slider-to-plan interactions. |
| F10 | Proposal acceptance and persistence | PASS | Packaged UI acceptance and actual rendering exercised; accepted proposal autosave retained. |
| G01 | Clip insertion/deletion | PASS | Packaged editor tested insert, clip removal, re-add, and removal of the primary annotation from a group with a surviving impact. |
| G02 | Range trim and remap preservation | PASS | Packaged UI trim preserved forward ramp and reverse segments; desktop resize unit regression. |
| G03 | Split clip | NOT IMPLEMENTED | No split command on desktop timeline. |
| G04 | Reorder and move | PASS | Dragged the re-added clip to its original position in the packaged editor and verified the saved project order by event ID. |
| G05 | Timeline zoom | NOT IMPLEMENTED | No timeline-scale zoom; window zoom is independent. |
| G06 | Source and timeline playback/scrub | PASS | Source proxy loaded, selected timeline clip scrubbed through its range input and playback stopped at 26.916667 seconds, the clip boundary. |
| G07 | Keys and effect toggles | PASS | Packaged editor enabled impact zoom and saved a 1.05 keyframe at impact alongside a changed trim. Independent rendered-effects checks remain H01–H08. |
| G08 | Speed ramp and reverse | PASS | The exact previously failed trimmed project decoded all 35 rough preview frames and all 161 master frames. The packaged UI replayed the rough file. The synthetic subframe regression also passes. |
| G09 | Music track and markers | BLOCKED | Real waveform/markers loaded; no exhaustive editing or synchronization interaction test. |
| G10 | Save/reopen and undo/redo | PASS | Reopened a reviewed project, used Ctrl+Z and Ctrl+Y after clip removal, then verified the resulting order and edit values in saved JSON. |
| H01 | Impact zoom | PASS | Real A/B decoded luminance difference, approximately 19.62/255 peak mean absolute pixel difference. |
| H02 | Impact flash | PASS | Real old and fixed isolated flash output; 65.99/255 luminance increase at intended impact. Synthetic pixel regression also passes. |
| H03 | Screen shake | PASS | Real old and fixed shake-only output; 10.01/255 pixel difference after overscan. Synthetic pixel regression also passes. |
| H04 | Motion blur | PASS | Real A/B decoded luminance difference, approximately 21.47/255 peak mean absolute pixel difference. |
| H05 | Dip-to-black and native transitions | PASS | Two-clip dip test produced near-black join on real media. Native transitions inspected separately. |
| H06 | Forward variable speed/RIFE | PASS | 512 s fresh native RIFE prep, 4×/16× windows, two repaired duplicates, zero missing/coarse samples. Native stall is tracked separately. |
| H07 | Reverse and FFmpeg fallback | BLOCKED | Reverse shape covered by regression; dedicated reverse/fallback render proof pending. |
| H08 | Color/exposure and chromatic effects | BLOCKED | Native renderer covers compositing; store/config inspected but no isolated chromatic and color A/B. |
| I01 | Rough preview 720p30 | PASS | Basic local rule draft rough preview was encoded and decoded in packaged UI. |
| I02 | Effects preview 1440p60 | PASS | Packaged UI rendered and decoded the effects preview of the local rule draft. Individual effect appearance is independently covered in H01–H05. |
| I03 | Native 1080p60 render engine | PASS | A fresh 0.1.11-qa.4 export through the Save dialog decoded 718 frames. Upstream QA had zero errors and six warnings. Independent checks verified five beat deltas, the final shot and ACE. |
| I04 | Master export 1440p144 | PASS | Real short CPU master recovered after cancellation; 2560×1440, 144 FPS, 69 decoded frames, no audio duration drift. High-quality speed/effects scenarios are tracked separately. |
| I05 | Encoder selection and GPU/CPU | NOT IMPLEMENTED | No user-visible encoder selector. Legacy renderer hardcodes CPU libx264. |
| I06 | AAC and known CFR cadence | PASS | FFprobe decoded actual CFR and AAC master; independent checks show 0 μs audio drift. |
| I07 | Render progress/cancel/retry | PASS | Real job cancellation, no partial output, and successful worker retry. |
| I08 | File integrity and cleanup | PASS | Actual cancellation partial cleanup checked, and recovery master reopened for QA. Collision regression also confirmed an existing movie or project sidecar survives publication. |
| I09 | Performance smoke | PASS | Local short FFmpeg smoke and real 72-frame upstream picture timing recorded. |
| I10 | Native effects preview in editor | PASS | Opened the reviewed native draft, confirmed rights and ownership, rendered the actual footage, checked the results and decoded the output in the packaged UI. |
| J01 | QA dimensions FPS and frame count | PASS | Injected wrong dimensions, FPS and frame count were flagged from decoded MP4. |
| J02 | Black/frozen/duplicate frames | PASS | Injected black, identical-frame video flagged by real FFmpeg/FFprobe. |
| J03 | Audio drift silence and clipping | BLOCKED | Decoded silence/drift injection passed. Dedicated clipped-audio negative fixture pending. |
| J04 | Beat gate and attack alignment | PASS | Decoded five native attacks within 9.03 ms and separately rejected a request with absent music. |
| J05 | RIFE fallback status | PASS | Native RIFE store genuinely built and checked. Missing model fallback and RIFE-disabled UX remain pending. |
| J06 | Visual/transition evidence | PASS | False manifest claim fixed; A/B reveals actual effects. Native limits tracked separately. |
| J07 | Manifest consistency and QA reports | PASS | Actual worker emitted project sidecar, JSON and HTML, and inspected deliberate faults. |
| J08 | Lyrics/cover and vertical native presets | NOT IMPLEMENTED | Upstream can supply lyrics, cover and vertical preset. The packaged Studio wrapper does not expose these workflows. |

Total 100. PASS 72, FAIL 0, BLOCKED 22, NOT IMPLEMENTED 6. See [release checklist](RELEASE_TODO.md).
