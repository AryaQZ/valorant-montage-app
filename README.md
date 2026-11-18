# valorant-montage-app
AI Editing for Valorant

## VALORANT Montage Studio

VALORANT Montage Studio is a local-first Windows desktop editor for turning recorded gameplay into a reviewable montage. It supports manual highlight annotation, locally detected shot candidates, a clip timeline, music analysis, optional ChatGPT planning, autosave, export, and post-render QA.

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

## Automatic montage with the upstream engine

1. Run `scripts\setup-upstream.ps1` once to prepare the local Python 3.11/RIFE runtime. Launch the studio from the Desktop shortcut or the packaged executable.
2. Import gameplay and a licensed song. With an empty highlight list, **Generate draft** scans the imported recordings for verifiable shots. With existing highlights, it uses verified player highlights in timeline order, or in the highlight list order if the timeline is empty.
3. Review the takes, musical hit times, and source shots in **Director**. Use **Edit highlight selection** to review and change which shots enter the plan and in what order, then generate again. Upstream computes speed and effect timing on each pass.
4. Choose **Export montage**, confirm the footage and song rights, and select a new MP4 filename. This route uses the upstream 1920×1080, 60 FPS profile, real RIFE preparation, the reference visual and audio engines, and the upstream QA gate.
5. Review the video and its QA report. A warning means at least one check needs review. A failed check does not count as an accepted master.

For a replay with missing ownership colors, open **Find kills** and preview each candidate before adding it. For an ace ending, select the final kill clip and review its source. Use **Mark final action start** on the approach to the kill and **Mark visible ACE** on the original banner. Studio reserves an action lead-in by default for a marked ACE. The final take starts with a clear cut, and export QA checks that the encoded approach and impact match the reviewed source. Generate a new draft and check the ACE cue in Director before exporting.

Saved project files reference both the original media and a local draft. If you move the project to another installation, provide the source files and generate a new draft there.

## Manual editing

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

- **Highlight review:** upstream detection can propose shots, but ownership and ambiguous footage still require review.
- **Editing:** the manual timeline supports clip ordering, trims and clip effects. For the upstream draft, highlight selection and order can be changed before replanning. Direct keyframe edits, manual reverse segments, and legacy effect controls do not flow into upstream exports yet.
- **Upstream profile:** 1080p60 is the active profile. The manual 1440p144 export remains available in the original engine and is a separate path.
- **Rendering:** software H.264 (`libx264`) is the supported path. Hardware encoding is not offered until it can be smoke-tested. FFmpeg/FFprobe must be installed separately and available on `PATH`.
- **SIWC:** the official local DevKit runs in Electron's main process and stores credentials using Electron `safeStorage`. Model discovery is account-scoped. The actual sign-in, app eligibility and inference result still need to be confirmed with the user's ChatGPT account; availability and usage limits are controlled by OpenAI. There is no API-key billing fallback.
- **Commercial use:** the vendored Sign in with ChatGPT DevKit is under OpenAI's Noncommercial License 1.0. This build and its DevKit integration are restricted to noncommercial purposes unless OpenAI grants separate written permission. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Windows acceptance:** automated project and build checks are reported in `docs/test-matrix.md`. The full install/import/edit/export flow still needs user-machine acceptance with real gameplay and an eligible ChatGPT account.

See [architecture](docs/architecture.md), [architecture decisions](docs/decisions.md), and [test matrix](docs/test-matrix.md).
