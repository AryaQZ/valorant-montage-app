# Development checkpoint 0.1.1

## Replay impact and ending coverage

- Replay candidates use the opposing-team feed row and ammo evidence. When the nearest ammo signal is transient, prefer an earlier verified candidate if its glyph change persists and it still fits the feed delay. Ownership review remains part of selecting replay kills.
- **Mark final action start** saves a source position before the last impact. A marked ACE also gets an automatic lead-in when there is no explicit action mark. Native planning moves the final cut onto a music subdivision, keeps the approach at real time and preserves the preceding kill's confirmation. Director shows the action and ACE review points.
- Native export checks decoded frames at the action start, the approach and the chosen shot against source pictures. The actual shot remains on the chosen drum attack.
- For an older replay project, rerun **Find kills** and review the replacement impact before regenerating the draft. An already-reviewed event keeps its saved frame until the selection is updated. Existing source recordings continue to be referenced in place.

## Windows x64

- The Desktop shortcut uses the portable executable under apps/desktop/release/win-unpacked.
- The separate NSIS package for this checkpoint is apps/desktop/release/VALORANT-Montage-Studio-0.1.1-Windows-x64.exe.
- Run scripts/test.ps1 for the worker and desktop checks and scripts/build.ps1 for the normal installer build.

## Local acceptance

- 56 Python tests, 11 desktop tests, and TypeScript validation passed.
- The portable bundle contains the matching worker files. The Desktop shortcut now resolves to the 0.1.1 executable. The 0.1.0 portable build is retained under apps/desktop/release/previous-win-unpacked-0.1.0.
- The real replay regression retained five impacts. The final source shot moved from frame 2134 to 2130 after verifying the sustained ammo change. The final take starts at output frame 503 and reaches the shot at frame 613. Native QA matched source frames 2022, 2076, 2128 and 2130 in the decoded output.
- Windows x64 installer SHA-256 is DEEA1445746D2EC01FF8ED56655E0625E98B7F815E124089A97FF0C5F220A75D.

## Inspector patch 0.1.2

The Inspector derives each slider fill from its value and bounds. The values and labels stay linked to keyboard-accessible range inputs. The FFmpeg badge uses a short status with the full version in its tooltip.

Verified ten rendered slider states in an isolated Electron session, including range endpoints, keyboard adjustment, save and reopen, and the impact zoom control. The Inspector had no horizontal overflow in the test window. The Desktop shortcut points to the 0.1.2 portable build under apps/desktop/release/win-unpacked-0.1.2.

## UI and workflow checkpoint 0.1.3

- The app version is visible in the header and Windows title. The Desktop shortcut launches the versioned portable build under apps/desktop/release/win-unpacked-0.1.3. The matching NSIS installer is apps/desktop/release/VALORANT-Montage-Studio-0.1.3-Windows-x64.exe.
- Kill review starts with automatic candidate search or manual marking. Manual marking can capture the paused source timestamp and suggest one and a half seconds of footage on either side. The timeline shows the actual native draft takes, duration and output format. The review player reports real source times and identifies the final approach and ACE markers.
- The export dialog blocks the gameplay-only path while beat sync requires music, and offers to import a track or disable sync. Export review follows keyboard focus rules. Acknowledgements and results reset on project changes, and a manual preview loads only after its render finishes.
- Verified the packaged renderer in isolated Electron at standard and compact sizes, including 125% zoom. Exercised the manual path from import to playable preview and final export, native draft review, and project isolation. The synthetic export had one identical-frame warning. The native draft review uses source footage until export. The 56 Python tests and 11 desktop tests passed.

## Populated UI regression checkpoint 0.1.4

- Candidate review places instructions and timestamps above wrapping action buttons. Technical diagnostics are expandable. Opening a candidate brings the source player into view, and returning restores focus to that candidate.
- Reproduced six confirmation labels exceeding 23-pixel icon buttons in 0.1.3 across five window and zoom combinations. For 0.1.4, tested 45 populated screen and viewport combinations through 150% zoom, with zero clipped action labels or controls detected. The run covered candidate review, manual annotation and clip inspection, local Director proposals, music import, export dialogs, and the render result panel. The candidate response was a synthetic fixture at the worker boundary.
- TypeScript, 56 Python tests, and 11 desktop tests passed. The Desktop shortcut points to the 0.1.4 portable bundle under apps/desktop/release/win-unpacked-0.1.4. The matching installer is apps/desktop/release/VALORANT-Montage-Studio-0.1.4-Windows-x64.exe.

## Source player checkpoint 0.1.5

- In the desktop layout the intrinsic grid row could make the video taller than the clipped player. At a 1918 × 960 content area the video measured 728 pixels high in a 508 pixel player. The video element now fills the player bounds and uses aspect-ratio-preserving containment. The source label explicitly identifies playback without montage effects.
- Verified full frame geometry on the original 848 × 478 recording around 29.89 seconds and after adding a highlight, and on a synthetic edge fixture across five window and zoom combinations. Electron pixel capture confirmed all four synthetic borders at desktop size. 56 Python tests and 11 desktop tests passed.
- The Desktop shortcut points to the 0.1.5 portable build. The matching installer is apps/desktop/release/VALORANT-Montage-Studio-0.1.5-Windows-x64.exe.

## Director effort checkpoint 0.1.6

- Director exposes Automatic and Low, Medium, High, Extra High and Max for supported model IDs. Explicit choices are stored locally and set the Responses request's reasoning effort. Automatic and other model IDs use their model defaults.
- The project cap is labeled in Indonesian and refreshes after failed attempts. The Director disables remote draft and connection-test actions when the project reaches its cap. Local drafts remain available.
- Verified the packaged renderer, preload and Responses SDK with a simulated response endpoint. Checked explicit effort in the outgoing JSON, omission in Automatic and for a model outside the allowlist, failure counting, the five-attempt cap, compact layout at 150% zoom, and setting persistence on restart. No live account requests were issued. 56 Python tests and 11 desktop tests passed.
- The Desktop shortcut points to the 0.1.6 portable build. The matching installer is apps/desktop/release/VALORANT-Montage-Studio-0.1.6-Windows-x64.exe.

## Kill review checkpoint 0.1.7

- Rescans show unsaved candidates for the selected source. Saved highlights display timestamps and have an undoable delete action that also removes any montage clip containing the deleted highlight. The other highlights remain available.
- Candidate playback uses the worker's in/out range, with bounded seek, pause at the end, replay, and a separate full-source action. Adding single clips from confirmed automatic candidates bounds the source range between neighboring saved impacts, preserving retained speed and effect settings. Existing projects can apply the same repair from the timeline.
- The packaged Windows UI exercised a fixture with three overlapping candidate windows. Verified bounded playback and replay, no duplicate candidates after rescanning, three source windows with distinct impacts and speed ramps, remove and re-add, and repair after opening a legacy project. 56 Python tests and 11 desktop tests passed.
- The Desktop shortcut points to 0.1.7. The matching installer is apps/desktop/release/VALORANT-Montage-Studio-0.1.7-Windows-x64.exe.

## Single-kill review checkpoint 0.1.8

- The worker preserves the detected streak in evidence and classifies each candidate as one shot. Saved automatic events show Single kill. Opening editable projects removes the old imported multikill tag from automatic events, while intentional grouped clips still use their included-event count.
- Review uses a bounded player for both timeline clips and candidates. Replaying a timeline clip starts at its in point. The repair action remains available on timelines with eligible automatic clips and explains when the ranges already meet the boundaries.
- Validated the packaged Windows UI using two copies of actual autosaves and the existing local preview of the original footage. The first two clip ranges meet at 24.933334 seconds after repair. Tested both playbacks to their endpoints, restarting the first clip, and saving all three corrected tags. The original autosaves were preserved. 56 Python tests and 11 desktop tests passed.
- Desktop points to 0.1.8. The matching installer is apps/desktop/release/VALORANT-Montage-Studio-0.1.8-Windows-x64.exe.

## AI kill review checkpoint 0.1.9

- Review kill offers optional AI triage above the local scan. After user approval, Studio scans locally and sends only indexed timestamps, confidence scores and boolean detector signals for unsaved candidates. The selected Director model and effort apply. The request uses one project allowance when sent.
- The AI can prioritize existing candidates for manual review. It cannot change a timestamp, add a kill, remove a candidate or confirm ownership. Local results remain available if AI output is invalid or the request fails.
- Verified the Windows UI and request through the bundled SDK with synthetic candidates and simulated Responses. The checks covered declining consent, ranking and labels, metadata privacy, invalid output fallback, the local path and allowance counting. 56 Python tests and 13 desktop tests passed. Accuracy against live gameplay was not measured.
- Desktop points to 0.1.9. The matching installer is apps/desktop/release/VALORANT-Montage-Studio-0.1.9-Windows-x64.exe.

## Candidate playback checkpoint 0.1.10

- Candidate previews and newly confirmed single-kill highlights now use boundaries from all known same-source impacts, including unconfirmed detections. The earlier implementation only applied those neighboring boundaries in the timeline. Existing single-kill timeline repairs can also use the current scan's unconfirmed candidates.
- Ran the packaged Windows editor's actual local detector on the original 39.07-second replay and obtained the six matching candidates. Before confirmation, played the 24.20- and 25.67-second candidates to their endpoints; the clips were 22.200000–24.933334 and 24.933334–26.916667 seconds. Confirmed and added the second before the first, replayed it, and verified both saved clip boundaries.
- 56 Python tests and 14 desktop tests passed. The Desktop shortcut points to 0.1.10. The matching installer is apps/desktop/release/VALORANT-Montage-Studio-0.1.10-Windows-x64.exe.

## Application audit follow-up 0.1.11-qa.2

- The desktop worker renders saved subframe ramps and reverse segments, supports effects preview for the native draft, and publishes new exports without overwriting existing sidecars. The editor offers gameplay file relink and local autosave recovery.
- Tested the exact saved ramp and reverse project in the packaged editor and at 1440p144. Native five-kill preview decoded 718 frames, with zero upstream QA errors and six warnings. All five decoded music accents landed within 9.03 ms of their shot frames, with the final action and ACE verified from the local render.
- 62 Python and 15 desktop tests passed. The Desktop shortcut points to `apps/desktop/release/win-unpacked-0.1.11-qa.2`. The unsigned installer is `apps/desktop/release/VALORANT-Montage-Studio-0.1.11-qa.2-Windows-x64.exe`, SHA-256 `B7A804AD79CFB1F6423933774E2C8F166F16D97424201EBD80D40035BBE2E68B`. The old 0.1.10 bundle remains available.
- Regenerate a previously saved native draft to apply the new picture stages. Full production release readiness remains open in `docs/qa/RELEASE_READINESS.md`.

## Project recovery checkpoint 0.1.11-qa.3

- On a separate Windows QA profile, forced Electron and worker interruptions while the editor was open and while FFmpeg was writing. Worker restart, partial cleanup, autosave recovery, and actual render retry passed. Prior export and source hashes matched.
- Relative Unicode paths, newer autosave preservation, music relink without changing the beat grid or offset, and style reference relink passed. 63 Python tests and 15 desktop tests passed.
- The release checklist records stage 1 complete. The Desktop shortcut currently launches 0.1.11-qa.2. See `docs/qa/STAGE_1_PROJECT_RECOVERY.md` for verification and remaining limitations.

## Kill review checkpoint 0.1.11-qa.4

- Added project-persisted candidate dismissal and recovery. A dismissed candidate is excluded from fresh review and from nearby clip bounds.
- In a local five-kill replay, dismissing the extra 34.60-second candidate restored 1.55 seconds of lead-in to the final reviewed kill. A new Studio process reopened and rescanned the project. Five distinct single-kill windows were saved through the packaged UI.
- 63 Python and 15 desktop tests passed. This is the first verified case of stage 2. See `docs/qa/STAGE_2_KILL_REVIEW.md`.
- Stage 2 signoff added grouped highlight deletion recovery, real timeline control coverage, separate headshot cue measurements, and a fresh native 1080p60 export with final action and ACE verified. The final regression count is 63 Python and 16 desktop tests. The DevKit reasoning-effort patch is part of the Studio build and applies to a clean pinned submodule checkout.
