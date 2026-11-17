# Architecture

## Runtime

The Windows-first desktop app uses Electron + React + TypeScript, with a separate Python 3.11+ processing worker.

```text
React renderer (sandboxed, context-isolated)
  ├─ Media library, event annotation, timeline, preview, settings and QA UI
  └─ Narrow typed contextBridge API
       ├─ Electron main process: file dialogs, project save/load, render jobs
       ├─ Sign in with ChatGPT DevKit, model catalog and inference
       └─ Private Python worker over 127.0.0.1, ephemeral port + random token
            ├─ FFprobe metadata and FFmpeg preview assets
            ├─ strict versioned project/timeline validation
            ├─ local beat candidates and waveform features
            ├─ SQLite project/media/event index
            ├─ cancellable CPU libx264 render jobs
            └─ independent FFprobe / FFmpeg QC reports
```

The Electron main process owns the SIWC client and credential storage. OAuth credentials never enter React, the Python worker, project JSON, logs, or telemetry. Credentials are encrypted with Electron `safeStorage`; sign-in fails closed if OS credential protection is unavailable. The official DevKit handles its documented system-browser PKCE and loopback callback. A renderer call is accepted only from the active app window. The worker binds to loopback, checks the exact Host, compares an ephemeral bearer token in constant time, rejects oversized JSON, and emits no CORS headers.

The worker uses Python's standard library; no third-party Python packages are required. FFmpeg and FFprobe are separate user-installed prerequisites, not bundled by this project.

## Project model and timeline

`packages/project-schema/schema-v1.json` describes the portable project format. Python validation checks cross-object constraints that JSON Schema cannot express:

- integer microsecond timestamps and source/event IDs;
- impact points within event ranges and clip trims within their event/source;
- consecutive integer output frames at exactly 144 or 60 FPS;
- time-remap segments covering the clip with bounded speed ratios;
- allowlisted effects and numeric limits.

Project JSON references media in place. A rebuildable SQLite index stores a local project/media/event index, not media bytes or credentials. Autosave snapshots go in Electron `userData`.

The React timeline uses one gameplay track. Users can drag clips to reorder them, make bounded trims around the annotated impact, change profile and intensity, and undo/redo while the app is open. Proposals remain separate from the committed timeline until the user accepts them. The preview player reads local proxy files when available.

## Media analysis and render

FFprobe reads container/stream metadata and samples early frame timestamps for VFR clues. FFmpeg creates low-resolution silent preview proxies. Music analysis decodes mono PCM locally, estimates a beat-candidate grid using 10 ms RMS-energy novelty autocorrelation, and provides a compact RMS waveform. The analysis is a reviewable heuristic, not a claim of ground-truth beat/downbeat recognition.

The renderer compiles the same timeline array shown in the UI. It trims source time ranges, normalizes to 2560×1440, emits a constant frame rate at the selected profile, bounds each clip by integer frames, and concatenates video/audio in one filter graph. Clips without source audio receive generated silence; optional music is mixed with a limiter. The default 45% effect setting maps to a bounded 1.018× centered impact zoom; zero intensity removes it. Output uses CPU `libx264` and AAC at 48 kHz stereo. A temporary file is renamed only after FFmpeg succeeds; post-render QC then records PASS/WARN/FAIL and retains non-PASS outputs as `needs_review`.

## AI Creative Director

ChatGPT Subscription uses the official local DevKit from Electron's privileged main process. Connection/plan-sharing states are distinct, models come from the active account catalog, and requests are started only by the user. The renderer shows the metadata-sharing disclosure before enabling AI generation. Payloads contain structured event IDs/ranges/tags, beat candidates, and render settings; they exclude filenames, paths, raw frames, audio, and video. The AI response is parsed and checked against the project locally before a proposal appears. A deterministic rule-only draft remains available offline. A per-project cap of five requests, cancellation, local validation retry, and error handling are implemented. No paid API-key fallback exists.

Actual ChatGPT eligibility, consent, model availability, plan limits, and inference are account-dependent and are not represented as verified until exercised by the user.

## Trust boundaries and limitations

- User-selected files are treated as data. Child processes use argument arrays, not shell commands.
- The app never inspects VALORANT memory/process state and performs no game control.
- No media, frames, screenshots, or raw audio are sent to ChatGPT. Only consented structured metadata is sent during a user-initiated request.
- Automatic kill detection, HUD ROI calibration and evidence-scored ownership are not implemented. Manual annotation is clearly labeled.
- FFmpeg/FFprobe are external dependencies; without them, media import, proxy generation, audio analysis and export are unavailable.
