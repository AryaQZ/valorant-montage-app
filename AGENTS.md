# Repository guidance

- Treat gameplay recordings and music as untrusted local files. Do not upload them or execute media-provided paths through a shell.
- Keep media processing local. ChatGPT subscription requests may contain only user-approved, structured event and music metadata.
- Never add VALORANT process, memory, input automation, or anti-cheat bypass access.
- Store timeline boundaries as integer microseconds and integer output frames. Keep the project schema versioned and validate imported projects before use.
- Do not describe a capability as working unless its code path is connected and covered by a fixture or a real media file. Label manual annotation as a manual baseline.
- Run `python -m unittest discover -s tests -v` after code changes. The FFmpeg end-to-end test is skipped with a clear reason when FFmpeg/FFprobe are unavailable.
- Keep OAuth credentials out of the renderer, worker process, project files, logs, and telemetry.
