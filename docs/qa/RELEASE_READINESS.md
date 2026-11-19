# Release decision

**NOT READY for production.** Windows Desktop launches the local QA build 0.1.11-qa.2. Stage 1 passed on the separate 0.1.11-qa.3 candidate. Its x64 NSIS installer was built and remains unsigned.

## Verified in the local update

- The prior three P1 repros passed scoped checks. The exact saved ramp and reverse cut decoded in the editor and in a new 1440p144 export. The 718-frame native preview had zero errors in the unchanged upstream gate, including the original stall and wrongly placed shot-frame repros.
- Independent decoded AAC inspection measured all five selected hits within 9.03 ms of their output frame. Local frame checks verified the final kill lead-in and matched the ACE template across 67 frames. Reviewed selection was five kills. The raw local detector still proposed six candidates for this recording.
- Missing gameplay relink, autosave recovery after renderer reload and in a new desktop process, manual draft previews, Save As, local rule-mode master export and packaging were verified. 62 worker and 15 desktop tests passed. The unmodified Windows executable loaded from its bundled app ASAR.
- Source media and project fixtures were kept unchanged. All media checks ran locally.
- The 0.1.11-qa.3 package passed 63 worker and 15 desktop tests. Recovery covered relative media paths, relink of gameplay/music/reference, opening an older project with a newer autosave, and crash recovery with an actual render retry. See [stage 1 evidence](STAGE_1_PROJECT_RECOVERY.md).
- The 0.1.11-qa.4 packaged renderer passed the five-kill candidate review and dismissal case. Six raw detections became five user-reviewed timeline entries with distinct source-interval impacts. See [stage 2 evidence](STAGE_2_KILL_REVIEW.md).
- Stage 2 additionally verified timeline mutation and recovery, grouped annotation deletion, headshot cues in two comparison clips, and a fresh native export through the Save dialog. 63 Python and 16 desktop tests passed. Automatic headshot ownership and general detection accuracy require a larger labeled set.

## Remaining release gates

- The native run still had six warnings, including two muzzle flashes and four gameplay-shot onsets that cannot be measured from this case. One shot's flash is visible across two frames. The audio beat deltas are separate verified measurements.
- P0. No unresolved critical defect reproduced in the exercised scenarios. Interrupted publication at the exact boundary between writing QA sidecars and publishing the MP4 is still outside the tested crash window.
- Live ChatGPT account flows, isolated clean NSIS install/uninstall, a full viewport and keyboard sweep, alternative hardware encoders, long high-quality output, missing-RIFE recovery and full upstream parity remain open. The matrix also records unavailable features such as timeline split, timeline zoom and project deletion.

Current coverage is 100 rows with 72 scoped PASS, 0 reproduced FAIL remaining in those checks, 22 BLOCKED and 6 NOT IMPLEMENTED. A scoped PASS may retain warnings and does not certify an entire feature family. The initial audit gates and failed intermediate run are retained as evidence.
