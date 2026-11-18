# VALORANT Montage Studio — Codex Build Instructions

**Status:** Implementation handoff, v1.2 (ChatGPT subscription sign-in as primary AI provider) — 2026-11-16  
**Agent:** Prefer GPT-6 Astra / High for architecture and integration; GPT-6.1 Sol / High for feature implementation and tests.  
**Request:** BUILD AND TEST THE APPLICATION. Do not stop after planning or producing mockups.

## 0. Agent operating instructions

You are the lead full-stack desktop engineer, video-processing engineer, computer-vision engineer, audio engineer, and QA lead for this project. Create a functional local-first Windows desktop app in this repository, with automated tests, reproducible setup, and a verifiable end-to-end demo. Follow iterative vertical slices. Do not claim features are functional unless they run against fixtures or real media. Make sensible default decisions autonomously; document assumptions. Never claim professional-grade montage fidelity without evaluation on user footage.

**Execution contract:**
1. Inspect the repo and environment first. If empty, initialize it.
2. Create `docs/architecture.md`, `docs/decisions.md`, `docs/test-matrix.md`, `README.md`, and `AGENTS.md`.
3. Implement Phase 0 and Phase 1 with working code, run their tests, and continue phases in priority order as time allows.
4. After every vertical slice, run tests, capture results, fix regressions, and commit if allowed.
5. Keep the repo runnable at all times; never replace incomplete functionality with fake buttons, hard-coded demo events, or fabricated QA success.
6. If a dependency/GPU/Windows feature cannot run in the agent environment, provide a verified CPU fallback or a clearly flagged untested Windows path with a precise Windows test procedure.
7. Make technical tradeoffs explicit. Prioritize correctness of highlight detection and timeline timing over flashy UI and effects.
8. Treat user-provided audio/video as untrusted files. Perform local processing and never upload it without opt-in.

## 1. Product requirements

Name: **VALORANT Montage Studio**.

- **Target platform:** Windows 10/11 x64, Windows-first; optional future Linux/macOS.
- **Primary user:** VALORANT creator importing one or many OBS/ShadowPlay raw recordings.
- **Primary workflow:** import footage → analyze candidates → rank/cluster kills → select music → generate Smooth/Clean montage → review editable timeline → automated QA → export.
- **Video inputs:** MP4, MKV, common H.264/H.265 recordings; variable frame rates (VFR) must be normalized accurately; any input resolution/frame rate must be probed.
- **Master output target:** 2560×1440, 144 FPS, 16:9; dynamic runtime determined by selected valid highlight moments (not a 30-second fixed edit).
- **Secondary export:** 2560×1440/60 FPS for YouTube; never silently substitute 60 FPS for 144 FPS master.
- **Default style:** `smooth_clean`.
- **Default Beat Sync Priority:** `0.75` (75%), a soft preference rather than forcing every kill on beat.
- **Default Effects Intensity:** `0.45` (45%), restrained clean effects; zero effects must also work.
- **Preview:** proxy-based preview, with responsive seeking and waveform/beat markers.
- **Editing:** non-destructive timeline, draggable clip selection/order, trim in/out, speed segments, music sync offsets, per-event effects, undo/redo, save/load.
- **Quality:** deterministic checks for clipped moments, frame/audio discontinuity, blackout, silent gaps, duplicated frames where detectable, and render integrity.
- **User rights:** user-supplied audio or licensed assets only; no automatic copyrighted music downloads.
- **Security:** no access to VALORANT game memory/process. Analyze recorded pixels/audio only; no cheat integration or auto-control of gameplay.

## 2. Recommended architecture

### Desktop
- Tauri v2 application hosting React + TypeScript + Vite.
- Desktop app invokes localhost/private child-process Python worker through tightly scoped IPC. Keep CORS restrictive, use process-specific port or stdio IPC, and authenticate requests with an ephemeral token if using HTTP.
- UI is responsible for media library, analysis status, highlight review, editable timeline, style controls, render progress and QA report.
- Support keyboard shortcuts and cancellation. Use platform-aware file dialogs.

### Python processing worker
- Python >= 3.11, strict typed interfaces, Pydantic for schema validation, structured logs.
- FFmpeg/FFprobe subprocesses for video/audio probe, proxies, cuts, mixing, GPU/CPU encoder paths.
- OpenCV for frame/ROI inspection; pluggable OCR (PaddleOCR or EasyOCR, selected for actual environment), plus confidence threshold and cross-frame temporal debouncing.
- `librosa` / `soundfile` for music onset, tempo, beats; distinguish beat from transient onset.
- Audio/visual/event annotations must use integer time units (microseconds or rational frame ticks), never cumulative float arithmetic for timeline render boundaries.
- Durable SQLite project index and JSON or SQLite project timeline (versioned schema) with JSON export. Migrations required.
- Include an integrated, user-selectable AI Creative Director as a shipped feature (Sections 13–14). ChatGPT subscription connection via the official Sign in with ChatGPT (SIWC) flow MUST be the primary online AI provider. A separate paid API key is NOT required for the intended user flow. The rule-based director and end-to-end app MUST remain functional with AI OFF and without a connected ChatGPT account. Keep expensive vision ML pluggable and locally runnable when available.

### Core modules (suggested repository organization)
```
apps/desktop/                 # Tauri/React UI
services/worker/              # Python analysis, planning and rendering worker
packages/project-schema/     # Shared versioned JSON schemas + validation
services/worker/montage/
  media_probe.py
  decode.py
  roi_profiles.py
  kill_detector.py
  event_fusion.py
  event_scoring.py
  audio_beats.py
  edit_planner.py
  timeline.py
  render_graph.py
  audio_mix.py
  export.py
  quality_control.py
  jobs.py
  assets.py
  telemetry.py
fixtures/                      # Generated/synthetic footage + metadata
scripts/                       # Setup, test, build, demo
reports/                       # Test and benchmark outputs
```

## 3. Event detection — implement with evidence, not magic

1. Use FFprobe to inspect streams, duration, resolution, frame rate, rotation, color metadata, audio presence, and timestamp behavior.
2. Generate low-resolution proxies for scanning. Run coarse scan first and high-frequency fine analysis around candidates.
3. Define configurable 16:9 VALORANT HUD ROI profiles. Detect kill-feed updates, kill count changes, headshot indicators, round results, and audio spikes where feasible. Make ROIs configurable to support HUD scale, UI updates, languages, and color variations.
4. Track kill-feed entries across frames to avoid duplicate detection; identify **player-owned kills** when reliably detectable, otherwise mark `owner=unknown` and require user confirmation.
5. Cluster kills into action groups using a tunable inter-kill gap (initial default 4 s; subject to fixture evaluation). Preserve the approach, target acquisition, all kills, clutch payoff, and recovery; never truncate the last kill.
6. Store each detection as evidence with timestamp(s), ROI, extracted text, feature scores, confidence, and supporting frame references. No false accuracy claims.
7. If confidence is poor, allow manual highlight annotation: event time, in/out, headshot, multikill, clutch tags. This fallback MUST support the entire edit→render pipeline.
8. Assess inter-annotator ground truth precision, recall, F1, ±time tolerance and cluster completeness on supplied test videos. Do not overfit one HUD theme.

Event model minimum fields: `event_id`, `source_media_id`, `source_time_us`, `source_frame`, `evidence`, `owner`, `confidence`, `tags`, `cluster_id`, `rating`, `is_user_override`.

## 4. Editing director and timing model

- Implement a rule-based director before experimenting with any LLM.
- Rank by multikill density, headshot evidence, action continuity, clutch/result context, motion intensity, clip readability, audio clarity and duplicate penalty. Weights are configurable, not a claim of objective quality.
- Reject low-confidence or duplicate candidates by default; show them in a review queue.
- Order clips using a deliberate energy curve: orientation → build → peaks → resolution; don't always sort by score or timestamp.
- Avoid making every cut on a beat. Beat Sync Priority 0.75 means a **soft weighted penalty** in the planner; allow off-beat cuts when action readability would suffer.
- Place kill impact at selected music onset/downbeat only if this fits bounded timing adjustments. Default allowed alignment error target <= 80 ms on frame-accurate output for beats that are explicitly aligned.
- Smooth/Clean effect defaults: subtle impact zoom, restrained motion blur, rare luminance flash, small shake, clean transitions, protected crosshair and HUD, no aggressive chromatic aberration by default.
- Effect intensity 0.45 must map to named configurable effect parameters, not a cosmetic UI slider.
- Speed ramps must be defined as explicit piecewise mappings from output time to source time; maintain 144 FPS master timeline. Keep input frame limitations visible. Allow optical-flow interpolation only as explicit optional step with artifact checks.
- A source file recorded at 60 FPS must never be falsely described as **native 144 FPS motion** simply because it was encoded at 144 FPS.

## 5. Timeline editor requirements

Timeline model:
- `Project`: schema version, settings, source media manifest, music reference, edits, annotations.
- `Track`: gameplay video, music audio, gameplay audio, effects, text/optional.
- `Clip`: source media ID, source range, output placement, time-remap segments, crop/transform, transitions, opacity, audio gain, confidence flags.
- `Effect`: type, start/end, numeric parameters, interpolation, enable/disable.
- `Marker`: beat, kill impact, clip cut, user note, QA warning.

Interaction requirements:
- Drag/reorder segments, trim clip boundaries, scrub, zoom timeline, preview selected segment, mute/unmute, adjust mix, move beat marker, and set style parameters.
- Undo/redo deterministic commands. Auto-save to a recoverable local project; ensure media is referenced, not duplicated by default.
- Export independent project JSON alongside rendered MP4. External NLE interoperability (e.g., OpenTimelineIO) is **optional after native timeline reliability**, not a substitute for project editing.
- Validate no overlapping non-composited clips, negative durations, out-of-source trims or time remaps mapping outside the source.

## 6. Render/export requirements

- Model a render graph from the same timeline used by preview; don't use a separate algorithm that results in divergent cuts.
- Support software H.264 baseline; detect NVENC/AMF/QSV encoders at runtime and enable selected encoder after smoke-testing with tiny generated fixture.
- Output profiles:
  - MASTER: 2560×1440 at 144/1 FPS progressive; MP4; H.264/H.265 if supported; AAC 48k stereo; sensible bitrate/quality profile documented.
  - YOUTUBE: 2560×1440 at 60/1 FPS; MP4; AAC 48k stereo.
- Prevent AV drift from source with irregular timestamps. Use integer/rational timestamp arithmetic.
- No silent blackframes, dropped audio, frozen transitions or clipped kill impacts.
- Long render jobs must report progress, support cancel, checkpoint output, and clean partial artifacts.
- Render 5-second and 30-second test fixtures first, followed by full supplied gameplay.

## 7. Automated quality control

### Before rendering
- Validate all media paths, supported codecs, source range boundaries, event confidence and ownership, available disk space, music rights acknowledgement, audio routing, effect parameters and timeline integrity.
- Flag scenes with ambiguous kill detection or clipped first/last actions.

### After rendering
- FFprobe validates codec, dimensions, stream presence, exact output frame rate, duration, audio sampling, and frame timestamps.
- Compare expected and actual first/last frame timestamps against tolerance.
- Analyze black/frozen segments and silence longer than configurable thresholds, with false-positive exceptions for intentionally dark maps / planned silence.
- Verify no unplanned audio clipping; calculate peak and integrated loudness where filter availability permits.
- Validate beat alignment for selected synced markers (threshold configurable, target <=80 ms).
- Produce a JSON + readable HTML QA report, distinguish `PASS`, `WARN`, `FAIL`. No fake perfect 100% scores.
- If QA fails, preserve the output as `needs_review` rather than silently declaring success.

## 8. Implementation backlog, ordered vertically

### Phase 0 — foundations (P0)
- [ ] B-001 Initialize monorepo, tooling and README; runnable dev scripts; license/dependency notices.
- [ ] B-002 Build Python service with structured logging, health/version and cancelable background job API.
- [ ] B-003 Build Tauri/React shell and connect it to worker securely.
- [ ] B-004 FFmpeg capability detection, input probing, metadata fixtures and error handling.
- [ ] B-005 Define shared project/timeline schema and schema-migration tests.
- **Gate:** launch desktop in dev mode; import a generated test video; see accurate metadata; reopen project successfully; all tests green.

### Phase 1 — usable editing/render vertical slice (P0)
- [ ] B-101 Import multiple files with thumbnails/proxies and analysis status.
- [ ] B-102 Manual time-range highlight selection, marking and cluster labels.
- [ ] B-103 Build non-destructive timeline with reordering, trim, save/load, undo/redo.
- [ ] B-104 Render concatenated montage at exactly 2560×1440/144 FPS with working audio, CPU fallback and optional GPU.
- [ ] B-105 Add render progress, preview and cancel, errors surfaced in UI.
- [ ] B-106 Add basic QC: source range bounds, FFprobe output verification, obvious black/silence checks.
- **Gate:** source 2+ recordings → manually select 3 events → edit → 1440p144 MP4 → reopen and reproduce; tests on synthetic fixtures pass.

### Phase 2 — automatic VALORANT event detection (P0)
- [ ] B-201 Configurable HUD ROI calibration view with reference screenshots and per-source profile.
- [ ] B-202 Coarse visual/audio candidate discovery; fine frame analysis around candidates.
- [ ] B-203 OCR/CV kill-feed tracking, temporal deduplication, player-ownership confidence.
- [ ] B-204 Multikill clustering; event cards with evidence snapshots and confidence.
- [ ] B-205 Review queue for ambiguous/missed events and manual correction.
- [ ] B-206 Evaluation harness using ground-truth annotations and per-video F1/recall/precision reports.
- **Gate:** no fabricated detections; all detections trace to evidence; manual fallback always works; quantitative evaluation reports on held-out clips.

### Phase 3 — music intelligence and editing director (P1)
- [ ] B-301 Music import, waveform, beat/onset estimation and manual beat correction.
- [ ] B-302 Rule-based montage highlight ranker and duplicate suppression.
- [ ] B-303 Smooth/Clean edit planner with contextual pre/post-roll and energy curve.
- [ ] B-304 Weighted 75% beat-sync alignment with bounded remap and action-preserving cuts.
- [ ] B-305 Gameplay/music audio mixer, gain automation and clipping prevention.
- [ ] B-306 Automated montage creation command with reproducible seed and explanation log.
- [ ] B-351 First-class `Continue with ChatGPT` subscription login, consent and sharing-state UI, model picker from live account catalog, disconnect/reconnect, protected local token storage; AI OFF remains available. Do NOT require a paid API key.
- [ ] B-352 Strict structured AI planning contract: event metadata, evidence, candidate beat markers, style targets → validated JSON edit decisions.
- [ ] B-353 AI Director orchestrator with constrained tool-less planning, schema validation, retries, time/cost budgets, and rule-based fallback.
- [ ] B-354 Timeline candidate preview, diff vs rule-only baseline, explainable recommendations, user accept/reject per decision.
- [ ] B-355 Feedback preferences persisted locally, with user opt-in for remote model use and explicit media/metadata disclosure.
- [ ] B-356 AI integration tests with a mocked SIWC provider covering denied plan-sharing consent, expired/revoked OAuth token, usage-limit errors, malformed output, network failure, missing account, out-of-range edits, and reproducible fallback.
- **Gate:** import + analyze + choose supplied music + generate timeline + review + export; beat/kill markers inspected on test fixture. AI Director works after official ChatGPT subscription sign-in and consent using a model listed for that account, returning schema-valid reviewable timeline suggestions; without access, rule-only generation works without interruption.

### Phase 4 — effects and video quality (P1)
- [ ] B-401 Editable piecewise speed curves, eased ramps, proxy previews.
- [ ] B-402 Smooth/Clean transition and impact FX library; intensity 45% parameterized.
- [ ] B-403 GPU render capability matrix and safe software fallback.
- [ ] B-404 Optional slow-motion interpolation and artifact flags.
- [ ] B-405 Preserve visual legibility around the crosshair and kill feed.
- **Gate:** deterministic effect rendering verified frame-by-frame; preview/export consistency regression tests.

### Phase 5 — polished desktop release and QA (P1)
- [ ] B-501 Editable multitrack timeline polish, keyboard shortcuts, zoom/scrub, proxies.
- [ ] B-502 Full preflight/post-render QC and HTML report.
- [ ] B-503 Export presets master 144 FPS / YouTube 60 FPS, project backup and recovery.
- [ ] B-504 Installer packaging on Windows, runtime dependency validation, documentation.
- [ ] B-505 Windows GPU compatibility, long-session memory, cancellation and restart tests.
- [ ] B-506 User acceptance testing on multiple real VALORANT gameplay recordings with manual quality ratings.
- **Gate:** a Windows creator can install, import real files, automatically generate a first draft, edit, save, export and inspect QC without using a terminal.

## 9. Testing strategy

Tests are required at three levels:

1. **Unit:** timing, integer frames, speed map round trips, scoring, beat selection, JSON schema, duplicate cluster rules, audio sync math, QC conditions.
2. **Integration:** generated 1440p144 fixtures (with overlay events) using FFmpeg; source import → manual annotations → planner → timeline → render → FFprobe verification; also 60 FPS input and VFR input.
3. **End-to-end Windows:** desktop UI import/select/auto-generate/edit/export; GPU NVENC if present, CPU fallback, missing/invalid media, interrupted render, cache cleanup.

**Performance metrics:** detect rate, false-positive rate, ±ms event localization, beat alignment error, render FPS, memory and VRAM peaks, project reopen fidelity, preview latency, audio sync deviation. Record actual measured values rather than guessed benchmarks.

## 10. Definition of Done

A feature is `DONE` only when code exists, the UI/control is wired end-to-end, a test demonstrates behavior, errors are surfaced, and the feature is documented. A feature that works only with manually entered demo timestamps must be labeled `MANUAL BASELINE`, not `AUTO DETECTION COMPLETE`. A packaged app without tests on Windows must be labeled `WINDOWS UNVERIFIED`.

## 11. Immediate next actions for Codex

1. Start implementing B-001 through B-005 now.
2. Implement B-101 through B-106 immediately afterward, including sample media generation script and end-to-end CPU smoke test.
3. Print a concise completion summary listing actual files, runnable commands, tests executed, screenshots if possible, outstanding requirements, and known limitations.
4. Continue into B-201 through B-206 only after the baseline is stable.
5. **Do not merely produce a plan** or ask the user to start the coding. The task is to write and run the software.

## 12. First user-facing build experience

A) Open the app.  
B) Import recorded gameplay files.  
C) Import an allowed music track (or generate demo audio only for tests).  
D) Select `Smooth / Clean`, master 2560×1440@144 FPS, Beat Sync 75%, Effects 45%.  
E) Click Analyze, review detected highlight cards; manually mark highlights if detection is uncertain.  
F) Click Generate Montage, edit the timeline and preview.  
G) Click Export, run QA and view the results.

**Caution:** The goal is genuine automation and editorial quality, not a promise that raw gameplay of arbitrary HUD settings will be perfectly edited on the first attempt. Collect real annotated clips and reference edits before tuning quality.


## 13. Integrated AI Creative Director (required product feature; cloud optional)

**Goal:** Make the application meaningfully AI-assisted at runtime, not only AI-written during development. This feature is required for the full product, but generation must **never** be blocked by the absence of an online LLM.

### 13.1 Responsibility split

- **Local video intelligence:** OpenCV + OCR + optional specialized vision models extract candidate kill events, ownership confidence, context, and evidence. An LLM never invents events or declares a kill based on unsupported timestamps.
- **Local audio intelligence:** beat/onset/downbeat segmentation, waveform, energy envelope and music structure via signal-processing libraries.
- **AI Creative Director:** consumes structured, evidence-backed event cards and song structure. It recommends selection/order of highlights, pacing/energy curve, scene lengths, beat targets and a restrained Smooth/Clean effect plan.
- **Deterministic timeline validator and renderer:** validates source boundaries, all event IDs, speed mapping, output timestamps, effects safety, and max sync deviation; translates only valid decisions into a timeline. FFmpeg/worker executes the result.
- **Local quality assurance:** checks resulting render independently. AI may summarize QA issues, but cannot overrule objective `FAIL` findings.

### 13.2 Provider modes — revised v1.2 (subscription-first)

Expose AI mode: **ChatGPT Subscription (default)**, **Off (rule-only)**; optional **Local model** (separate future feature). A separately billed OpenAI API/BYO-key integration is **NOT** required and must NOT be shown as the primary method. The user's intended model access is via their own existing ChatGPT subscription and OpenAI's officially supported Sign in with ChatGPT (SIWC) plan-usage authorization, subject to eligibility, restrictions, usage allowance and consent.

- Show `Continue with ChatGPT` and then a distinct state for `Connected – plan usage granted`, `Identity connected – plan usage not granted`, `Reconnect needed`, and `Usage limit reached`.
- Use the account's actual listed models. Recommended preference: `gpt-6.1-sol` with reasoning `medium` for initial montage director planning, `high` for user-triggered refine if supported. This is a **preference**, not a guarantee of catalog availability. Always discover and display supported model slugs dynamically.
- Never scrape ChatGPT web pages, browser cookies, user passwords, private API endpoints or Codex CLI credentials; never claim a normal ChatGPT Plus subscription includes standard API billing.
- Use SIWC only for the authenticated user's own locally initiated workflow, with explicit consent for any automated or background requests. Do not pool usage, resell access, or act as an API proxy for other apps.
- Transmit **only structured highlight metadata and music-analysis features by default**, not raw gameplay, audio, or screenshots. Separate explicit consent and capability checks are required before sending reference images; SIWC does not support raw audio/video input in its current preview.
- Store OAuth credentials in OS-protected local storage, isolated from UI renderer and Python child processes wherever possible. Never include tokens in repo, project files, logs, diagnostics or telemetry.
- Enforce per-project request caps, timeout, cancellation, progress UI, retry limits, and graceful fallback on unavailable subscription allowance. Respect user's ChatGPT per-app usage limits.

The chosen framework may remain Tauri v2 **only if** the implementer proves a secure supported local SIWC OAuth flow and model inference via a privileged sidecar/backend. The documented OpenAI open-source reference is built using an Electron main process and the `@siwc/local` package. If this is materially more reliable for the first functioning Windows MVP, use **Electron + React + TypeScript + Python worker** instead, document the ADR, and verify desktop packaging and token isolation. Prioritize a working supported subscription integration over defending a framework choice.

### 13.3 Structured output contract

AI planner input includes `project_id`, `style=smooth_clean`, `beat_priority=0.75`, `effects_intensity=0.45`, source-backed event IDs/confidences/clusters, allowed clip ranges, beat grid, music sections, render constraints and previously accepted preferences. AI response MUST conform to a versioned JSON schema with:

- `selected_event_ids` referencing only real extracted events; optional exclusions with reasons;
- `clip_plans[]`: event IDs, validated source ranges and ordered timeline slots;
- `beat_targets[]`: beat marker IDs and intended kill-impact IDs, with bounded timing adjustments;
- `effects[]`: allowlisted types and numeric parameters clamped to Smooth/Clean 45% range;
- `rationale[]`: brief plain-language reasons referencing valid evidence;
- `confidence` / `warnings` for uncertain decisions.

Reject and retry invalid or hallucinated events, negative durations, unsupported effects, out-of-source trims, unintended omission of high-scoring multikill clusters, unsafely extreme speed ramps, or edits breaking required context. Persist rule-only baseline and AI draft independently for inspection. AI generation must not modify the committed project timeline until the user approves it, or until the user has enabled a clearly labeled auto-apply setting.

### 13.4 Learning from edits

Record user ratings and explicit changes (`keep/remove event`, trim corrections, swapped clip order, beat offsets, accepted/rejected effects), locally by default. Learn preferences first through adjustable feature weights and retrieval of previous choices; avoid promising automatic fine-tuning of foundation models. Provide `Reset learned preferences`. Do not upload feedback without user consent.

### 13.5 AI definition of done

1. User can connect their ChatGPT subscription through official SIWC, explicitly grant plan sharing, choose a model from live discovered catalog, and test inference without entering or purchasing an API key.
2. Selecting `AI Creative Director` produces a schema-validated montage draft for a project with verified event annotations and a music track.
3. Generated draft includes real event references and is editable in the native timeline; rerender uses the same timeline graph.
4. No subscription consent, expired connection, offline network, usage-limit response, provider timeout, malformed output, or unsupported model gracefully falls back to the rule-only editor.
5. UI shows whether the result came from AI or fallback, usage-limit/consent warnings and what data was transmitted. Do not misrepresent subscription usage as free/unlimited or as separately billed standard API traffic.
6. A/B tests against rule-only drafts on representative user footage assess human-rated pacing, kill retention, beat alignment, effect restraint and frequency of manual corrections. Ship no unsubstantiated claim that AI quality is superior.

**Implementation order:** Build a stable manual timeline + render path first. Implement event detection and deterministic planning. Then wire the AI provider and A/B quality validation as a full product milestone. Do NOT route every frame or full video through a cloud LLM; doing so increases cost/latency and harms temporal reliability.


## 14. ChatGPT subscription integration — MUST IMPLEMENT (v1.2 addendum)

**Non-negotiable user constraint:** The user has an existing ChatGPT subscription only and does not want to purchase a separately billed API key. The app must support official **Sign in with ChatGPT (SIWC)** as the default online AI connection. This is distinct from an OpenAI API-key-based implementation.

### 14.1 Official integration references (verify latest before coding)
- [OpenAI SIWC open-source desktop example](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- [SIWC models & inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [SIWC preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [SIWC terms](https://openai.com/policies/sign-in-with-chatgpt-terms/)
- [ChatGPT plan usage guidance](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites)

At this writing, open-source local and personal apps can use SIWC under its documented rollout/terms; hosted/paid commercial apps may require approval. Do not claim eligibility or successful authorization until tested against the actual user's account.

### 14.2 Required authentication and inference behavior

1. Generate and persist a unique local SIWC host ID. Implement the official system-browser authorization flow with PKCE, a local loopback callback, client registration/returned client ID, scope verification and local token refresh. Prefer the official `@siwc/local` integration where compatible with the chosen desktop host framework.
2. Display plan-sharing consent status separately from mere identity login. Only send inference if the granted scopes include permission for ChatGPT plan usage.
3. Obtain the user's **actual** model list using the authorized `/v1/models` path or `chatgpt.listModels()` per official docs. Display the model name; submit the actual returned slug. Refresh after account switch or reconnection. Never manufacture a model ID or assume Astra/any model is available.
4. For subscription inference, use **`POST https://api.openai.com/v1/responses`** with the OAuth bearer token, `store: false`, `stream: true` and request input as an array. Use `instructions` or developer messages rather than an explicit `role:system` message. Read the full streamed response and treat success only after `response.completed`.
5. Respect the SIWC preview feature subset. In particular do not send unsupported HTTP fields including `temperature`, `max_output_tokens`, `background`, `conversation`, `metadata`, `top_p`, or `previous_response_id`; verify any optional structured-output parameters against the currently documented flow. If constrained JSON output is not natively available, request JSON in the instructions, parse locally, validate against a strict versioned schema, and allow retry or rule-based fallback.
6. Handle `response.failed`, `response.incomplete`, dropped streams, expired tokens, revoked scopes, and `subscription_sharing_usage_limit_exceeded` / `subscription_sharing_usage_unavailable` explicitly. Never auto-switch to a billed API-key provider.
7. Send only metadata unless the user gives opt-in and the selected model accepts image input. The SIWC preview does not accept direct raw audio or video; local OpenCV/OCR and librosa generate the necessary event/music analysis.
8. Keep OAuth token use inside a protected privileged desktop runtime. Do not expose to React renderer, local WebSocket listeners, logs or child-process command-line arguments. If Python needs inference, relay validated, token-free requests through the privileged desktop host rather than handing OAuth secrets to the worker.
9. Add user-controllable app usage monitoring/link to the ChatGPT usage settings, reconnect/disconnect, explicit cancellation, and safe fallback.

### 14.3 Requested model selection logic

Model picker must use **discovered availability**, not a static list. Preferred selection order:
- **Default creative planning:** `GPT-6.1 Sol`, reasoning `medium` when the available model and SIWC preview support the parameter. It is a reasonable quality/latency starting point for structured edit plans.
- **Deep refine / montage QA commentary:** same model with reasoning `high`, user-triggered only; don't rerun for every frame.
- **Astra:** optional for highest-quality one-off editorial decisions if offered in the connected model catalog and allowances permit; do NOT make it a requirement.
- **Local fallback:** deterministic rule-based planner. This is not billed and works offline.

The app's AI Director is not the pixel-level video renderer and does not need to watch every video frame. It receives sparse, grounded events and summaries and returns a *proposal* for the project's validated edit graph. Benchmark against manually edited VALORANT clips before assuming model quality.

### 14.4 Build tasks and acceptance tests (new P0/P1)

- [ ] **B-351A (P0):** Decide Tauri privileged SIWC adapter vs Electron main-process reference; record an ADR with a security threat model and actual test result.
- [ ] **B-351B (P0):** Implement official ChatGPT sign-in, plan-sharing consent and session persistence with protected local storage.
- [ ] **B-351C (P0):** Dynamic account-scoped model list, model picker and connection verification call.
- [ ] **B-351D (P1):** Streaming Responses adapter with compliant request shape, completion verification and explicit usage-limit errors.
- [ ] **B-351E (P1):** Bind to AI Director's schema validator and rule-based fallback; retain fully editable generated timeline.
- [ ] **B-351F (P1):** UI connection state, usage warning, disconnect and redaction tests.
- [ ] **B-351G (P1):** Integration tests: mock auth approval/denial, dynamic model availability, token expiry, revoked consent, usage exhausted, stream partial failure, JSON corruption and offline mode.

**Subscription integration gate:** On a supported account, user signs in through official browser flow, grants permission, selects a returned model, submits a small test request and receives a verified `response.completed`; closes/reopens the desktop app and reconnects safely; generated AI edit plan validates and can be opened/edited. If the agent cannot actually complete the auth flow in its test environment, label it `SIWC UNVERIFIED` and provide exact manual steps. Do not fabricate success.

**Scope reminder:** This is an engineering specification, NOT evidence that the app has already been implemented or that any particular account has access to all listed models.
