# Test matrix

| Area | Coverage | Command | Status in this workspace |
|---|---|---|---|
| Python schema/timing | Integer frame conversion, project ID/path bounds, ranges, references, effects, speed map and save/load | `python -m unittest discover -s tests -v` | 16 unit/API tests pass; 1 FFmpeg E2E is skipped because media binaries are not on PATH |
| SQLite index | Migration, indexing and update behavior | Included in Python suite | Pass |
| Worker API | Loopback token auth, no CORS, schema route, request size cap | Included in Python suite | Pass |
| Desktop TypeScript | Strict renderer/main/preload types | `npm run typecheck` from `apps/desktop` | Pass after IPC/path guard and timeline updates |
| Desktop unit tests | Rule planning, AI proposal bounds and user approval before apply | `npm run test` from `apps/desktop` | 3 pass |
| Electron bundle | DevKit, main, preload, renderer and assets | `npm run build` from `apps/desktop` | Pass; bundle inputs include main, preload, and renderer |
| Windows installer | NSIS installer, worker, and license notices | `npm run package:win` from `apps/desktop` | Built: `release/VALORANT-Montage-Studio-0.1.0-Windows-x64.exe` (unsigned) |
| FFmpeg integration | Generated sources, manual timeline, 1440p144 render, frame count and QA reports | `python -m unittest tests.test_render_e2e -v` | Skipped: FFmpeg/FFprobe/libx264 are unavailable on PATH |
| Windows end-to-end | Install, import real media, annotate, edit, save/reopen, render/cancel | `scripts/demo.ps1`, followed by real media | Not yet exercised on a separate Windows install |
| SIWC account | Sign-in, plan-sharing consent, live models and inference | Use Creative Director panel with user's account | Code is integrated; live account and eligibility unverified |

The test script is `scripts/test.ps1`. A skipped FFmpeg integration path is not counted as a render pass. A packaged application without real-media Windows acceptance remains `WINDOWS UNVERIFIED`.
