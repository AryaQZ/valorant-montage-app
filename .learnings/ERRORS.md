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
