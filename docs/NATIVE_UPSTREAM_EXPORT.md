# Native upstream export

**Generate draft** now invokes the pinned upstream reference planner through the local worker. If no highlights exist, the worker scans the imported sources and keeps shot candidates with verified frame evidence. Existing reviewed highlights control selection and order. A local draft records source stamps, its timeline hash, the integer output frame of each shot, source time in microseconds, and intended musical attack time.

**Export montage** uses that draft to run the upstream picture and audio stages at 1920×1080 and 60 FPS. It runs range extraction, RIFE preparation, subframe position calibration, the store check, picture rendering, sample domain mixing, peak guard, and the delivery gate. The worker checks the file's decoded frame count separately. Changes to the selected source files, highlights, song, or manual timeline require a new upstream draft before export.

## Style-aware native drafts

New drafts select one measured drum attack per kill when a recurring pattern fits the footage. The Director shows the chosen rhythm and setup, impact, and confirmation review points. Select a local visual reference in the Inspector to inform transitions and the ending fade. The export keeps the project song at native speed and mixes the post-shot confirmation locally. See [the editing decisions and workflow](PEMBELAJARAN_EDITING_VALORANT.md).

## Integration map

| Step | Desktop and worker | Pinned upstream scripts |
|---|---|---|
| Find and rank shots | `generateReferenceDraft` → `create_reference_draft` → `detect_kills` | `ingest.py`, `kills_auto.py`, `kverify.py`, `kill_rank.py` |
| Make the cut | `create_reference_draft` stages inputs and exports timing for review | `music_tempo.py`, `music_grid.py`, `draft_ref_timeline.py` |
| Render the cut | `JobManager._run` → `render_reference` | `ranges.py`, `prep.py`, `posmap.py`, `check_store.py`, reference `render.py` and `audio.py` |
| Gate delivery | `render_reference` writes the QA and project sidecars | `ff.py pts`, `peakguard.py`, `gate.py` |

The first run may take several minutes for VFR preparation and RIFE. The runtime and media remain local. The separate ChatGPT Director is optional.

## Real media validation

The app worker and standalone upstream used the same four gameplay recordings, five reviewed shots, and song at the native 1080p60 profile. The standalone reference had a hand selected opening bullet time and started the song about 1.19 seconds earlier. This comparison tests the app's automatic decisions and render path with the same material and profile. It does not compare identical timelines.

| Measure | Corrected original upstream | App worker export |
|---|---:|---:|
| Duration and decoded frames | 12.05 s, 723 | 11.38 s, 683 |
| Shots placed on measured music attacks | 5 of 5 | 5 of 5 |
| Consecutive identical frames outside fades / motion stops | 0 / 0 | 0 / 0 |
| Flash matched to its intended frame | 2 measured exact, 3 unmeasured | 3 measured exact, 2 unmeasured |
| Decoded sample peak | −1.32 dBFS | −1.20 dBFS |
| Integrated loudness | −8.2 LUFS | −8.2 LUFS |

The app timeline varied the take lengths and speeds. It used two zoom blur transitions, a whip, a roll, and a fade. The decoded output had nine one frame jumps, all at planned impacts, accents, cuts, or transitions. Upstream's store check found no missing or too coarse frames and reported a median of four subframes blended per output frame. FFprobe read both video and audio at 11.383333 seconds.

QA remains **WARN**. The audit could not verify several source gunshot onsets, two flash timings, a bump, or a single beat grid for the whole song. The planner used individual measured attacks. The first export also contained five weak shot warnings caused by a missing source confidence field in the bridge. The adapter now preserves the detector confidence labels. Reauditing the same MP4 removed those five metadata warnings and kept all five measurement warnings. No errors were reported in that reaudit.

Local artifacts under `artifacts/quality-regression-review`:

- `upstream-baseline/upstream-corrected-native-1080p60.mp4`
- `app-integrated-worker-native-1080p60.mp4` and `app-integrated-worker-overview.jpg`
- `app-integrated-worker-check.log` and `app-integrated-worker-native-1080p60.reaudited.qa.json`

The real export exercised the authenticated background job and its progress. The Python test suite passed 47 tests, including the legacy FFmpeg integration fixture and native draft guards. Desktop Vitest passed 11 tests, TypeScript passed, and the Windows installer was rebuilt.

A separate test started with the four raw recordings, music, and an empty highlight list. It produced a six shot draft of 819 planned frames (13.65 seconds) through local detection and planning. The comparison MP4 in the table uses the five reviewed shots. No MP4 was rendered from this second draft.

## Remaining limits

The native draft lets users review individual source shots and change the selection and order before rerunning the planner. Arbitrary native effect keyframes, trim editing, manual reverse motion, and automatic master rendering at 1440p144 remain unverified or unsupported. The 1440p144 preset still belongs to the existing manual engine. Upstream QA warnings remain visible in the export report.
