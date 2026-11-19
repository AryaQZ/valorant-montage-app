# Upstream parity

Pinned source is [gustavomenani/editing-gameplay-montages at bd016ee](https://github.com/gustavomenani/editing-gameplay-montages/tree/bd016ee02ac3d667f6849a136ab5f69edbd0edec). The upstream project targets a 60 FPS composited montage using a Python timeline, measured beats, frame-based slowdown, RIFE and final QA.

| Stage | Current Studio behavior | Fresh comparison |
| --- | --- | --- |
| Ingest, timestamps, kill feed | Pinned scripts with a replay fallback and mapping back to the original media. | Original local recording yielded six shot/replay candidates. All six require ownership review; the montage uses five reviewed annotations. |
| Beat and pacing | Native invokes upstream tempo/grid/planning with Studio constraints around reviewed impact order and ending action. Legacy rule-only path scores preexisting markers and has a strict worker gate. | Native read returned 718 frames / five measured impacts. See decoded-AAC measurement in the end-to-end report. |
| RIFE and motion | Native uses original `prep.py`, `posmap.py` and `check_store.py`. Legacy uses segment-specific RIFE and FFmpeg when needed. | Fresh prep took 512 seconds, repaired two duplicate source frames and used 4×/16× subframe ranges. Store check had zero missing or coarse frames. |
| Picture | Studio native uses `vms_edit.py` and upstream building blocks. Legacy uses an FFmpeg graph. | Ran checksum-matched original refstyle `render.py` independently for 72 frames using the same freshly prepared timeline/store. FFprobe confirmed 1920×1080/60 with 72 frames. This isolates the compositor comparison. It does not establish full parity with the upstream agent briefing/planning workflow. |
| Audio | Native adds gameplay confirmation layers with upstream mux/peak guard. Legacy uses FFmpeg-side gain, ducking and synthetic impact sound. | Native reported five confirmation layers, unchanged music speed, and upstream peak guard measured −1.54 dBFS. |
| Output and polish | Native 1080p60 and separate legacy 1440p144. Studio lacks upstream lyrics/cover, vertical workflows and native rough preview. | Real local 1440p144 file decoded. Native and legacy formats are separate user workflows. |

Full upstream parity remains open. Dynamic edit aesthetics, full stand-alone upstream plan/mix, independent kill labeling, and comparison across varied footage were not fully established.

In 0.1.11-qa.2, the editor added a native effects preview using the same full picture and audio stages as export. The verified local preview reused an identical set of 4×/16× source positions from the earlier fresh prep. Studio's updated compositing passed the pinned gate with six warnings and zero errors. The upstream lightweight rough preview still has no Studio equivalent.
