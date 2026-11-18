# Test matrix

| Area | Coverage | Command | Status in this workspace |
|---|---|---|---|
| Python schema/timing/QC | Integer frame conversion, grouped impact references, project ID/path bounds, ranges, effects, speed map, save/load, QC tool failures, audio silence detection and legacy manifest compatibility | `python -m unittest discover -s tests -v` | 26 tests pass, including FFmpeg E2E with grouped impacts; 1440p144, exact decoded frame count, final-file QC PASS and real silent-audio detection are exercised |
| SQLite index | Migration, indexing and update behavior | Included in Python suite | Pass |
| Worker API | Loopback token auth, no CORS, schema route, request size cap | Included in Python suite | Pass |
| Desktop TypeScript | Strict renderer/main/preload types | `npm run typecheck` from `apps/desktop` | Pass after grouped-sequence and UI changes |
| Desktop unit tests | Rule planning, AI proposal bounds, grouped impacts, contextual effects and user approval before apply | `npm run test` from `apps/desktop` | 8 pass |
| Electron bundle | DevKit, main, preload, renderer and assets | `npm run build` from `apps/desktop` | Pass; production bundle built after this QA patch |
| Windows installer | NSIS installer, worker, and license notices | `npm run package:win` from `apps/desktop` | Built successfully after the QA fix; unsigned, and clean installation/uninstallation are not yet verified |
| FFmpeg integration | Generated sources, manual timeline, grouped impacts, 1440p144 render, frame count and QA reports | `python -m unittest tests.test_render_e2e -v` | Pass on local FFmpeg/FFprobe/libx264 |
| Upstream runtime | Python 3.11/OpenCV/SciPy/ncnn Vulkan binding and RIFE v4.25 model | `scripts/setup-upstream.ps1`; worker `capabilities()` | Setup and upstream doctor pass; worker detects kill review and RIFE; NVIDIA GTX 1650 Vulkan device 1 selected. Kill candidates still require human review |
| Windows end-to-end | Packaged-app launch, import real media, annotate, edit, save/reopen, render/cancel | `scripts/demo.ps1`, followed by real media | Packaged build launch and worker-ready UI smoke passed; media import/edit/save/reopen/cancel was not rerun in this QA pass, and the earlier export was not regenerated |
| SIWC account | Sign-in, plan-sharing consent, live models and inference | Use Creative Director panel with user's account | Code is integrated; live account and eligibility unverified |

The test script is `scripts/test.ps1`. A skipped FFmpeg integration path is not counted as a render pass. A packaged application without real-media Windows acceptance remains `WINDOWS UNVERIFIED`.
