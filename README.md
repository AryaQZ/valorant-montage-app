# VALORANT Montage Studio

VALORANT Montage Studio is a local-first Windows desktop editor for turning recorded gameplay into a reviewable montage. Its working baseline supports manual highlight annotation, a non-destructive clip timeline, local music analysis, rule-only and optional ChatGPT subscription edit suggestions, autosave, export, and post-render QA. **Kill detection is a manual baseline; the app does not claim automatic kill detection.**

## Windows requirements

- Windows 10/11 x64
- Python 3.11 or newer for the local media worker
- FFmpeg and FFprobe on `PATH`, with `libx264` enabled, for media import, proxy preview, music analysis and export
- Node.js 22.12 or newer for development and installer builds (installed desktop apps bundle Electron)

Run PowerShell from the repository root:

```powershell
.\scripts\setup.ps1
.\scripts\dev.ps1
```

Build a Windows installer:

```powershell
.\scripts\build.ps1
```

The installer is written to `apps/desktop/release`. The installed app still needs Python and FFmpeg/FFprobe available on the machine for the worker and media operations. `scripts/setup.ps1` checks these prerequisites and installs the local Node workspaces.

To use the app, run `VALORANT-Montage-Studio-0.1.0-Windows-x64.exe` from that release folder and follow the installer. This build is unsigned; Windows may show its normal unknown-publisher prompt.

## First edit

1. Import one or more recordings. The app reads media metadata and creates local 640×360 preview proxies when FFmpeg is available.
2. Select a recording and enter the in, impact, and out times for a highlight. Tag the event and confirm player ownership.
3. Add highlights to the timeline, or create a rule-only draft. The Creative Director may also propose an edit through Sign in with ChatGPT after you connect, grant plan-usage sharing, select an account-listed model, and consent to sending structured event/music metadata.
4. Review a draft, accept it to update the timeline, reorder clips by dragging, and adjust trims. Trims preserve the annotated impact point.
5. Import music you have rights to use. Beat candidates and a compact waveform are analyzed locally. Confirm the music rights before exporting.
6. Select Master 2560×1440 at 144 FPS or YouTube 2560×1440 at 60 FPS, export, then inspect the generated `.qa.html` and `.qa.json` reports.

Project JSON references source media in place. Autosave snapshots and the SQLite library index are stored under the app's local user-data directory. The worker is a separate Python process bound to an ephemeral loopback port and authenticated with a random per-run token. The renderer cannot read that token or SIWC credentials.

## Checks

```powershell
.\scripts\test.ps1
```

The script runs Python worker tests plus the desktop TypeScript and Vitest checks. The FFmpeg render integration test skips when FFmpeg/FFprobe or `libx264` is not installed. A build/package result alone is not a real-media Windows acceptance test.

## Current limits

- **Manual event baseline:** HUD ROI calibration, OCR/CV kill-feed detection, ownership estimation, multikill clustering from video evidence and detection benchmark reports are not implemented.
- **Editing:** undo/redo works during the current session. The current editor provides a single gameplay track, fixed Smooth/Clean impact zoom, integer source ranges and drag reordering; speed curves, transitions, cross-project undo history and multitrack editing are not implemented.
- **Rendering:** software H.264 (`libx264`) is the supported path. Hardware encoding is not offered until it can be smoke-tested. FFmpeg/FFprobe must be installed separately and available on `PATH`.
- **SIWC:** the official local DevKit runs in Electron's main process and stores credentials using Electron `safeStorage`. Model discovery is account-scoped. The actual sign-in, app eligibility and inference result still need to be confirmed with the user's ChatGPT account; availability and usage limits are controlled by OpenAI. There is no API-key billing fallback.
- **Commercial use:** the vendored Sign in with ChatGPT DevKit is under OpenAI's Noncommercial License 1.0. This build and its DevKit integration are restricted to noncommercial purposes unless OpenAI grants separate written permission. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Windows acceptance:** automated project and build checks are reported in `docs/test-matrix.md`. The full install/import/edit/export flow still needs user-machine acceptance with real gameplay and an eligible ChatGPT account.

See [architecture](docs/architecture.md), [architecture decisions](docs/decisions.md), and [test matrix](docs/test-matrix.md).
