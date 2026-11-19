# Regression test report

## Reproduce

From the project root in PowerShell, use the existing Windows prerequisites and node modules:

```powershell
.\scripts\qa-app.ps1 -Gameplay 'C:\path\gameplay.mp4' -Music 'C:\path\music.mp3' -Artifacts 'C:\path\new-audit-dir'
```

Add `-ReviewedProject 'C:\path\reviewed.vmsproj.json'` to run the native worker pipeline after the UI tests pass. The reviewed project must contain verified local events and local music. Set `VMS_UPSTREAM_PYTHON` and `VMS_RIFE_GPU` to match the workstation where needed. `scripts/test.ps1` runs Python, TypeScript validation, and Vitest only.

The runner validates source hashes and creates a fresh Electron profile. It tests the production renderer and preload loaded from the generated ASAR. The isolated harness substitutes file-dialog selections and prevents live SIWC startup. FFmpeg, FFprobe, React actions, preload messages and worker jobs are real. This does not substitute for a clean NSIS install or live account acceptance test.

## Regression evidence

- 62 Python tests and 15 desktop tests passed on 0.1.11-qa.2. TypeScript and the Windows build passed. Automated cases cover schema migration, local request validation, AI metadata and candidate validation, decoded visual effects, reverse audio routing, a subframe speed-ramp reproduction, export collisions and 1440p144 FFmpeg integration.
- Before/after evidence includes the missing-peak assertion (PASS before), invalidated native hash, duplicate media in the production renderer, FFmpeg unconnected audio pad for reverse and decoded flash/shake differences.
- The packaged UI passed basic import, duplicate handling, annotations, Save As, missing-proxy recovery, malformed JSON, missing-source validation and relink, autosave recovery after reloading the renderer, rule-only planning, both manual preview modes and master export. The real edited reverse preview decoded and played after the fix. The unbounded diagnostic previously reached about 15.7 GB working set.
- The unsigned Windows package launched the versioned production renderer from the original ASAR. The startup toolbar fit in all sampled viewports from 820 to 1920 pixels wide. A second desktop process restored and played the autosaved project. Populated views and actual Windows DPI zoom still need a broader sweep.

See the evidence subfolder for final logs and UI result JSON.
