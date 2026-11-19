# Bug audit

| Severity | Defect | Root cause and correction | Evidence |
| --- | --- | --- | --- |
| P1 | Trimming silently removed speed edits and reverse playback | The editor replaced the remap with one 1× segment. Range changes retain the intersecting speed segments and only extend new footage at 1×. | Unit regression and packaged UI preserved 15 segments including reverse after trim. |
| P1 | Reverse replay with source audio caused FFmpeg failure | Audio was split for every segment, including reverse segments that intentionally use silence. Only forward segments now receive source audio pads. | Real repro showed `asplit ... unconnected`. FFmpeg regression decoded 24 frames and AAC. |
| P1 | Flash appeared in the manifest while the picture was unchanged | FFmpeg eq evaluated brightness at filter setup. Per-frame evaluation now applies the timed expression. | Actual baseline pixel difference 0. Fixed frame 10 luminance delta 65.99. |
| P1 | Standalone shake was visually identical to baseline | At unity scale, FFmpeg zoompan clamped both position offsets. A bounded dynamic crop margin now permits movement. | Before 0. After peak difference 10.01 gray levels. |
| P1 | Reopening native draft could invalidate an unchanged project | JSON integer and integer-shaped float representations produced different hashes. New draft metadata uses a versioned canonical numeric hash. | Actual real-draft legacy error reproduced, canonical read recovered 718 frames. Previously written v1 hashes retain their original path. |
| P1 | Project opened with blank preview when proxy was removed or relocated | Loader trusted stale cache references. It now attempts proxy regeneration from the existing absolute source. | Isolated packaged UI reopened with playable video after injected bad proxy path. |
| P1 | QA called effects successful from manifest alone | The legacy gate accepted effect names as output evidence. It now reports MANIFEST_ONLY and requires review. | Injected manifest-only test; actual before/after effect pairs reveal both false positives. |
| P2 | Duplicate import created duplicate media | Fresh worker-generated IDs hid identical paths. Renderer deduplicates Windows paths and keeps the existing media ID for timeline references. | Packaged UI test failed with two entries, then passed with one. |
| P2 | QA passed an unmeasured peak | The check treated None as success. Missing measurements now produce WARN. | Actual failed assertion before the fix and passing injected test afterward. |

Save As was a missing workflow. It now explicitly opens a new destination picker. Its Unicode filename and original-file preservation were verified in the packaged renderer.

## Follow-up repairs

| Severity | Defect | Root cause and correction | Reproduction after the fix |
| --- | --- | --- | --- |
| P1 | A saved 15-segment ramp and reverse exhausted memory or failed the preview | A trim interval could sit between source video timestamps. Short forward audio could also yield no samples from FFmpeg's time-stretch filter. The renderer now supplies local video samples and bounds time-stretch input with silence while preserving authored output duration. | Exact project produced a playable 35-frame preview and a 161-frame 1440p144 master. The packaged UI played the preview. The worker decoded both files and checked the frame count. |
| P1 | Missing source had no recovery action | Opening a project now identifies missing gameplay video. The user can relink the original after metadata checks, while highlights and time remaps keep their existing source ID. | Packaged UI relinked the exact original, played the regenerated proxy, and did not rewrite the opened JSON file. |
| P1 | Standard export could overwrite a matching project sidecar | FFmpeg published final paths before completing QA and opened JSON files for overwrite. Publication now follows QA and reserves new sidecar paths exclusively. | An export collision with an existing movie or project left the original bytes intact and removed the new partial reports. |
| P1 | Native picture paused on the outgoing slow-motion join | Several very slow samples just before a fast entry showed very little visible motion. Motion-driven joins now retain their whip and give a slow outgoing take a short camera lead-in. | The same requested source/RIFE positions produced a fresh 718-frame preview without the prior stall. |
| P1 | Native muzzle flash failed the shot-frame check | View warping and the style pulse obscured the identifiable flash. The worker now checks affected shots locally and stabilizes a shot window when the flash appears early, keeping its RGB burst. | The full native render had no flash-frame or RGB-onset errors. Six picture/audio warnings remain, including two unmeasured muzzle flashes and some flash spreading around one hit. |
| P2 | Rough preview preflight ran master-only checks | The preflight endpoint dropped the requested render mode. It now gives preflight and the job the same mode. | Both preview modes and master completed from the packaged UI. |

An explicit autosave recovery control restored the edited project and relinked footage after a renderer reload. Abrupt application exit and worker restarts are separate tests.

## Remaining defects and limitations

- P0. No open critical defect reproduced. The absence of reproducible data-loss cases does not certify crash recovery.
- P1. Full restart recovery after a crash, music relink, and minimum editing-quality parity still require validation.
- P2. Timeline split/zoom, project deletion UI, encoder selector, standalone song preview, isolated reverse/fallback effects, and lyrics/cover workflows remain incomplete or unverified.
- P3. No new cosmetic pass completed.
