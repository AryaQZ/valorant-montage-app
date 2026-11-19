"""FFmpeg montage renderer driven by the versioned project timeline."""

from __future__ import annotations

from pathlib import Path
from functools import lru_cache
from typing import Any, Callable
import json
import math
import os
import shutil
import subprocess
import tempfile

from .media import MediaToolError, probe_audio, probe_media, publish_render, render_partial_path
from .schema import PROFILE_DIMENSIONS, PROFILES, ProjectValidationError, frames_to_duration_us, validate_project
from .quality import (_audit_beat_sync, _has_measured_attacks, find_near_duplicate_plays,
                      missing_default_editing_requirements, run_quality_control)
from .upstream import render_rife_segment, UPSTREAM_COMMIT

ProgressCallback = Callable[[float, str], None]


@lru_cache(maxsize=4)
def _filter_buffer_options(ffmpeg: str) -> tuple[str, ...]:
    try:
        result = subprocess.run([ffmpeg, "-hide_banner", "-h", "full"], capture_output=True,
                                text=True, encoding="utf-8", errors="replace", timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return ()
    # FFmpeg 9 can stop a pathological filter queue instead of exhausting system memory.
    return ("-filter_buffered_frames", "256") if "-filter_buffered_frames " in result.stdout else ()


def preflight(project: dict[str, Any], output_path: str, rights_acknowledged: bool,
              ownership_acknowledged: bool, render_mode: str = "master") -> dict[str, Any]:
    project = validate_project(project, require_timeline=True)
    errors: list[str] = []
    warnings: list[str] = []
    for source in project["sources"]:
        path = Path(source["path"])
        if not path.is_file():
            errors.append(f"File rekaman tidak ditemukan: {path}")
        elif source.get("duration_us") is None:
            errors.append(f"Metadata source belum lengkap: {path.name}")
    beat_priority = float(project["settings"].get("beat_sync_priority", 0.0))
    if beat_priority > 0:
        if not project.get("music"):
            errors.append(f"Beat sync diminta ({beat_priority:.0%}) tetapi project belum memiliki track musik.")
        elif not project["music"].get("beat_grid") or not _has_measured_attacks(project["music"]):
            errors.append("Beat sync diminta tetapi measured attack markers upstream belum tersedia. Analisis ulang track musik sebelum render.")
        else:
            beat_audit = _audit_beat_sync(project, PROFILES[project["settings"]["output_profile"]])
            unassigned = [item for item in beat_audit["events"]
                          if item.get("marker_assignment") != "unique"
                          or item["nearest_attack_delta_us"] > 80_000]
            if unassigned:
                errors.append(f"Beat sync belum memiliki measured attack unik dalam toleransi 80 ms untuk {len(unassigned)} impact; gunakan draft planner upstream.")
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
        music_duration_us = None
        if music_path.is_file():
            try:
                music_duration_us = int(probe_audio(str(music_path))["duration_us"])
            except (KeyError, TypeError, ValueError, MediaToolError) as exc:
                errors.append(f"Durasi track musik tidak dapat diverifikasi: {exc}")
    else:
        music_duration_us = None
    destination = Path(output_path).expanduser().resolve()
    if destination.suffix.lower() != ".mp4":
        errors.append("File output harus berekstensi .mp4.")
    elif any(destination.with_suffix(suffix).exists() for suffix in (".mp4", ".project.json", ".qa.json", ".qa.html")):
        errors.append("File output, project, atau QA dengan nama ini sudah ada. Pilih nama baru.")
    if not destination.parent.exists():
        errors.append("Folder output tidak ditemukan.")
    elif not os.access(destination.parent, os.W_OK):
        errors.append("Folder output tidak dapat ditulis.")
    caps = shutil.disk_usage(destination.parent) if destination.parent.exists() else None
    fps = PROFILES[project["settings"]["output_profile"]]
    width, height = PROFILE_DIMENSIONS[project["settings"]["output_profile"]]
    total_frames = sum(clip["duration_frames"] for clip in project["timeline"])
    duration_us = frames_to_duration_us(total_frames, fps)
    if project.get("music") and music_duration_us is not None:
        music_offset_us = max(0, int(project["music"].get("offset_us", 0)))
        required_music_us = music_offset_us + duration_us
        if music_duration_us < required_music_us:
            errors.append(
                f"Durasi musik ({music_duration_us / 1_000_000:.2f} s) tidak menutup montage "
                f"({duration_us / 1_000_000:.2f} s) pada offset {music_offset_us / 1_000_000:.2f} s. "
                "Audio musik akan berhenti sebelum video; gunakan track penuh atau pendekkan timeline."
            )
    required_bytes = max(64 * 1024 * 1024, duration_us * 5)  # conservative 40 Mbit/s plus margin
    if caps and caps.free < required_bytes:
        errors.append(f"Ruang disk tidak cukup: butuh sekitar {required_bytes // (1024 * 1024)} MiB.")
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        errors.append("FFmpeg dan FFprobe wajib tersedia di PATH untuk render dan verifikasi output.")
    for clip in project["timeline"]:
        event = next(event for event in project["events"] if event["event_id"] == clip["event_id"])
        if event["confidence"] < 0.55:
            warnings.append(f"Highlight {event['event_id']} memiliki confidence rendah.")
    duplicate_replays = find_near_duplicate_plays(project)
    if duplicate_replays:
        errors.append("Timeline mengulang hampir seluruh source yang sama untuk impact berdekatan; gabungkan sebagai satu take atau hapus duplikat. "
                      + json.dumps(duplicate_replays, ensure_ascii=False))
    missing_editing = (missing_default_editing_requirements(project)
                       if render_mode != "rough_preview" else [])
    if missing_editing:
        errors.append("Profil Smooth/Clean multi-kill belum memenuhi minimum editing: "
                      + ", ".join(missing_editing) + ". Perbaiki timeline sebelum master render.")
    return {"errors": errors, "warnings": warnings, "duration_us": duration_us,
            "total_frames": total_frames, "fps": fps, "width": width, "height": height,
            "music_duration_us": music_duration_us, "output_path": str(destination)}


def render_montage(project: dict[str, Any], output_path: str, *, rights_acknowledged: bool,
                   ownership_acknowledged: bool, cancel_event: Any,
                   progress: ProgressCallback, render_mode: str = "master",
                   partial_token: str | None = None) -> dict[str, Any]:
    if render_mode not in {"master", "rough_preview", "effects_preview"}:
        raise ProjectValidationError("Render mode tidak didukung.")
    project = validate_project(project, require_timeline=True)
    report = preflight(project, output_path, rights_acknowledged, ownership_acknowledged, render_mode)
    if report["errors"]:
        raise ProjectValidationError("Preflight gagal: " + " ".join(report["errors"]))
    destination = Path(report["output_path"])
    if destination.exists():
        raise ProjectValidationError(f"Output sudah ada; pilih nama lain: {destination}")
    partial = render_partial_path(destination, partial_token)
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
    input_count = len(project["timeline"])
    rife_inputs: dict[tuple[int, int], int] = {}
    rife_assets: list[dict[str, Any]] = []
    interpolation_warnings: list[str] = []
    for clip_index, clip in enumerate(project["timeline"]):
        source = source_by_id[clip["source_media_id"]]
        for segment_index, segment in enumerate(clip["time_remap"]):
            if render_mode == "rough_preview" or segment["speed_num"] >= segment["speed_den"] or segment.get("direction", "forward") != "forward":
                continue
            output_frames = segment["output_end_frame"] - segment["output_start_frame"]
            if cancel_event.is_set():
                raise InterruptedError("Render dibatalkan pengguna sebelum tahap RIFE.")
            progress(0.02, f"Menyiapkan RIFE untuk slow motion segmen {clip_index + 1}")
            try:
                asset = render_rife_segment(source, segment, fps, output_frames, cancel_event=cancel_event)
            except MediaToolError as exc:
                asset = None
                interpolation_warnings.append(f"Clip {clip['clip_id']}: {exc}")
            if asset:
                rife_inputs[(clip_index, segment_index)] = input_count
                rife_assets.append({"clip_id": clip["clip_id"], "segment_index": segment_index, **asset})
                inputs.extend(["-i", asset["path"]])
                input_count += 1
            elif not interpolation_warnings or not interpolation_warnings[-1].startswith(f"Clip {clip['clip_id']}:"):
                interpolation_warnings.append(
                    f"Clip {clip['clip_id']}: source bukan CFR atau runtime/model RIFE tidak tersedia; memakai interpolasi FFmpeg timestamp-aware."
                )
    music = project.get("music")
    music_index: int | None = None
    if music:
        music_index = input_count
        inputs.extend(["-i", music["path"]])
    width, height = report["width"], report["height"]
    graph, out_video, out_audio = _build_filter_graph(
        project, fps, clip_audio, music_index, rife_inputs, width=width, height=height,
        enable_effects=render_mode != "rough_preview")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise MediaToolError("FFmpeg tidak ditemukan di PATH.")
    command = [ffmpeg, "-hide_banner", "-nostats", "-y", *_filter_buffer_options(ffmpeg), *inputs,
               "-filter_complex_threads", "2", "-filter_complex", graph, "-map", out_video, "-map", out_audio,
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
               "-r", f"{fps}/1", "-fps_mode", "cfr", "-c:a", "aac", "-b:a", "320k",
               "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-t", f"{duration_seconds:.9f}",
               "-progress", "pipe:1", "-f", "mp4", str(partial)]
    expected_size = max(64 * 1024 * 1024, int(duration_seconds * 5_000_000))
    free = shutil.disk_usage(destination.parent).free
    if free < expected_size:
        raise ProjectValidationError(f"Ruang disk berkurang selama preflight; butuh {expected_size} bytes.")
    process: subprocess.Popen[str] | None = None
    drain_thread: threading.Thread | None = None
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
        timeline_payload = json.dumps(project["timeline"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        import hashlib
        project["render_manifest"] = {
            "render_version": 2,
            "upstream_commit": UPSTREAM_COMMIT,
            "timeline_sha256": hashlib.sha256(timeline_payload.encode("utf-8")).hexdigest(),
            "master_profile": {"width": width, "height": height, "fps_num": fps, "fps_den": 1},
            "render_mode": render_mode,
            "audio": {"sample_rate": 48000, "limiter_true_peak_target_dbfs": -0.72,
                      "music_ducking": "sidechaincompress" if music_index is not None else "off",
                      "music_source_duration_us": report.get("music_duration_us"),
                      "music_offset_us": max(0, int(music.get("offset_us", 0))) if music else None,
                      "music_coverage_us": max(0, int(report["music_duration_us"])
                                                - max(0, int(music.get("offset_us", 0))))
                      if music and report.get("music_duration_us") is not None else None,
                      "music_required_coverage_us": report["duration_us"] if music else None,
                      "impact_sfx_sync_tolerance_us": round(500_000 / fps)},
            "interpolation": {"rife_segments": rife_assets, "fallback_warnings": interpolation_warnings},
            "effects_applied": [
                {"clip_id": clip["clip_id"], "event_id": clip["event_id"],
                 "included_event_ids": clip.get("included_event_ids") or [clip["event_id"]],
                 "types": [effect["type"] for effect in clip.get("effects", []) if effect.get("enabled", True)]
                 if render_mode != "rough_preview" else [],
                 "impact_output_frame": _impact_output_frame(
                     clip, next(event["source_time_us"] for event in project["events"] if event["event_id"] == clip["event_id"])),
                 "impact_output_frames": {
                     event_id: _impact_output_frame(clip, next(event["source_time_us"] for event in project["events"]
                                                               if event["event_id"] == event_id))
                     for event_id in (clip.get("included_event_ids") or [clip["event_id"]])}}
                for clip in project["timeline"]
            ],
            "transitions_applied": [
                {"clip_id": clip["clip_id"],
                 "types": [transition["type"] for transition in clip.get("transitions", [])
                           if transition.get("enabled", True)] if render_mode != "rough_preview" else [],
                 "duration_frames": [transition["duration_frames"] for transition in clip.get("transitions", [])
                                     if transition.get("enabled", True)] if render_mode != "rough_preview" else []}
                for clip in project["timeline"]
            ],
        }
        sidecar = destination.with_suffix(".project.json")
        qc = run_quality_control(str(partial), project)
        if cancel_event.is_set():
            raise InterruptedError("Render dibatalkan pengguna.")
        qa_json = destination.with_suffix(".qa.json")
        qa_html = destination.with_suffix(".qa.html")
        publish_render(partial, destination, {
            sidecar: json.dumps(project, ensure_ascii=False, indent=2) + "\n",
            qa_json: json.dumps(qc, ensure_ascii=False, indent=2) + "\n",
            qa_html: _html_report(qc),
        })
        progress(1.0, f"QC {qc['status']}")
        return {"output_path": str(destination), "project_sidecar": str(sidecar),
                "qa_json": str(qa_json), "qa_html": str(qa_html), "qa": qc,
                "state": "complete" if qc["status"] == "PASS" else "needs_review"}
    finally:
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        if drain_thread and drain_thread.is_alive():
            drain_thread.join(timeout=2)
        if process and process.stdout:
            process.stdout.close()
        if process and process.stderr:
            process.stderr.close()
        partial.unlink(missing_ok=True)


def _impact_output_frame(clip: dict[str, Any], source_time_us: int) -> int:
    candidates = []
    for segment in clip["time_remap"]:
        start, end = segment["source_start_us"], segment["source_end_us"]
        if start <= source_time_us <= end:
            fraction = (source_time_us - start) / max(1, end - start)
            if segment.get("direction", "forward") == "reverse":
                fraction = 1.0 - fraction
            candidates.append(segment["output_start_frame"] + round(fraction * (segment["output_end_frame"] - segment["output_start_frame"])))
    return max(0, min(clip["duration_frames"] - 1, min(candidates) if candidates else 0))


def _atempo_filters(speed_num: int, speed_den: int) -> str:
    speed = speed_num / speed_den
    parts: list[float] = []
    while speed > 2.0:
        parts.append(2.0)
        speed /= 2.0
    while speed < 0.5:
        parts.append(0.5)
        speed /= 0.5
    if abs(speed - 1.0) > 1e-6 or not parts:
        parts.append(speed)
    return ",".join(f"atempo={value:.8f}" for value in parts)


def _sfx_beat_time(project: dict[str, Any], impact_time_us: int) -> int:
    music = project.get("music")
    if not music:
        return impact_time_us
    offset = max(0, int(music.get("offset_us", 0)))
    fps = PROFILES[project["settings"]["output_profile"]]
    tolerance_us = round(500_000 / fps)
    nearest = min((marker for marker in music.get("beat_grid", [])
                   if isinstance(marker, dict) and type(marker.get("time_us")) is int),
                  key=lambda marker: abs(marker["time_us"] - (impact_time_us + offset)), default=None)
    if nearest is None:
        return impact_time_us
    target = int(nearest["time_us"]) - offset
    return target if target >= 0 and abs(target - impact_time_us) <= tolerance_us else impact_time_us


def _zoom_keyframe_expression(effect: dict[str, Any], impact_frame: int, fallback_zoom: float,
                              duration_frames: int) -> str:
    points = effect.get("keyframes")
    if not isinstance(points, list) or len(points) < 2:
        return f"1+{fallback_zoom:.6f}*pow(max(0,1-abs(in-{impact_frame})/{duration_frames}),2)"
    valid = [point for point in points if isinstance(point, dict)
             and type(point.get("frame_offset")) is int
             and isinstance(point.get("scale"), (int, float))]
    valid.sort(key=lambda point: point["frame_offset"])
    if len(valid) < 2:
        return f"1+{fallback_zoom:.6f}*pow(max(0,1-abs(in-{impact_frame})/{duration_frames}),2)"
    relative = f"(in-{impact_frame})"
    expression = f"{float(valid[-1]['scale']):.6f}"
    for left, right in reversed(list(zip(valid, valid[1:]))):
        start, end = int(left["frame_offset"]), int(right["frame_offset"])
        a, b = float(left["scale"]), float(right["scale"])
        lerp = f"{a:.6f}+(({relative}-{start})*({b - a:.6f})/{end - start})"
        expression = f"if(lte({relative},{end}),{lerp},{expression})"
    expression = f"if(lte({relative},{int(valid[0]['frame_offset'])}),{float(valid[0]['scale']):.6f},{expression})"
    return expression


def _max_expression(parts: list[str]) -> str:
    if not parts:
        return "0"
    expression = parts[0]
    for part in parts[1:]:
        expression = f"max({expression},{part})"
    return expression


def _or_expression(parts: list[str]) -> str:
    # FFmpeg's expression evaluator supports max(x,y) for boolean conditions,
    # while the or() function is missing in several Windows builds.
    return _max_expression(parts)


def _build_filter_graph(project: dict[str, Any], fps: int, clip_audio: list[bool],
                        music_index: int | None,
                        rife_inputs: dict[tuple[int, int], int] | None = None, *,
                        width: int = 2560, height: int = 1440,
                        enable_effects: bool = True) -> tuple[str, str, str]:
    graph: list[str] = []
    intensity = float(project["settings"].get("effects_intensity", 0.45))
    gameplay_gain = float(project["settings"].get("gameplay_gain", 1.0))
    music_gain = float(project["settings"].get("music_gain", 0.18))
    event_by_id = {event["event_id"]: event for event in project["events"]}
    source_by_id = {source["media_id"]: source for source in project["sources"]}
    clip_video_labels: list[str] = []
    clip_audio_labels: list[str] = []
    sfx_labels: list[str] = []
    output_offset_frames = 0
    rife_inputs = rife_inputs or {}

    for index, clip in enumerate(project["timeline"]):
        event = event_by_id[clip["event_id"]]
        source = source_by_id[clip["source_media_id"]]
        video_metadata = source.get("video")
        video_metadata = video_metadata if isinstance(video_metadata, dict) else {}
        rate = video_metadata.get("avg_frame_rate")
        source_interval = 1 / 30
        if isinstance(rate, (tuple, list)) and len(rate) == 2 and all(type(part) is int and part > 0 for part in rate):
            source_interval = rate[1] / rate[0]
        timestamps = video_metadata.get("timestamp_behavior")
        if isinstance(timestamps, dict):
            measured_interval = timestamps.get("median_frame_interval_us")
            if type(measured_interval) is int and measured_interval > 0:
                source_interval = measured_interval / 1_000_000
        segment_pairs: list[str] = []
        segment_audio: list[str] = []
        segment_count = len(clip["time_remap"])
        clip_start = clip["in_us"] / 1_000_000
        clip_end = clip["out_us"] / 1_000_000
        ordinary_segments = [part for part in range(segment_count) if (index, part) not in rife_inputs]
        if len(ordinary_segments) > 1:
            ordinary_labels = [f"vsrc{index}_{part}" for part in ordinary_segments]
            graph.append(f"[{index}:v:0]trim=start={clip_start:.6f}:end={clip_end:.6f},split={len(ordinary_labels)}"
                         + "".join(f"[{label}]" for label in ordinary_labels))
            video_source_labels = dict(zip(ordinary_segments, ordinary_labels))
        elif ordinary_segments:
            video_source_labels = {ordinary_segments[0]: f"{index}:v:0"}
        else:
            video_source_labels = {}
        forward_audio = [part for part, segment in enumerate(clip["time_remap"])
                         if clip_audio[index] and segment.get("direction", "forward") == "forward"]
        audio_source_labels = {part: f"{index}:a:0" for part in forward_audio}
        if len(forward_audio) > 1:
            audio_source_labels = {part: f"asrc{index}_{part}" for part in forward_audio}
            graph.append(f"[{index}:a:0]atrim=start={clip_start:.6f}:end={clip_end:.6f},asplit={len(forward_audio)}"
                         + "".join(f"[{label}]" for label in audio_source_labels.values()))
        for segment_index, segment in enumerate(clip["time_remap"]):
            video_label = f"v{index}_{segment_index}"
            audio_label = f"a{index}_{segment_index}"
            segment_frames = segment["output_end_frame"] - segment["output_start_frame"]
            segment_duration = segment_frames / fps
            src_start = segment["source_start_us"] / 1_000_000
            src_end = segment["source_end_us"] / 1_000_000
            speed_num, speed_den = segment["speed_num"], segment["speed_den"]
            speed = speed_num / speed_den
            if (index, segment_index) in rife_inputs:
                source_video_index = rife_inputs[(index, segment_index)]
                video = (f"[{source_video_index}:v:0]setpts=PTS-STARTPTS,trim=end_frame={segment_frames},"
                         f"setpts=N/({fps}*TB),scale={width}:{height}:force_original_aspect_ratio=increase,"
                         f"crop={width}:{height},setsar=1,format=yuv420p[{video_label}]")
            else:
                reverse = segment.get("direction", "forward") == "reverse"
                video_start, video_end = src_start, src_end
                # A trimmed ramp can begin and end between decoded timestamps.
                # Supply pictures from the same clip without extending the authored output.
                minimum_window = 2 * source_interval
                if src_end - src_start < minimum_window:
                    video_end = min(clip_end, max(src_end, src_start + minimum_window))
                    video_start = max(clip_start, min(src_start, video_end - minimum_window))
                video = (f"[{video_source_labels[segment_index]}]trim=start={video_start:.6f}:end={video_end:.6f},"
                         "setpts=PTS-STARTPTS")
                if reverse:
                    video += ",reverse,setpts=PTS-STARTPTS"
                if enable_effects and segment_frames > 1 and video_end - video_start >= 4 * source_interval:
                    cadence = f"minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"
                else:
                    cadence = f"tpad=stop_mode=clone:stop=2,fps={fps}"
                video += (f",setpts=PTS*{speed_den}/{speed_num},{cadence},"
                          f"tpad=stop_mode=clone:stop_duration={segment_duration:.9f},trim=end_frame={segment_frames},"
                          f"setpts=N/({fps}*TB),scale={width}:{height}:force_original_aspect_ratio=increase,"
                          f"crop={width}:{height},setsar=1,format=yuv420p[{video_label}]")
            graph.append(video)
            segment_pairs.append(f"[{video_label}]")

            if segment_index in audio_source_labels:
                tempo = ""
                if speed_num != speed_den:
                    # The time-stretch filter must receive a complete analysis window.
                    # A few milliseconds of audio can otherwise yield no samples at all.
                    if src_end - src_start < 0.1:
                        tempo = "apad=pad_dur=0.1,"
                    tempo += _atempo_filters(speed_num, speed_den) + ","
                audio = (f"[{audio_source_labels[segment_index]}]atrim=start={src_start:.6f}:end={src_end:.6f},asetpts=PTS-STARTPTS,"
                         f"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,{tempo}"
                         f"volume={float(clip.get('audio_gain', gameplay_gain)):.4f},apad,atrim=duration={segment_duration:.9f}[{audio_label}]")
            else:
                audio = f"anullsrc=r=48000:cl=stereo,atrim=duration={segment_duration:.9f}[{audio_label}]"
            graph.append(audio)
            segment_audio.append(f"[{audio_label}]")

        if len(segment_pairs) == 1:
            video_base = segment_pairs[0]
            audio_base = segment_audio[0]
        else:
            graph.append(f"{''.join(v + a for v, a in zip(segment_pairs, segment_audio))}"
                         f"concat=n={len(segment_pairs)}:v=1:a=1[vbase{index}][abase{index}]")
            video_base, audio_base = f"[vbase{index}]", f"[abase{index}]"

        impact = _impact_output_frame(clip, int(event["source_time_us"]))
        included_event_ids = clip.get("included_event_ids") or [clip["event_id"]]
        included_events = [event_by_id[event_id] for event_id in included_event_ids]
        impact_by_event = {item["event_id"]: _impact_output_frame(clip, int(item["source_time_us"]))
                           for item in included_events}
        impact_frames = sorted(set(impact_by_event.values()))
        effective_tags = {tag for item in included_events for tag in item.get("tags", [])}
        if len(included_event_ids) > 1:
            effective_tags.add("multikill")
        video = video_base
        chain: list[str] = []
        effects = [item for item in clip.get("effects", []) if item.get("enabled", True)] if enable_effects else []
        zoom = next((item for item in effects if item.get("type") == "impact_zoom"), None)
        shake = next((item for item in effects if item.get("type") == "screen_shake"), None)
        if zoom or shake:
            zoom_duration = max(1, int((zoom or {}).get("duration_frames", 18)))
            shake_duration = max(1, int((shake or {}).get("duration_frames", 12)))
            zoom_amount = max(0.0, float((zoom or {}).get("max_zoom", 1.0)) - 1.0)
            shake_amount = float((shake or {}).get("amplitude_px", 0.0))
            shake_envelopes = [f"pow(max(0,1-abs(in-{frame})/{shake_duration}),2)" for frame in impact_frames]
            envelope = _max_expression(shake_envelopes)
            x = f"iw/2-iw/zoom/2+{shake_amount:.3f}*sin(in*1.71)*{envelope}"
            y = f"ih/2-ih/zoom/2+{shake_amount * 0.72:.3f}*sin(in*1.23+1.1)*{envelope}"
            primary_zoom = _zoom_keyframe_expression(zoom or {}, impact, zoom_amount, zoom_duration)
            if len(impact_frames) > 1 and zoom_amount > 0:
                zoom_parts = [f"({primary_zoom}-1)"]
                zoom_parts.extend(f"{zoom_amount:.6f}*pow(max(0,1-abs(in-{frame})/{zoom_duration}),2)"
                                  for frame in impact_frames if frame != impact)
                zoom_expression = f"1+{_max_expression(zoom_parts)}"
            else:
                zoom_expression = primary_zoom
            if shake_amount > 0:
                # zoompan clamps x/y to the crop's valid area. Reserve enough
                # pixels for shake even when there is no separate zoom effect.
                overscan = max(shake_amount * 2 / width, shake_amount * 1.44 / height)
                zoom_expression = f"max({zoom_expression},1/(1-{overscan:.9f}*{envelope}))"
            chain.append(f"zoompan=z='{zoom_expression}':x='{x}':y='{y}':d=1:s={width}x{height}:fps={fps}")
        flash = next((item for item in effects if item.get("type") == "impact_flash"), None)
        if flash:
            flash_duration = max(1, int(flash.get("duration_frames", 2)))
            flash_intensity = float(flash.get("intensity", 0.0))
            flash_parts = [f"if(between(n,{frame},{frame + flash_duration - 1}),"
                           f"{flash_intensity:.5f}*max(0,1-(n-{frame})/{flash_duration}),0)"
                           for frame in impact_frames]
            chain.append(f"eq=brightness='{_max_expression(flash_parts)}':eval=frame")
        blur = next((item for item in effects if item.get("type") == "motion_blur"), None)
        if blur and float(blur.get("strength", 0.0)) > 0:
            window = int(blur.get("window_frames", 3))
            edge = float(blur.get("strength", 0.0))
            weights = f"{edge:.4f} 1 {edge:.4f}" if window == 3 else f"{edge * 0.5:.4f} {edge:.4f} 1 {edge:.4f} {edge * 0.5:.4f}"
            blur_intervals = [f"between(n,{max(0, frame - 3)},{frame + 8})" for frame in impact_frames]
            blur_enable = _or_expression(blur_intervals)
            chain.append(f"tmix=frames={window}:weights='{weights}':enable='{blur_enable}'")

        transition_in = next((item for item in clip.get("transitions", []) if item.get("enabled", True)), None) if enable_effects else None
        transition_out = next((item for item in project["timeline"][index + 1].get("transitions", [])
                               if item.get("enabled", True)), None) if index + 1 < len(project["timeline"]) else None
        if not enable_effects:
            transition_out = None
        in_frames = min(int((transition_in or {}).get("duration_frames", 0)), clip["duration_frames"] // 2)
        out_frames = min(int((transition_out or {}).get("duration_frames", 0)), clip["duration_frames"] // 2)
        if in_frames and index > 0:
            chain.append(f"fade=t=in:st=0:d={in_frames / fps:.9f}")
        if out_frames and index + 1 < len(project["timeline"]):
            chain.append(f"fade=t=out:st={(clip['duration_frames'] - out_frames) / fps:.9f}:d={out_frames / fps:.9f}")
        if chain:
            graph.append(f"{video}{','.join(chain)},trim=end_frame={clip['duration_frames']},setpts=N/({fps}*TB)[vclip{index}]")
            video = f"[vclip{index}]"
        else:
            video = video_base
        clip_video_labels.append(video)
        clip_audio_labels.append(audio_base)

        impact_local_us = round(impact * 1_000_000 / fps)
        hit_us = _sfx_beat_time(project, output_offset_frames * 1_000_000 // fps + impact_local_us)
        hit_sample = max(0, round(hit_us * 48_000 / 1_000_000))
        if enable_effects and intensity > 0 and any(effect.get("type") in {"impact_zoom", "impact_flash"} and effect.get("enabled", True)
                                 for effect in effects):
            frequency = 72 if "multikill" in effective_tags or "clutch" in effective_tags else 88
            label = f"sfx{index}"
            graph.append(f"aevalsrc='0.30*sin(2*PI*({frequency}-130*t)*t)*exp(-15*t)':s=48000:d=0.28,"
                         f"pan=stereo|c0=c0|c1=c0,volume={0.56 * intensity:.4f},adelay={hit_sample}S[{label}]")
            sfx_labels.append(f"[{label}]")
        output_offset_frames += clip["duration_frames"]

    if len(clip_video_labels) == 1:
        video_output = clip_video_labels[0]
        audio_output = clip_audio_labels[0]
    else:
        graph.append(f"{''.join(v + a for v, a in zip(clip_video_labels, clip_audio_labels))}"
                     f"concat=n={len(clip_video_labels)}:v=1:a=1[vc][ac]")
        video_output, audio_output = "[vc]", "[ac]"
    total_duration = sum(clip["duration_frames"] for clip in project["timeline"]) / fps
    audio_inputs = [audio_output]
    if music_index is not None:
        music_offset = max(0, int(project["music"].get("offset_us", 0))) / 1_000_000
        graph.append(f"[{music_index}:a:0]atrim=start={music_offset:.6f},asetpts=PTS-STARTPTS,"
                     f"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                     f"volume={music_gain:.4f},atrim=duration={total_duration:.9f}[music]")
        audio_inputs.append("[music]")
    audio_inputs.extend(sfx_labels)
    if music_index is not None:
        graph.append(f"{audio_output}asplit=2[game_mix][game_sidechain]")
        graph.append("[music][game_sidechain]sidechaincompress=threshold=0.08:ratio=3.5:attack=8:release=180:makeup=1[ducked]")
        audio_inputs = ["[game_mix]", "[ducked]", *sfx_labels]
    if len(audio_inputs) > 1:
        graph.append(f"{''.join(audio_inputs)}amix=inputs={len(audio_inputs)}:duration=first:dropout_transition=0:normalize=0,"
                     "alimiter=limit=0.92:attack=5:release=50[ao]")
    else:
        graph.append(f"{audio_output}alimiter=limit=0.92:attack=5:release=50[ao]")
    return ";".join(graph), video_output, "[ao]"


def _html_report(report: dict[str, Any]) -> str:
    import html
    rows = "".join(f"<li><strong>{html.escape(item['status'])}</strong> — {html.escape(item['message'])}</li>"
                   for item in report.get("checks", []))
    gate_rows = "".join(
        f"<li><strong>{html.escape(gate.get('status', 'UNKNOWN'))}</strong> — "
        f"{html.escape(name)}: {html.escape(gate.get('message', ''))}</li>"
        for name, gate in (report.get("feature_gates") or {}).items())
    title = html.escape(report.get("status", "UNKNOWN"))
    return ("<!doctype html><html lang='id'><meta charset='utf-8'><title>VALORANT Montage Studio QA</title>"
            "<style>body{font:16px system-ui;max-width:880px;margin:4rem auto;padding:0 1rem;color:#17202a}"
            "li{margin:.8rem 0}.status{font-size:1.5rem}</style><body>"
            f"<h1>QA export</h1><p class='status'>Status: {title}</p><p>File: {html.escape(report.get('file', ''))}</p>"
            f"<h2>Feature gates</h2><ul>{gate_rows}</ul>"
            f"<ul>{rows}</ul></body></html>")
