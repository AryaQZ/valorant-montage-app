"""Independent post-render verification and readable QA reporting."""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path
from typing import Any
import re
import shutil
import subprocess
import hashlib
import json

from .media import MediaToolError, probe_media
from .schema import PROFILE_DIMENSIONS, PROFILES, frames_to_duration_us


FEATURE_STATES = {"NOT_REQUESTED", "NOT_APPLICABLE", "EXECUTED_SUCCESSFULLY", "REQUESTED_BUT_MISSING", "MANIFEST_ONLY"}
ATTACK_STRENGTH_FLOOR = {"low": 0.5, "mid": 0.6, "high": 0.65}


def _feature_gate(status: str, message: str, **details: Any) -> dict[str, Any]:
    if status not in FEATURE_STATES:
        raise ValueError(f"Invalid QA feature state: {status}")
    return {"status": status, "message": message, **details}


def _has_measured_attacks(music: dict[str, Any] | None) -> bool:
    if not isinstance(music, dict):
        return False
    return any(_is_impact_attack(item) for item in music.get("beat_grid", []))


def _is_impact_attack(marker: Any) -> bool:
    """Match upstream draft_ref_timeline's kick/snare/loud-hat strength floors."""
    if not isinstance(marker, dict) or marker.get("kind") != "measured_attack":
        return False
    band = marker.get("attack_band")
    floor = ATTACK_STRENGTH_FLOOR.get(band, 0.65)
    strength = marker.get("strength", marker.get("confidence", 0.0))
    return (isinstance(strength, (int, float)) and not isinstance(strength, bool)
            and strength >= floor)


def find_near_duplicate_plays(project: dict[str, Any]) -> list[dict[str, Any]]:
    """Find separate timeline clips that replay almost the same source moment.

    This deliberately targets false duplicate kill detections: same source,
    nearly identical source windows, and impacts within 100 ms. It does not
    reject normal chronological multi-kills inside one continuous clip.
    """
    events = {event.get("event_id"): event for event in project.get("events", [])
              if isinstance(event, dict)}
    clips = project.get("timeline") or []
    duplicates: list[dict[str, Any]] = []
    for left_index, left in enumerate(clips):
        left_event = events.get(left.get("event_id"), {})
        for right in clips[left_index + 1:]:
            if left.get("source_media_id") != right.get("source_media_id"):
                continue
            right_event = events.get(right.get("event_id"), {})
            try:
                overlap = max(0, min(int(left["out_us"]), int(right["out_us"]))
                              - max(int(left["in_us"]), int(right["in_us"])))
                shorter = min(int(left["out_us"]) - int(left["in_us"]),
                              int(right["out_us"]) - int(right["in_us"]))
                impact_delta = abs(int(left_event["source_time_us"]) - int(right_event["source_time_us"]))
            except (KeyError, TypeError, ValueError):
                continue
            ratio = overlap / shorter if shorter > 0 else 0.0
            if ratio >= 0.95 and impact_delta <= 100_000:
                duplicates.append({"clip_ids": [left.get("clip_id"), right.get("clip_id")],
                                   "source_media_id": left.get("source_media_id"),
                                   "overlap_ratio": round(ratio, 4),
                                   "impact_delta_us": impact_delta})
    return duplicates


def missing_default_editing_requirements(project: dict[str, Any]) -> list[str]:
    """Quality floor for multi-highlight Smooth/Clean masters in the app defaults."""
    settings = project.get("settings") or {}
    timeline = project.get("timeline") or []
    if (settings.get("style") != "smooth_clean" or len(timeline) < 3
            or float(settings.get("effects_intensity", 0.0)) <= 0):
        return []
    missing: list[str] = []
    speeds = {segment["speed_num"] / segment["speed_den"]
              for clip in timeline for segment in clip.get("time_remap", [])
              if segment.get("speed_den", 0) > 0}
    if not any(speed < 1.0 for speed in speeds) or len(speeds) < 2:
        missing.append("selective slow motion and a speed ramp")
    scheduled = {effect.get("type") for clip in timeline for effect in clip.get("effects", [])
                 if effect.get("enabled", True)}
    if "impact_zoom" not in scheduled or "motion_blur" not in scheduled:
        missing.append("impact zoom with motion blur")
    if not scheduled.intersection({"impact_flash", "screen_shake"}):
        missing.append("a contextual flash or camera shake")
    if not any(transition.get("enabled", True)
               for clip in timeline for transition in clip.get("transitions", [])):
        missing.append("a restrained transition between selected takes")
    return missing


def run_quality_control(path_value: str, project: dict[str, Any]) -> dict[str, Any]:
    path = Path(path_value).resolve(strict=True)
    fps = PROFILES[project["settings"]["output_profile"]]
    expected_frames = sum(clip["duration_frames"] for clip in project["timeline"])
    expected_us = frames_to_duration_us(expected_frames, fps)
    manifest = project.get("render_manifest") or {}
    profile = manifest.get("master_profile") or {}
    expected_width, expected_height = PROFILE_DIMENSIONS[project["settings"]["output_profile"]]
    if type(profile.get("width")) is int and type(profile.get("height")) is int:
        expected_width, expected_height = profile["width"], profile["height"]
    media = probe_media(str(path), sample_vfr=False)
    video = media["video"]
    checks: list[dict[str, str]] = []
    failures = 0
    warnings = 0

    def check(condition: bool, message: str, *, warning: bool = False) -> None:
        nonlocal failures, warnings
        if condition:
            checks.append({"status": "PASS", "message": message})
        elif warning:
            warnings += 1
            checks.append({"status": "WARN", "message": message})
        else:
            failures += 1
            checks.append({"status": "FAIL", "message": message})

    check(video.get("width") == expected_width and video.get("height") == expected_height,
          f"Ukuran output {video.get('width')}x{video.get('height')}; target {expected_width}x{expected_height}.")
    rate = video.get("avg_frame_rate")
    check(rate == (fps, 1), f"Frame rate {rate}; target {fps}/1 FPS.")
    check(bool(media.get("has_audio")), "Output memiliki audio stream.")
    audio_stream = (media.get("audio") or [{}])[0]
    audio_duration = audio_stream.get("duration_us")
    audio_drift = None if audio_duration is None else int(audio_duration) - expected_us
    check(audio_drift is not None and abs(audio_drift) <= 50_000,
          f"Drift durasi audio {audio_drift if audio_drift is not None else 'tidak terukur'} us (batas 50 ms).",
          warning=audio_drift is None)
    audio_start_value = audio_stream.get("start_time_us")
    audio_start = int(audio_start_value) if isinstance(audio_start_value, int) else None
    check(audio_start is not None and abs(audio_start) <= 20_000,
          f"Audio mulai pada offset {audio_start if audio_start is not None else 'tidak terukur'} us (batas 20 ms).",
          warning=audio_start is None)
    check(abs(media["duration_us"] - expected_us) <= max(10_000, round(1_000_000 / fps)),
          f"Durasi aktual {media['duration_us']} us; target {expected_us} us.")
    timing = _audit_pts(path, fps)
    # _audit_pts already enumerates every decoded video frame. Reuse that count
    # instead of running another full FFprobe decode on every successful render.
    # If the frame-timestamp pass could not produce a count, retain the older
    # count_frames probe as a slower fallback.
    counted_frames = timing.get("frames")
    frame_count_source = "ffprobe_show_frames" if isinstance(counted_frames, int) else None
    if not isinstance(counted_frames, int):
        counted_frames = _count_frames(path)
        if isinstance(counted_frames, int):
            frame_count_source = "ffprobe_count_frames"
    check(counted_frames == expected_frames,
          f"Jumlah frame terhitung {counted_frames}; target {expected_frames}.")
    check(timing["monotonic"] and timing["cfr"],
          f"PTS video monotonic dan CFR {fps}/1; delta maksimum {timing['max_delta_error_us']} us.")
    duplicate_run = _max_duplicate_run(path)
    check(duplicate_run is None or duplicate_run <= 2,
          f"Run frame identik terpanjang {duplicate_run if duplicate_run is not None else 'tidak terukur'} frame.", warning=duplicate_run is None or duplicate_run > 2)
    near_duplicate_plays = find_near_duplicate_plays(project)
    check(not near_duplicate_plays,
          f"Timeline memutar ulang hampir seluruh source yang sama untuk impact berdekatan: {near_duplicate_plays}.")
    black = _detect_intervals(path, "blackdetect=d=0.08:pix_th=0.08:pic_th=0.98", r"black_start:([0-9.]+).*?black_end:([0-9.]+)")
    if black is None:
        check(False, "Black segments tidak dapat diperiksa; FFmpeg/blackdetect gagal.", warning=True)
    else:
        check(not black, f"Black segments terdeteksi: {len(black)}.", warning=True)
    silence = _detect_intervals(
        path,
        "silencedetect=noise=-50dB:d=1",
        r"silence_start:\s*([0-9.]+)(?:[\s\S]*?silence_end:\s*([0-9.]+))?",
        audio=True,
    )
    if silence is None:
        check(False, "Silence tidak dapat diperiksa; FFmpeg/silencedetect gagal.", warning=True)
    else:
        check(not silence, f"Silence >=1 detik terdeteksi: {len(silence)}.", warning=True)
    peak = _measure_peak(path)
    check(peak is not None and peak < -0.1, "Peak audio di bawah -0.1 dBFS." if peak is not None else
          "Peak audio tidak dapat diukur; filter volumedetect tidak tersedia.", warning=peak is None)
    status = "FAIL" if failures else "WARN" if warnings else "PASS"
    effect_types = sorted({effect_type for item in (manifest.get("effects_applied") or [])
                           if isinstance(item, dict) for effect_type in item.get("types", [])})
    timeline_payload = json.dumps(project["timeline"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    expected_timeline_hash = hashlib.sha256(timeline_payload.encode("utf-8")).hexdigest()
    check(manifest.get("timeline_sha256") == expected_timeline_hash,
          "Manifest render mengacu ke hash timeline yang sama.")
    check(profile.get("width") == expected_width and profile.get("height") == expected_height
          and profile.get("fps_num") == fps and profile.get("fps_den") == 1,
          "Manifest render memakai profil output yang diminta.")
    audio_manifest = manifest.get("audio") or {}
    check(audio_manifest.get("sample_rate") == 48000
          and audio_manifest.get("music_ducking") == ("sidechaincompress" if project.get("music") else "off"),
          "Manifest audio mencatat sample rate, ducking musik, dan limiter yang digunakan.")
    effects_applied = manifest.get("effects_applied") or []
    traced_clip_ids = {item.get("clip_id") for item in effects_applied if isinstance(item, dict)}
    expected_clip_ids = {clip["clip_id"] for clip in project["timeline"]}
    check(traced_clip_ids == expected_clip_ids,
          "Manifest mencatat efek dan frame impact untuk setiap clip timeline.")
    expected_event_ids = {event_id for clip in project["timeline"]
                          for event_id in (clip.get("included_event_ids") or [clip["event_id"]])}
    traced_event_ids = {event_id for item in effects_applied if isinstance(item, dict)
                        for event_id in item.get("included_event_ids", [item.get("event_id")])}
    impact_frames_complete = all(
        isinstance(item.get("impact_output_frames"), dict)
        and set(item["impact_output_frames"]) == set(item.get("included_event_ids", [item.get("event_id")]))
        for item in effects_applied if isinstance(item, dict))
    if manifest.get("render_version", 1) >= 2:
        check(traced_event_ids == expected_event_ids and impact_frames_complete,
              "Manifest mencatat setiap impact yang tergabung di clip timeline.")
    else:
        check(traced_event_ids == expected_event_ids,
              "Manifest render v1 mencatat impact utama pada setiap clip timeline.")
    interpolation = manifest.get("interpolation") or {}
    rife_segments = interpolation.get("rife_segments") or []
    check(all(isinstance(item, dict) and isinstance(item.get("cache_key"), str)
              and item.get("frames", 0) > 0 for item in rife_segments),
          f"Segmen RIFE tercatat dan ter-cache: {len(rife_segments)}.")
    expected_rife = {(clip["clip_id"], index)
                     for clip in project["timeline"]
                     for index, segment in enumerate(clip.get("time_remap", []))
                     if segment["speed_num"] < segment["speed_den"]
                     and segment.get("direction", "forward") == "forward"}
    if manifest.get("render_mode") == "rough_preview":
        expected_rife = set()
    rendered_rife = {(item.get("clip_id"), item.get("segment_index")) for item in rife_segments if isinstance(item, dict)}
    missing_rife = expected_rife - rendered_rife
    if manifest.get("render_mode") == "rough_preview":
        check(True, "RIFE dan efek sengaja dilewati pada rough preview.")
    else:
        check(not missing_rife, f"Slow motion menggunakan RIFE upstream pada {len(expected_rife)} segmen.",
              warning=False)
    beat_sync = _audit_beat_sync(project, fps)
    beat_requested = float(project["settings"].get("beat_sync_priority", 0.0)) > 0
    if not beat_requested:
        check(True, "Beat sync tidak diminta (priority 0%).")
    elif beat_sync["events"]:
        within_tolerance = all(item["nearest_attack_delta_us"] <= 80_000 for item in beat_sync["events"])
        check(within_tolerance,
              f"Offset visual impact ke attack musik terdekat maksimum {beat_sync['max_delta_us']} us (review threshold 80 ms).",
              warning=True)
    feature_gates = _feature_gates(project, manifest, beat_sync, expected_rife, missing_rife)
    for name, gate in feature_gates.items():
        if gate["status"] == "REQUESTED_BUT_MISSING":
            check(False, f"{name}: {gate['message'].rstrip('.')}.")
        elif gate["status"] == "MANIFEST_ONLY":
            check(False, f"{name}: {gate['message'].rstrip('.')}.", warning=True)
    status = "FAIL" if failures else "WARN" if warnings else "PASS"
    return {"report_version": 2, "status": status, "file": str(path),
            "expected": {"width": expected_width, "height": expected_height, "fps": fps,
                         "frames": expected_frames, "duration_us": expected_us},
            "actual": {"width": video.get("width"), "height": video.get("height"),
                       "fps": rate, "duration_us": media["duration_us"],
                       "audio_streams": len(media.get("audio", [])), "frames_counted": counted_frames,
                       "frame_count_source": frame_count_source},
            "timing": timing, "max_identical_frame_run": duplicate_run,
            "intervals": {"black": black, "silence": silence},
            "effects": effect_types, "interpolation": interpolation, "beat_sync": beat_sync,
            "feature_gates": feature_gates,
            "render_manifest": manifest,
            "audio_drift_us": audio_drift, "audio_start_us": audio_start,
            "peak_dbfs": peak, "checks": checks}


def _audit_beat_sync(project: dict[str, Any], fps: int) -> dict[str, Any]:
    music = project.get("music") or {}
    markers = sorted((marker for marker in music.get("beat_grid", [])
                      if _is_impact_attack(marker) and type(marker.get("time_us")) is int),
                     key=lambda item: (item["time_us"], str(item.get("marker_id", ""))))
    if not markers:
        return {"events": [], "max_delta_us": None, "frame_accurate_count": 0, "unique_attack_count": 0}
    offset = max(0, int(music.get("offset_us", 0)))
    event_by_id = {event["event_id"]: event for event in project["events"]}
    rows = []
    for clip in project["timeline"]:
        for event_id in (clip.get("included_event_ids") or [clip["event_id"]]):
            event = event_by_id[event_id]
            local_frame = clip["output_start_frame"] + _event_output_frame(clip, event["source_time_us"])
            output_time_us = round(local_frame * 1_000_000 / fps)
            rows.append({"event_id": event["event_id"], "output_frame": local_frame,
                         "output_time_us": output_time_us})
    if not rows:
        return {"events": [], "max_delta_us": None, "frame_accurate_count": 0, "unique_attack_count": 0}
    rows.sort(key=lambda item: (item["output_frame"], item["event_id"]))
    last_marker_time = -1
    for row in rows:
        eligible = [(index, marker) for index, marker in enumerate(markers)
                    if marker["time_us"] - offset > last_marker_time
                    and abs((marker["time_us"] - offset) - row["output_time_us"]) <= 80_000]
        if eligible:
            marker_index, marker = min(eligible, key=lambda pair: abs(
                (pair[1]["time_us"] - offset) - row["output_time_us"]))
            last_marker_time = marker["time_us"] - offset
            row["marker_assignment"] = "unique"
        else:
            _, marker = min(enumerate(markers),
                            key=lambda pair: abs((pair[1]["time_us"] - offset) - row["output_time_us"]))
            row["marker_assignment"] = "unmatched"
        delta = abs((marker["time_us"] - offset) - row["output_time_us"])
        row.update({"nearest_attack_id": marker.get("marker_id"), "attack_time_us": marker["time_us"] - offset,
                    "nearest_attack_delta_us": delta, "within_one_output_frame": delta <= round(1_000_000 / fps)})
    return {"events": rows, "max_delta_us": max(row["nearest_attack_delta_us"] for row in rows),
            "frame_accurate_count": sum(row["within_one_output_frame"] for row in rows),
            "unique_attack_count": sum(row["marker_assignment"] == "unique" for row in rows)}


def _feature_gates(project: dict[str, Any], manifest: dict[str, Any], beat_sync: dict[str, Any],
                   expected_rife: set[tuple[str, int]], missing_rife: set[tuple[str, int]]) -> dict[str, dict[str, Any]]:
    settings = project.get("settings") or {}
    timeline = project.get("timeline") or []
    music = project.get("music")
    audio = manifest.get("audio") or {}
    render_mode = manifest.get("render_mode", "master")
    beat_requested = float(settings.get("beat_sync_priority", 0.0)) > 0
    music_requested = music is not None or beat_requested
    measured = _has_measured_attacks(music)
    music_mixed = bool(music and audio.get("music_ducking") == "sidechaincompress")
    music_coverage = audio.get("music_coverage_us")
    music_required = audio.get("music_required_coverage_us")
    music_coverage_missing = (type(music_coverage) is int and type(music_required) is int
                              and music_coverage < music_required)

    if not music_requested:
        music_gate = _feature_gate("NOT_REQUESTED", "Musik tidak diminta.")
    elif not music:
        music_gate = _feature_gate("REQUESTED_BUT_MISSING", "Beat sync aktif tetapi music track tidak tersedia.")
    elif not music_mixed:
        music_gate = _feature_gate("REQUESTED_BUT_MISSING", "Music track tidak tercatat di audio mix manifest.")
    elif music_coverage_missing:
        music_gate = _feature_gate("REQUESTED_BUT_MISSING", "Music track berakhir sebelum seluruh timeline selesai.",
                                   coverage_us=music_coverage, required_coverage_us=music_required)
    else:
        music_gate = _feature_gate("EXECUTED_SUCCESSFULLY", "Music track tercatat di render manifest dengan sidechain ducking.")

    if not beat_requested:
        beat_gate = _feature_gate("NOT_REQUESTED", "Beat sync priority disetel ke 0%.")
    elif not timeline:
        beat_gate = _feature_gate("NOT_APPLICABLE", "Tidak ada impact timeline untuk disinkronkan.")
    elif not music:
        beat_gate = _feature_gate("REQUESTED_BUT_MISSING", "Beat sync aktif tetapi project tidak memiliki music track.")
    elif music_coverage_missing:
        beat_gate = _feature_gate("REQUESTED_BUT_MISSING", "Music track tidak mencakup seluruh timeline beat-sync.",
                                  coverage_us=music_coverage, required_coverage_us=music_required)
    elif not measured or not music.get("beat_grid"):
        beat_gate = _feature_gate("REQUESTED_BUT_MISSING", "Measured attack markers dari upstream tidak tersedia.")
    elif not beat_sync.get("events"):
        beat_gate = _feature_gate("REQUESTED_BUT_MISSING", "Tidak ada timeline impact yang berhasil dipetakan ke measured attack.")
    elif any(item.get("marker_assignment") != "unique" for item in beat_sync["events"]):
        beat_gate = _feature_gate("REQUESTED_BUT_MISSING", "Setiap impact harus memiliki measured attack tersendiri dalam urutan timeline.",
                                  unassigned_event_ids=[item["event_id"] for item in beat_sync["events"]
                                                        if item.get("marker_assignment") != "unique"])
    elif any(item["nearest_attack_delta_us"] > 80_000 for item in beat_sync["events"]):
        beat_gate = _feature_gate("REQUESTED_BUT_MISSING", "Satu atau lebih impact berjarak lebih dari 80 ms dari measured attack.",
                                  max_delta_us=beat_sync.get("max_delta_us"))
    else:
        beat_gate = _feature_gate("EXECUTED_SUCCESSFULLY", "Semua impact berada dalam toleransi 80 ms dari measured attack.",
                                  max_delta_us=beat_sync.get("max_delta_us"),
                                  frame_accurate_count=beat_sync.get("frame_accurate_count", 0))

    expected_effects = {
        clip["clip_id"]: sorted({effect["type"] for effect in clip.get("effects", [])
                                 if effect.get("enabled", True)})
        for clip in timeline
    }
    if render_mode == "rough_preview":
        effects_gate = _feature_gate("NOT_REQUESTED", "Effects sengaja dilewati pada rough preview.")
    elif float(settings.get("effects_intensity", 0.0)) <= 0 or not timeline:
        effects_gate = _feature_gate("NOT_REQUESTED", "Effects intensity nol atau timeline kosong.")
    elif not any(expected_effects.values()):
        effects_gate = _feature_gate("REQUESTED_BUT_MISSING", "Effects intensity aktif tetapi timeline tidak menjadwalkan contextual effects.")
    else:
        applied = {item.get("clip_id"): set(item.get("types", []))
                   for item in (manifest.get("effects_applied") or []) if isinstance(item, dict)}
        missing = {clip_id: sorted(set(kinds) - applied.get(clip_id, set()))
                   for clip_id, kinds in expected_effects.items() if kinds}
        missing = {clip_id: kinds for clip_id, kinds in missing.items() if kinds}
        if missing:
            effects_gate = _feature_gate("REQUESTED_BUT_MISSING", "Render manifest kehilangan contextual effects yang dijadwalkan.",
                                         missing_by_clip=missing)
        else:
            effects_gate = _feature_gate("MANIFEST_ONLY", "Efek tercatat di manifest. Periksa frame hasil untuk memverifikasi tampilannya.",
                                         effect_types=sorted({kind for kinds in expected_effects.values() for kind in kinds}))

    if render_mode == "rough_preview":
        rife_gate = _feature_gate("NOT_REQUESTED", "RIFE sengaja dilewati pada rough preview.")
    elif not expected_rife:
        required = (missing_default_editing_requirements(project)
                    if render_mode != "rough_preview" else [])
        if render_mode == "rough_preview":
            rife_gate = _feature_gate("NOT_REQUESTED", "RIFE sengaja dilewati pada rough preview.")
        elif required:
            rife_gate = _feature_gate("REQUESTED_BUT_MISSING",
                                      "Profil Smooth/Clean multi-kill belum menjadwalkan slow motion forward.",
                                      missing_requirements=required)
        else:
            rife_gate = _feature_gate("NOT_APPLICABLE", "Timeline tidak menjadwalkan slow motion forward.")
    elif missing_rife:
        rife_gate = _feature_gate("REQUESTED_BUT_MISSING", "Satu atau lebih slow-motion segment tidak dirender dengan RIFE.",
                                  missing_segments=[{"clip_id": clip_id, "segment_index": index}
                                                    for clip_id, index in sorted(missing_rife)])
    else:
        rife_gate = _feature_gate("EXECUTED_SUCCESSFULLY", "Semua slow-motion segment forward memiliki cache RIFE terverifikasi.",
                                  segment_count=len(expected_rife))

    expected_transitions = {
        clip["clip_id"]: [transition["type"] for transition in clip.get("transitions", [])
                          if transition.get("enabled", True)]
        for clip in timeline
    }
    if render_mode == "rough_preview":
        transition_gate = _feature_gate("NOT_REQUESTED", "Transition sengaja dilewati pada rough preview.")
    elif not any(expected_transitions.values()):
        transition_gate = _feature_gate("NOT_REQUESTED", "Tidak ada transition yang dijadwalkan pada timeline.")
    else:
        applied_transitions = {item.get("clip_id"): set(item.get("types", []))
                               for item in (manifest.get("transitions_applied") or []) if isinstance(item, dict)}
        missing = {clip_id: [kind for kind in kinds if kind not in applied_transitions.get(clip_id, set())]
                   for clip_id, kinds in expected_transitions.items() if kinds}
        missing = {clip_id: kinds for clip_id, kinds in missing.items() if kinds}
        if missing:
            transition_gate = _feature_gate("REQUESTED_BUT_MISSING", "Render manifest kehilangan transition yang dijadwalkan.",
                                            missing_by_clip=missing)
        else:
            transition_gate = _feature_gate("MANIFEST_ONLY", "Transisi tercatat di manifest. Periksa frame hasil untuk memverifikasi tampilannya.")

    near_duplicate_plays = find_near_duplicate_plays(project)
    if not timeline:
        replay_gate = _feature_gate("NOT_APPLICABLE", "Timeline kosong.")
    elif near_duplicate_plays:
        replay_gate = _feature_gate("REQUESTED_BUT_MISSING",
                                    "Clip terpisah mengulang hampir seluruh source pada impact berdekatan.",
                                    duplicate_pairs=near_duplicate_plays)
    else:
        replay_gate = _feature_gate("EXECUTED_SUCCESSFULLY",
                                    "Tidak ditemukan pemutaran ulang jendela source yang nyaris identik.")

    missing_editing = missing_default_editing_requirements(project)
    if render_mode == "rough_preview":
        editing_gate = _feature_gate("NOT_REQUESTED", "Rough preview sengaja melewati persyaratan master Smooth/Clean.")
    elif (not timeline or len(timeline) < 3
            or (project.get("settings") or {}).get("style") != "smooth_clean"
            or float((project.get("settings") or {}).get("effects_intensity", 0.0)) <= 0):
        editing_gate = _feature_gate("NOT_APPLICABLE", "Profil multi-kill Smooth/Clean tidak diminta.")
    elif missing_editing:
        editing_gate = _feature_gate("REQUESTED_BUT_MISSING",
                                     "Timeline belum memenuhi batas minimum editing untuk master Smooth/Clean.",
                                     missing_requirements=missing_editing)
    else:
        editing_gate = _feature_gate("EXECUTED_SUCCESSFULLY",
                                     "Timeline menjadwalkan slow motion, ramp, efek kontekstual, dan transisi.")

    return {"music": music_gate, "beat_sync": beat_gate, "visual_effects": effects_gate,
            "rife": rife_gate, "transitions": transition_gate, "source_replay": replay_gate,
            "editing_pipeline": editing_gate}


def _event_output_frame(clip: dict[str, Any], source_time_us: int) -> int:
    candidates = []
    for segment in clip.get("time_remap", []):
        start, end = segment["source_start_us"], segment["source_end_us"]
        if start <= source_time_us <= end:
            fraction = (source_time_us - start) / max(1, end - start)
            if segment.get("direction", "forward") == "reverse":
                fraction = 1.0 - fraction
            candidates.append(segment["output_start_frame"] + round(
                fraction * (segment["output_end_frame"] - segment["output_start_frame"])))
    return max(0, min(clip["duration_frames"] - 1, min(candidates) if candidates else 0))


def _count_frames(path: Path) -> int | None:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    args = [ffprobe, "-v", "error", "-select_streams", "v:0", "-count_frames",
            "-show_entries", "stream=nb_read_frames", "-of", "default=nokey=1:noprint_wrappers=1", str(path)]
    try:
        # Decode speed varies substantially across machines and codecs. Scale
        # the fallback budget with output size, with a bounded minimum/maximum.
        timeout = max(60, min(60 * 60, 30 + path.stat().st_size // (4 * 1024 * 1024)))
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
        return int(result.stdout.strip()) if result.returncode == 0 and result.stdout.strip().isdigit() else None
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None


def _audit_pts(path: Path, fps: int) -> dict[str, Any]:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return {"monotonic": False, "cfr": False, "frames": None, "max_delta_error_us": None}
    args = [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_frames",
            "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0", str(path)]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=60 * 60, check=False)
        timestamps = [float(line.split(",", 1)[0]) for line in result.stdout.splitlines() if line.strip()]
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return {"monotonic": False, "cfr": False, "frames": None, "max_delta_error_us": None}
    if result.returncode != 0 or len(timestamps) < 2:
        return {"monotonic": False, "cfr": False, "frames": len(timestamps), "max_delta_error_us": None}
    deltas = [right - left for left, right in zip(timestamps, timestamps[1:])]
    target = 1.0 / fps
    error_us = max(abs(delta - target) * 1_000_000 for delta in deltas)
    return {"monotonic": all(delta > 0 for delta in deltas), "cfr": error_us <= 2.5,
            "frames": len(timestamps), "max_delta_error_us": round(error_us, 3),
            "first_pts_s": timestamps[0], "last_pts_s": timestamps[-1]}


def _max_duplicate_run(path: Path) -> int | None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    args = [ffmpeg, "-hide_banner", "-v", "error", "-i", str(path), "-map", "0:v:0", "-f", "framemd5", "-"]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=60 * 60, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    hashes = []
    for line in result.stdout.splitlines():
        if not line or line.startswith("#"):
            continue
        fields = line.rsplit(",", 1)
        if len(fields) == 2:
            hashes.append(fields[-1].strip())
    if not hashes:
        return None
    longest = current = 1
    for previous, value in zip(hashes, hashes[1:]):
        current = current + 1 if value == previous else 1
        longest = max(longest, current)
    return longest


def _detect_intervals(
    path: Path, filter_name: str, pattern: str, *, audio: bool = False
) -> list[dict[str, float | None]] | None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    if audio:
        args = [ffmpeg, "-hide_banner", "-i", str(path), "-map", "0:a:0", "-af", filter_name,
                "-vn", "-f", "null", "-"]
    else:
        args = [ffmpeg, "-hide_banner", "-i", str(path), "-map", "0:v:0", "-vf", filter_name,
                "-an", "-f", "null", "-"]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=60 * 60, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    matches = re.finditer(pattern, result.stderr or "")
    intervals: list[dict[str, float | None]] = []
    for match in matches:
        start_text, end_text = match.groups()
        intervals.append({"start_s": float(start_text),
                          "end_s": float(end_text) if end_text is not None else None})
    return intervals


def _measure_peak(path: Path) -> float | None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    args = [ffmpeg, "-hide_banner", "-i", str(path), "-vn", "-af", "volumedetect", "-f", "null", "-"]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=60 * 60, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    match = re.search(r"max_volume:\s*(-?inf|-?[0-9.]+)\s*dB", result.stderr or "")
    if not match or match.group(1) == "-inf":
        return None
    return float(match.group(1))
