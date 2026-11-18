# Errors

## [ERR-20261117-001] Electron/Vite bundle entry points were incomplete

**Priority**: medium
**Status**: resolved
**Area**: build

### Summary
The first sandboxed `npm run build` failed while esbuild tried to read a parent path above the writable workspace. The elevated retry exposed that electron-vite needs explicit entry points for main, preload, and renderer when using a custom renderer directory.

### Error
```text
Cannot read directory "../../../..": Access is denied.
An entry point is required in the electron vite main config.
build.rollupOptions.input option is required in the electron vite renderer config.
```

### Context
- Electron workspace: `apps/desktop`
- Required Node runtime: 22.12.0
- Electron/Vite config needed explicit `rollupOptions.input` for main and preload.

### Resolution
Run the bundling step with the required filesystem access when sandbox traversal blocks it, and specify `rollupOptions.input` for main, preload, and renderer in `electron.vite.config.ts`; a custom renderer `root` alone does not define its HTML entry.

### Metadata
- Reproducible: yes
- Source: build command failure

## [ERR-20261117-003] Computer-use skill path was resolved without its package folder

**Priority**: low
**Status**: resolved
**Area**: tools

### Summary
The first skill read omitted the `computer-use` package directory after the `openai-bundled` skill root, so PowerShell could not find the file. Resolving the catalog's root plus package/version path found the skill and its companion docs.

### Error
```text
Get-Content : Cannot find path ...\openai-bundled\26.1111.21308\skills\computer-use\SKILL.md
```

### Resolution
Expand the skill root and the package directory from the skill catalog before opening a filesystem-backed `SKILL.md`.

### Metadata
- Reproducible: yes
- Source: skill file lookup

## [ERR-20261117-002] Vitest discovered vendored Node test files

**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
The generic Vitest runner scanned the vendored SIWC DevKit's `node:test` suites. Vitest treated those files as empty suites, and a macOS symlink test failed under Windows sandbox permissions.

### Error
```text
No test suite found in file .../vendor/siwc-devkit/.../*.test.mjs
EPERM: operation not permitted, symlink ...
```

### Context
- App-owned tests use Vitest under `apps/desktop/shared`.
- Vendored upstream tests use Node's built-in test runner and are not app-owned Vitest suites.

### Resolution
Restrict the app's `test` script to `shared/director.test.ts`. Run upstream DevKit tests only with their documented package-specific commands when intentionally validating upstream code.

### Metadata
- Reproducible: yes
- Source: test command failure

## [ERR-20261118-001] Upstream baseline clips.json had a literal newline escape

**Priority**: low
**Status**: resolved
**Area**: tools

### Summary
The first upstream ingest stopped before media processing because an inline Python command appended the two characters `\n` to the serialized JSON instead of a newline. The JSON parser reported extra data at the last line.

### Error
```text
clips.json is not valid JSON: Extra data: line 13 column 2
```

### Context
- The file was generated with Python `json.dumps` inside a PowerShell-invoked one-line command.
- `ingest.py` rejected the manifest before opening any gameplay or music files.

### Resolution
Write the serializer output directly or append an actual newline with `chr(10)`, then parse the generated file with `json.loads` before running ingest.

### Metadata
- Reproducible: yes
- Source: upstream ingest command failure

## [ERR-20261118-002] Baseline manifest destination was joined to its own workdir twice

**Priority**: low
**Status**: resolved
**Area**: tools

### Summary
The corrected PowerShell writer ran with the baseline folder already as its working directory but joined that same relative workspace path again, so it targeted a nonexistent nested directory.

### Error
```text
Set-Content: Could not find a part of the path ...\upstream-baseline\artifacts\quality-regression-review\upstream-baseline\clips.json
```

### Context
- The command ran from `artifacts/quality-regression-review/upstream-baseline`.
- The `clips.json` rewrite failed before `ingest.py` opened media.

### Resolution
When the working directory is already the target workspace, write directly to `clips.json` or use `$PWD.Path` without re-appending the workspace relative path.

### Metadata
- Reproducible: yes
- Source: upstream baseline manifest command failure

## [ERR-20261118-003] Upstream Python lookup ran outside the application import root

**Priority**: low
**Status**: resolved
**Area**: tools

### Summary
The inline lookup for the upstream interpreter imported `services.worker.upstream` while the shell was already in the baseline workspace, where the application package is not on `sys.path`. That prevented obtaining the interpreter path before ingest.

### Error
```text
ModuleNotFoundError: No module named 'services'
```

### Context
- The interpreter path had already been verified by the application capabilities check.
- The failure occurred before `ingest.py` started.

### Resolution
Use the verified absolute upstream-venv interpreter path when launching scripts from their isolated working directory, or set `PYTHONPATH` to the application root for lookups.

### Metadata
- Reproducible: yes
- Source: upstream ingest launch setup

## [ERR-20261118-004] Patch context did not match the inspected media-script lines

**Priority**: low
**Status**: resolved
**Area**: tools

### Summary
A patch to preserve game audio in the local A/B crops was rejected because its FFprobe argument line did not exactly match the file.

### Error
```text
apply_patch verification failed: Failed to find expected lines
```

### Resolution
Re-read the exact script block and applied a smaller patch against the matching lines; no media or source file was changed by the rejected patch.

### Metadata
- Reproducible: yes
- Source: A/B media preparation script

## [ERR-20261118-005] Staging manifest stores shot evidence in the project export

**Priority**: low
**Status**: resolved
**Area**: tools

### Summary
The cached-source staging script looked for `review_sheet` in the compact accepted-event mapping, which intentionally contains IDs and verification status but stores detailed evidence in the project export.

### Error
```text
c1: selected event lacks upstream shot verification
```

### Resolution
Join each accepted event ID back to its project event before reading the upstream verification sheet path; this failed before linking or changing any media.

### Metadata
- Reproducible: yes
- Source: local upstream A/B source staging

## [ERR-20261118-006] Upstream utility scripts do not share one --help convention

**Priority**: low
**Status**: resolved
**Area**: tools

### Summary
Passing `--help` to positional-only upstream utilities treated it as a media filename or clip key and emitted a runtime usage error.

### Error
```text
cannot find a tempo in --help: Error opening input file --help
need BPM and BEAT0
need clip '--help' in src/
```

### Context
- `music_tempo.py` and `mkpts.py` use positional inputs and do not implement argparse `--help`.
- The commands only probed usage; they did not modify media or project files.

### Resolution
Inspect each upstream script's module usage text or call the known positional syntax instead of assuming every script supports `--help`.

### Metadata
- Reproducible: yes
- Source: upstream utility command probing
