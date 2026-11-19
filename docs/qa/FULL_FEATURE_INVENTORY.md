# Full feature inventory

Scope unit is one testable behavior. The inventory includes requested capabilities that are absent. The corresponding row in the QA matrix records execution or an explicit gap.

| ID | Behavior | Surface |
| --- | --- | --- |
| A01 | Windows installer | Electron / renderer / NSIS |
| A02 | Packaged startup | Electron / renderer / NSIS |
| A03 | Development startup | Electron / renderer / NSIS |
| A04 | Editor-to-Director navigation | Electron / renderer / NSIS |
| A05 | Resizable workspace and zoom | Electron / renderer / NSIS |
| A06 | Global keyboard/menu actions | Electron / renderer / NSIS |
| A07 | Escape and modal focus | Electron / renderer / NSIS |
| A08 | Progress/notifications | Electron / renderer / NSIS |
| A09 | Close and reopen | Electron / renderer / NSIS |
| A10 | Crash and worker restart | Electron / renderer / NSIS |
| B01 | New project | Renderer / Electron / schema / SQLite |
| B02 | Save and overwrite via approved path | Renderer / Electron / schema / SQLite |
| B03 | Save As | Renderer / Electron / schema / SQLite |
| B04 | Open valid project | Renderer / Electron / schema / SQLite |
| B05 | Reject corrupt JSON/schema | Renderer / Electron / schema / SQLite |
| B06 | Autosave | Renderer / Electron / schema / SQLite |
| B07 | Recovery UI | Renderer / Electron / schema / SQLite |
| B08 | Delete project with confirmation | Renderer / Electron / schema / SQLite |
| B09 | Missing gameplay video relink | Renderer / Electron / worker / FFprobe |
| B10 | Paths with spaces and Unicode | Renderer / Electron / schema / SQLite |
| B11 | Relative path semantics | Renderer / Electron / schema / SQLite |
| B12 | v1/v2 schema migration | Renderer / Electron / schema / SQLite |
| B13 | Draft fingerprint round-trip | Renderer / Electron / schema / SQLite |
| C01 | Single video | Electron / worker / FFmpeg |
| C02 | Multi-select videos | Electron / worker / FFmpeg |
| C03 | Duplicate imports | Electron / worker / FFmpeg |
| C04 | Invalid or corrupt media | Electron / worker / FFmpeg |
| C05 | Cancel import | Electron / worker / FFmpeg |
| C06 | Large media | Electron / worker / FFmpeg |
| C07 | VFR and mixed resolution | Electron / worker / FFmpeg |
| C08 | FFprobe metadata | Electron / worker / FFmpeg |
| C09 | Poster and video proxy | Electron / worker / FFmpeg |
| C10 | Proxy recreation/portable project | Electron / worker / FFmpeg |
| C11 | Visual style reference | Electron / worker / FFmpeg |
| D01 | Kill feed and replay fallback | Worker / upstream / renderer |
| D02 | Shot and frame mapping | Worker / upstream / renderer |
| D03 | Headshot evidence | Worker / upstream / renderer |
| D04 | Grouped multikill | Worker / upstream / renderer |
| D05 | Duplicate candidates and repeated plays | Worker / upstream / renderer |
| D06 | Rank and confidence | Worker / upstream / renderer |
| D07 | Candidate preview and confirmation | Worker / upstream / renderer |
| D08 | Manual tags ownership and time markers | Worker / upstream / renderer |
| D09 | Final action and ACE | Worker / upstream / renderer |
| D10 | Detection failure | Worker / upstream / renderer |
| E01 | Music import and local decode | Worker / upstream / FFmpeg |
| E02 | Waveform and tempo | Worker / upstream / FFmpeg |
| E03 | Measured attacks and strong-beat grid | Worker / upstream / FFmpeg |
| E04 | Music offset and length checks | Worker / upstream / FFmpeg |
| E05 | Standalone music preview | Worker / upstream / FFmpeg |
| E06 | Music and gameplay gain | Worker / upstream / FFmpeg |
| E07 | Ducking and impact audio | Worker / upstream / FFmpeg |
| E08 | Limiter and peak probe | Worker / upstream / FFmpeg |
| E09 | Missing/silent audio | Worker / upstream / FFmpeg |
| E10 | Rendered beat synchronization | Worker / upstream / FFmpeg |
| F01 | Rule-only Director | Renderer / worker / SIWC |
| F02 | Native automatic draft and regenerate | Renderer / worker / SIWC |
| F03 | AI account/sign-in/session | Renderer / worker / SIWC |
| F04 | Models and effort | Renderer / worker / SIWC |
| F05 | Metadata consent and limits | Renderer / worker / SIWC |
| F06 | AI kill ranking | Renderer / worker / SIWC |
| F07 | AI proposal validation and fallback | Renderer / worker / SIWC |
| F08 | Order and duration decisions | Renderer / worker / SIWC |
| F09 | Beat priority and style controls | Renderer / worker / SIWC |
| F10 | Proposal acceptance and persistence | Renderer / worker / SIWC |
| G01 | Clip insertion/deletion | Renderer / project model |
| G02 | Range trim and remap preservation | Renderer / project model |
| G03 | Split clip | Renderer / project model |
| G04 | Reorder and move | Renderer / project model |
| G05 | Timeline zoom | Renderer / project model |
| G06 | Source and timeline playback/scrub | Renderer / project model |
| G07 | Keys and effect toggles | Renderer / project model |
| G08 | Speed ramp and reverse | Renderer / project model |
| G09 | Music track and markers | Renderer / project model |
| G10 | Save/reopen and undo/redo | Renderer / project model |
| H01 | Impact zoom | FFmpeg / RIFE / native |
| H02 | Impact flash | FFmpeg / RIFE / native |
| H03 | Screen shake | FFmpeg / RIFE / native |
| H04 | Motion blur | FFmpeg / RIFE / native |
| H05 | Dip-to-black and native transitions | FFmpeg / RIFE / native |
| H06 | Forward variable speed/RIFE | FFmpeg / RIFE / native |
| H07 | Reverse and FFmpeg fallback | FFmpeg / RIFE / native |
| H08 | Color/exposure and chromatic effects | FFmpeg / RIFE / native |
| I01 | Rough preview 720p30 | Renderer / worker / encoder |
| I02 | Effects preview 1440p60 | Renderer / worker / encoder |
| I03 | Native 1080p60 render engine | Renderer / worker / encoder |
| I04 | Master export 1440p144 | Renderer / worker / encoder |
| I05 | Encoder selection and GPU/CPU | Renderer / worker / encoder |
| I06 | AAC and known CFR cadence | Renderer / worker / encoder |
| I07 | Render progress/cancel/retry | Renderer / worker / encoder |
| I08 | File integrity and cleanup | Renderer / worker / encoder |
| I09 | Performance smoke | Renderer / worker / encoder |
| I10 | Native effects preview in editor | Renderer / Electron / native render stages |
| J01 | QA dimensions FPS and frame count | Worker / upstream gate |
| J02 | Black/frozen/duplicate frames | Worker / upstream gate |
| J03 | Audio drift silence and clipping | Worker / upstream gate |
| J04 | Beat gate and attack alignment | Worker / upstream gate |
| J05 | RIFE fallback status | Worker / upstream gate |
| J06 | Visual/transition evidence | Worker / upstream gate |
| J07 | Manifest consistency and QA reports | Worker / upstream gate |
| J08 | Lyrics/cover and vertical native presets | Worker / upstream gate |

## Architecture and discovery

The Windows production entry is Electron, React and TypeScript. Its preload bridge exposes typed IPC. Electron owns dialogs, project files, background worker lifetime and SIWC credentials. A private Python worker provides validated projects, local SQLite indexing, FFprobe/FFmpeg probes and renders, offline audio analysis and pinned upstream native planning. The pinned upstream runtime uses Python 3.11, OpenCV, SciPy and optional ncnn/Vulkan RIFE. The repository also contains an older Python desktop entry. It is outside the NSIS app surface.

Inspected the renderer controls, preload, Electron handler list, worker HTTP routes, schema v1/v2, media/analysis functions, job manager, rendering and QA code, build and setup scripts, vendored SIWC, pinned upstream and previous QA evidence. Prior evidence is discovery material for this audit.

Total inventory rows: 99.
