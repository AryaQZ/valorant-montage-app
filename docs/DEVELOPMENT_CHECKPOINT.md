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
