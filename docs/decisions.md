# Architecture decisions

## ADR-001: Electron main process for SIWC and React desktop UI

**Status:** Accepted for the Windows MVP.

**Context:** The build requirements make official ChatGPT subscription sign-in a core feature. The OpenAI-maintained desktop reference uses Electron and `@siwc/local` in a privileged main process. The DevKit is distributed as local workspaces rather than a published npm dependency, so it is vendored from the official source and built with the app. A protected privileged runtime was more important than preserving a framework choice.

**Decision:** Use Electron + React + TypeScript + a Python worker. Keep OAuth, model listing, and Responses inference in Electron main. Use Electron `safeStorage` for SIWC credential encryption. Give the renderer only typed IPC operations through a context-isolated preload. Keep media processing and rendering in a Python child process; it receives no OAuth token. The worker is private loopback HTTP with an ephemeral port and random bearer token.

**Threat model and controls:** The renderer is treated as untrusted input. Each IPC handler checks the sender window, the preload exposes only enumerated methods, and project objects pass worker validation. External navigation is blocked except for allowlisted ChatGPT sign-in/usage destinations opened in the system browser. The worker validates loopback source, exact Host, bearer token, and request size. SIWC credentials stay in main and are OS-protected; the app fails closed if encryption is unavailable. AI requests require the user's explicit structured-metadata consent and a user click. Source paths, filenames, media, screenshots and credentials are excluded from inference payloads.

**Verification:** Electron/TypeScript build and automated checks are recorded in `test-matrix.md`. The design has not yet been exercised with the user's live ChatGPT account, real install, or real gameplay acceptance flow. SIWC eligibility and subscription usage are account-dependent.

**Consequences:** The application requires Node 22.12+ to develop/package, Python 3.11+ at runtime, and separately installed FFmpeg/FFprobe for media operations. The OpenAI DevKit Noncommercial License 1.0 applies to the SIWC integration; commercial use/distribution requires separate written permission from OpenAI.

## ADR-002: Versioned JSON project with a local SQLite index

Project interchange remains versioned JSON. SQLite stores a rebuildable index of projects, media, events, music, and clips under local `userData`; media and credentials are not stored in that index.

## ADR-003: Manual annotations are the truthful event baseline

The current app provides a full manual event-to-render workflow. It does not invent kill detections from timestamps. OCR/CV detection will be enabled only after its HUD evidence, ownership confidence, and evaluation fixtures can be validated.

## ADR-004: CPU `libx264` is the supported export path

The renderer requests software `libx264` and does not require a GPU. Hardware encoders are not offered until runtime smoke tests and compatibility checks exist. Master 144 FPS is never silently replaced by 60 FPS.

## SIWC source and license

The vendored implementation is the official [Sign in with ChatGPT DevKit](https://github.com/openai/sign-in-with-chatgpt-devkit). Its current [Noncommercial License 1.0](../apps/desktop/vendor/siwc-devkit/LICENSE) permits noncommercial use and requires a separate written agreement for commercial use. The implementation follows the official [Electron SIWC guide](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt), [model/inference docs](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), and [preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations). It does not claim the user's account is eligible or that use is unlimited.
