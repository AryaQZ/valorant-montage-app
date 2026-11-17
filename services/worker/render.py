"""FFmpeg montage renderer driven by the versioned project timeline."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable
import json
import math
import os
import shutil
import subprocess
import tempfile
import uuid

from .media import MediaToolError, probe_audio, probe_media
from .schema import PROFILES, ProjectValidationError, frames_to_duration_us, validate_project
from .quality import run_quality_control

ProgressCallback = Callable[[float, str], None]


def preflight(project: dict[str, Any], output_path: str, rights_acknowledged: bool,
              ownership_acknowledged: bool) -> dict[str, Any]:
    validate_project(project, require_timeline=True)
    errors: list[str] = []
    warnings: list[str] = []
    for source in project["sources"]:
        path = Path(source["path"])
        if not path.is_file():
            errors.append(f"File rekaman tidak ditemukan: {path}")
        elif source.get("duration_us") is None:
            errors.append(f"Metadata source belum lengkap: {path.name}")
    unknown = [event["event_id"] for event in project["events"]
               if event.get("owner") == "unknown" and any(clip["event_id"] == event["event_id"] for clip in project["timeline"])]
    if unknown and not ownership_acknowledged:
        errors.append(f"Konfirmasi bahwa {len(unknown)} highlight owner=unknown memang milik pemain.")
    if project.get("music"):
        music_path = Path(project["music"]["path"])
        if not music_path.is_file():
            errors.append(f"File musik tidak ditemukan: {music_path}")
        if not rights_acknowledged:
            errors.append("Konfirmasi bahwa Anda memiliki hak untuk memakai file musik.")
    destination = Path(output_path).expanduser().resolve()
    if destination.suffix.lower() != ".mp4":
        errors.append("File output harus berekstensi .mp4.")
    if not destination.parent.exists():
        errors.append("Folder output tidak ditemukan.")
    elif not os.access(destination.parent, os.W_OK):
        errors.append("Folder output tidak dapat ditulis.")
    caps = shutil.disk_usage(destination.parent) if destination.parent.exists() else None
    fps = PROFILES[project["settings"]["output_profile"]]
    total_frames = sum(clip["duration_frames"] for clip in project["timeline"])
    duration_us = frames_to_duration_us(total_frames, fps)
    required_bytes = max(64 * 1024 * 1024, duration_us * 5)  # conservative 40 Mbit/s plus margin
    if caps and caps.free < required_bytes:
        errors.append(f"Ruang disk tidak cukup: butuh sekitar {required_bytes // (1024 * 1024)} MiB.")
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        errors.append("FFmpeg dan FFprobe wajib tersedia di PATH untuk render dan verifikasi output.")
    for clip in project["timeline"]:
        event = next(event for event in project["events"] if event["event_id"] == clip["event_id"])
        if event["confidence"] < 0.55:
            warnings.append(f"Highlight {event['event_id']} memiliki confidence rendah.")
    return {"errors": errors, "warnings": warnings, "duration_us": duration_us,
            "total_frames": total_frames, "fps": fps, "output_path": str(destination)}


def render_montage(project: dict[str, Any], output_path: str, *, rights_acknowledged: bool,
                   ownership_acknowledged: bool, cancel_event: Any,
                   progress: ProgressCallback) -> dict[str, Any]:
    report = preflight(project, output_path, rights_acknowledged, ownership_acknowledged)
    if report["errors"]:
        raise ProjectValidationError("Preflight gagal: " + " ".join(report["errors"]))
    destination = Path(report["output_path"])
    if destination.exists():
        raise ProjectValidationError(f"Output sudah ada; pilih nama lain: {destination}")
    partial = destination.with_name(f".{destination.stem}.{uuid.uuid4().hex[:8]}.partial.mp4")
    fps = report["fps"]
    total_frames = report["total_frames"]
    duration_seconds = total_frames / fps
    inputs: list[str] = []
    source_by_id = {source["media_id"]: source for source in project["sources"]}
    clip_audio: list[bool] = []
    for clip in project["timeline"]:
        source = source_by_id[clip["source_media_id"]]
        inputs.extend(["-i", source["path"]])
        clip_audio.append(bool(source.get("has_audio")))
    music = project.get("music")
    music_index: int | None = None
    if music:
        music_index = len(project["timeline"])
        inputs.extend(["-stream_loop", "-1", "-i", music["path"]])
    graph, out_video, out_audio = _build_filter_graph(project, fps, clip_audio, music_index)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise MediaToolError("FFmpeg tidak ditemukan di PATH.")
    command = [ffmpeg, "-hide_banner", "-nostats", "-y", *inputs,
               "-filter_complex", graph, "-map", out_video, "-map", out_audio,
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
               "-r", f"{fps}/1", "-fps_mode", "cfr", "-c:a", "aac", "-b:a", "320k",
               "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-t", f"{duration_seconds:.9f}",
               "-progress", "pipe:1", "-f", "mp4", str(partial)]
    expected_size = max(64 * 1024 * 1024, int(duration_seconds * 5_000_000))
    free = shutil.disk_usage(destination.parent).free
    if free < expected_size:
        raise ProjectValidationError(f"Ruang disk berkurang selama preflight; butuh {expected_size} bytes.")
    process: subprocess.Popen[str] | None = None
    try:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
                                   bufsize=1)
        if hasattr(cancel_event, "attach_process"):
            cancel_event.attach_process(process)
        stderr_lines: list[str] = []
        # FFmpeg progress is line-oriented. stderr is drained by a separate thread to avoid pipe blockage.
        import threading
        def drain_stderr() -> None:
            assert process and process.stderr
            for line in process.stderr:
                stderr_lines.append(line.rstrip())
                if len(stderr_lines) > 500:
                    del stderr_lines[:100]
        drain_thread = threading.Thread(target=drain_stderr, name="ffmpeg-stderr", daemon=True)
        drain_thread.start()
        assert process.stdout is not None
        for line in process.stdout:
            if cancel_event.is_set():
                process.terminate()
                try:
                    process.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    process.kill()
                raise InterruptedError("Render dibatalkan pengguna.")
            key, _, value = line.strip().partition("=")
            if key == "out_time_us":
                try:
                    fraction = min(0.98, int(value) / (duration_seconds * 1_000_000))
                    progress(fraction, f"Merender {fraction * 100:.0f}%")
                except (ValueError, ZeroDivisionError):
                    pass
        return_code = process.wait()
        drain_thread.join(timeout=2)
        if cancel_event.is_set():
            raise InterruptedError("Render dibatalkan pengguna.")
        if return_code != 0:
            raise MediaToolError("FFmpeg render gagal: " + "\n".join(stderr_lines[-30:]))
        if not partial.is_file() or partial.stat().st_size < 1024:
            raise MediaToolError("FFmpeg tidak menghasilkan file output yang valid.")
        progress(0.99, "Memeriksa output dan menjalankan QC")
        os.replace(partial, destination)
        sidecar = destination.with_suffix(".project.json")
        sidecar.write_text(json.dumps(project, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        qc = run_quality_control(str(destination), project)
        qa_json = destination.with_suffix(".qa.json")
        qa_html = destination.with_suffix(".qa.html")
        qa_json.write_text(json.dumps(qc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        qa_html.write_text(_html_report(qc), encoding="utf-8")
        progress(1.0, f"QC {qc['status']}")
        return {"output_path": str(destination), "project_sidecar": str(sidecar),
                "qa_json": str(qa_json), "qa_html": str(qa_html), "qa": qc,
                "state": "complete" if qc["status"] == "PASS" else "needs_review"}
    finally:
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        partial.unlink(missing_ok=True)


def _build_filter_graph(project: dict[str, Any], fps: int, clip_audio: list[bool],
                        music_index: int | None) -> tuple[str, str, str]:
    graph: list[str] = []
    pairs: list[str] = []
    width, height = 2560, 1440
    intensity = float(project["settings"].get("effects_intensity", 0.45))
    gameplay_gain = float(project["settings"].get("gameplay_gain", 1.0))
    music_gain = float(project["settings"].get("music_gain", 0.18))
    event_by_id = {event["event_id"]: event for event in project["events"]}
    for index, clip in enumerate(project["timeline"]):
        duration_frames = clip["duration_frames"]
        duration_seconds = duration_frames / fps
        start = clip["in_us"] / 1_000_000
        end = clip["out_us"] / 1_000_000
        video = (f"[{index}:v:0]trim=start={start:.6f}:end={end:.6f},setpts=PTS-STARTPTS,"
                 f"fps={fps},scale={width}:{height}:force_original_aspect_ratio=increase,"
                 f"crop={width}:{height},setsar=1,format=yuv420p")
        event = event_by_id[clip["event_id"]]
        impact_frame = max(0, round((event["source_time_us"] - clip["in_us"]) * fps / 1_000_000))
        if intensity > 0 and any(effect.get("type") == "impact_zoom" and effect.get("enabled", True)
                                  for effect in clip.get("effects", [])):
            max_zoom = min(1.04, 1 + 0.04 * intensity)
            video += (f",zoompan=z='1+{max_zoom - 1:.5f}*pow(max(0,1-abs(in-{impact_frame})/12),2)':"
                      f"x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={width}x{height}:fps={fps}")
        video += f",tpad=stop_mode=clone:stop_duration={duration_seconds:.9f},trim=end_frame={duration_frames},setpts=N/({fps}*TB)[v{index}]"
        graph.append(video)
        if clip_audio[index]:
            audio = (f"[{index}:a:0]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS,"
                     "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                     f"volume={gameplay_gain:.4f},apad,atrim=duration={duration_seconds:.9f}[a{index}]")
        else:
            audio = f"anullsrc=r=48000:cl=stereo,atrim=duration={duration_seconds:.9f}[a{index}]"
        graph.append(audio)
        pairs.extend([f"[v{index}]", f"[a{index}]"])
    graph.append(f"{''.join(pairs)}concat=n={len(project['timeline'])}:v=1:a=1[vc][ac]")
    if music_index is not None:
        music_offset = max(0, int(project["music"].get("offset_us", 0))) / 1_000_000
        graph.append(f"[{music_index}:a:0]atrim=start={music_offset:.6f},asetpts=PTS-STARTPTS,"
                     f"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                     f"volume={music_gain:.4f},atrim=duration={sum(c['duration_frames'] for c in project['timeline'])/fps:.9f}[music]")
        graph.append("[ac][music]amix=inputs=2:duration=first:dropout_transition=2:normalize=0,"
                     "alimiter=limit=0.95[ao]")
    else:
        graph.append("[ac]alimiter=limit=0.95[ao]")
    return ";".join(graph), "[vc]", "[ao]"


def _html_report(report: dict[str, Any]) -> str:
    import html
    rows = "".join(f"<li><strong>{html.escape(item['status'])}</strong> — {html.escape(item['message'])}</li>"
                   for item in report.get("checks", []))
    title = html.escape(report.get("status", "UNKNOWN"))
    return ("<!doctype html><html lang='id'><meta charset='utf-8'><title>VALORANT Montage Studio QA</title>"
            "<style>body{font:16px system-ui;max-width:880px;margin:4rem auto;padding:0 1rem;color:#17202a}"
            "li{margin:.8rem 0}.status{font-size:1.5rem}</style><body>"
            f"<h1>QA export</h1><p class='status'>Status: {title}</p><p>File: {html.escape(report.get('file', ''))}</p>"
            f"<ul>{rows}</ul></body></html>")
