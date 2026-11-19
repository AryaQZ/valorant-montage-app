# Audit progress

- Inventory created from current source and pinned upstream. Existing unpublished changes were preserved.
- Real native worker run started against verified local input hashes. Audit outputs are isolated from original media and projects.
- Initial code findings under reproduction: clip trimming discards remap, native hash changes on integer-shaped float serialization, unknown peak reports PASS, and visual effects are reported as executed based on the manifest.
- Real UI run exposed and confirmed a duplicate import and an FFmpeg reverse audio routing failure. Both were corrected and regression-tested.
- FFmpeg negative QA fixture flagged wrong format/cadence, duplicate/black frames, silence and duration drift. Real cancel/retry and decoded 1440p144 recovery output completed.
- Actual RIFE prep completed and the pinned stock compositor rendered a 72-frame comparison. Native full decode/beat check and latest production UI run are still in progress.
- Final Python and desktop suites passed 60 and 15 tests. Packaged UI ran both basic previews and produced the 88-frame 1440p144 master, then reproduced controlled failure on the edited complex reverse scenario.
- Native render decoded all 718 frames. Five independent music deltas were within 9.03 ms, ACE was found by local template comparison, and the native gate recorded two visual failures.
- Audit ended with an explicit NOT READY gate. No candidate version was installed or promoted.
- Follow-up isolated the saved ramp/reverse failure to undersampled video and FFmpeg time-stretch buffering for several millisecond-long segments. The exact rough render now decodes 35 frames and its master decodes 161 frames at 144 FPS, with thirteen fresh RIFE segment files.
- Added missing gameplay relink and autosave selection. The packaged UI restored the relinked source and edited timeline after a renderer reload. Initial rendering of the follow-up native plan corrected the muzzle flash but still failed the pixel gate for frame stalls and incorrect RGB onset. A second native attempt was started through the application's preview control.
- Automated follow-up checks passed 62 worker tests and 15 desktop tests, including collision handling for existing exports and project JSON. The unmodified candidate executable loaded its bundled production renderer.
- Native 1080p60 preview decoded in the packaged editor with zero gate errors and six warnings. Independent AAC and source-template checks verified five beats, the final action and ACE. Desktop shortcut updated to the verified 0.1.11-qa.2 bundle. Production readiness remains open.
