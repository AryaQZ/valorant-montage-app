"""Versioned local project model and strict timeline validation."""

from __future__ import annotations

from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path
from typing import Any
import json
import os
import re
import tempfile
import uuid

SCHEMA_VERSION = 2
PROFILES = {"master_144": 144, "youtube_60": 60, "preview_30": 30}
PROFILE_DIMENSIONS = {"master_144": (2560, 1440), "youtube_60": (2560, 1440), "preview_30": (1280, 720)}
EFFECT_TYPES = {"impact_zoom", "motion_blur", "screen_shake", "impact_flash"}


class ProjectValidationError(ValueError):
    """Raised when a project or timeline violates the v1 contract."""


def new_project(name: str = "Untitled Montage") -> dict[str, Any]:
    name = name.strip() or "Untitled Montage"
    return {
        "schema_version": SCHEMA_VERSION,
        "project_id": str(uuid.uuid4()),
        "name": name,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "settings": {
            "style": "smooth_clean",
            "beat_sync_priority": 0.75,
            "effects_intensity": 0.45,
            "output_profile": "master_144",
            "music_gain": 0.18,
            "gameplay_gain": 1.0,
        },
        "sources": [],
        "events": [],
        "timeline": [],
        "music": None,
        "director": {"mode": "rule_only", "last_proposal": None},
        "preferences": {"event_weights": {}, "ratings": []},
    }


def duration_to_frames(duration_us: int, fps: int) -> int:
    if type(duration_us) is not int or duration_us <= 0 or fps <= 0:
        raise ProjectValidationError("Durasi harus positif dan disimpan dalam microseconds integer.")
    return max(1, (duration_us * fps + 500_000) // 1_000_000)


def frames_to_duration_us(frames: int, fps: int) -> int:
    if type(frames) is not int or frames < 0 or fps <= 0:
        raise ProjectValidationError("Jumlah frame atau frame rate tidak valid.")
    return (frames * 1_000_000 + fps // 2) // fps


def _require_int(value: Any, field: str, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ProjectValidationError(f"{field} harus integer >= {minimum}.")
    return value


def _upgrade_project(project: dict[str, Any]) -> dict[str, Any]:
    """Migrate the original v1 contract in memory before validating imported projects."""
    if not isinstance(project, dict):
        raise ProjectValidationError("Project harus berupa object JSON.")
    if project.get("schema_version") == SCHEMA_VERSION:
        return project
    if project.get("schema_version") != 1:
        raise ProjectValidationError(f"Versi project tidak didukung: {project.get('schema_version')!r}.")
    import copy
    migrated = copy.deepcopy(project)
    migrated["schema_version"] = SCHEMA_VERSION
    settings = migrated.setdefault("settings", {})
    settings.setdefault("style", "smooth_clean")
    settings.setdefault("beat_sync_priority", 0.75)
    settings.setdefault("effects_intensity", 0.45)
    settings.setdefault("output_profile", "master_144")
    settings.setdefault("music_gain", 0.18)
    settings.setdefault("gameplay_gain", 1.0)
    for clip in migrated.get("timeline", []):
        if not isinstance(clip, dict):
            continue
        fps = PROFILES.get(settings.get("output_profile"), 144)
        frames = clip.get("duration_frames")
        if type(frames) is not int:
            frames = duration_to_frames(max(1, int(clip.get("out_us", 1)) - int(clip.get("in_us", 0))), fps)
            clip["duration_frames"] = frames
        if not clip.get("time_remap"):
            clip["time_remap"] = [{"output_start_frame": 0, "output_end_frame": frames,
                                    "source_start_us": clip.get("in_us", 0), "source_end_us": clip.get("out_us", 1),
                                    "speed_num": 1, "speed_den": 1, "direction": "forward"}]
        else:
            for segment in clip["time_remap"]:
                if isinstance(segment, dict):
                    segment.setdefault("direction", "forward")
        for effect in clip.get("effects", []):
            if isinstance(effect, dict) and effect.get("type") == "impact_zoom" and effect.get("anchor") == "center":
                effect["anchor"] = "impact"
        clip.setdefault("transitions", [])
        clip.setdefault("included_event_ids", [clip.get("event_id")])
    return migrated


def validate_project(project: dict[str, Any], *, require_timeline: bool = False) -> dict[str, Any]:
    project = _upgrade_project(project)
    if not isinstance(project, dict):
        raise ProjectValidationError("Project harus berupa object JSON.")
    if project.get("schema_version") != SCHEMA_VERSION:
        raise ProjectValidationError(f"Versi project tidak didukung: {project.get('schema_version')!r}.")
    if not isinstance(project.get("project_id"), str) or not re.fullmatch(r"[a-zA-Z0-9-]{8,80}", project["project_id"]):
        raise ProjectValidationError("project_id harus berisi 8-80 karakter huruf, angka, atau tanda hubung.")
    if not isinstance(project.get("name"), str) or not project["name"].strip():
        raise ProjectValidationError("Nama project wajib diisi.")
    if "reference_draft" in project and (
        not isinstance(project["reference_draft"], str) or not re.fullmatch("[a-f0-9]{32}", project["reference_draft"])
    ):
        raise ProjectValidationError("ID draft upstream tidak valid.")
    reference_video = project.get("reference_video")
    if reference_video is not None and (
        not isinstance(reference_video, dict)
        or not isinstance(reference_video.get("path"), str)
        or not reference_video["path"].strip()
        or not isinstance(reference_video.get("filename"), str)
        or not reference_video["filename"].strip()
    ):
        raise ProjectValidationError("Referensi gaya harus menautkan satu file video lokal.")
    settings = project.get("settings")
    if not isinstance(settings, dict):
        raise ProjectValidationError("settings wajib berupa object.")
    if settings.get("style") != "smooth_clean":
        raise ProjectValidationError("Style yang didukung saat ini adalah smooth_clean.")
    if settings.get("output_profile") not in PROFILES:
        raise ProjectValidationError("Output profile harus master_144 atau youtube_60.")
    for key in ("beat_sync_priority", "effects_intensity", "music_gain", "gameplay_gain"):
        value = settings.get(key, 0.0)
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 <= value <= 1.5:
            raise ProjectValidationError(f"settings.{key} harus nilai dalam rentang 0..1.5.")

    sources = project.get("sources")
    events = project.get("events")
    timeline = project.get("timeline")
    if not isinstance(sources, list) or not isinstance(events, list) or not isinstance(timeline, list):
        raise ProjectValidationError("sources, events, dan timeline harus berupa array.")
    if require_timeline and not timeline:
        raise ProjectValidationError("Timeline kosong. Tambahkan setidaknya satu highlight.")

    source_by_id: dict[str, dict[str, Any]] = {}
    for source in sources:
        if not isinstance(source, dict) or not isinstance(source.get("media_id"), str):
            raise ProjectValidationError("Setiap source harus memiliki media_id.")
        media_id = source["media_id"]
        if media_id in source_by_id:
            raise ProjectValidationError(f"media_id duplikat: {media_id}.")
        if not isinstance(source.get("path"), str) or not source["path"]:
            raise ProjectValidationError(f"Source {media_id} tidak memiliki path.")
        duration_us = source.get("duration_us")
        if duration_us is not None:
            _require_int(duration_us, f"source {media_id}.duration_us", 1)
        source_by_id[media_id] = source

    dismissed = project.get("dismissed_kill_candidates", [])
    if not isinstance(dismissed, list):
        raise ProjectValidationError("Kandidat kill yang diabaikan harus berupa array.")
    for item in dismissed:
        if not isinstance(item, dict) or not isinstance(item.get("source_media_id"), str) or item["source_media_id"] not in source_by_id:
            raise ProjectValidationError("Kandidat kill yang diabaikan merujuk ke rekaman yang tidak dikenal.")
        _require_int(item.get("source_time_us"), "Waktu kandidat kill yang diabaikan")
        _require_int(item.get("source_frame"), "Frame kandidat kill yang diabaikan")

    event_by_id: dict[str, dict[str, Any]] = {}
    for event in events:
        if not isinstance(event, dict) or not isinstance(event.get("event_id"), str):
            raise ProjectValidationError("Setiap event harus memiliki event_id.")
        event_id = event["event_id"]
        if event_id in event_by_id:
            raise ProjectValidationError(f"event_id duplikat: {event_id}.")
        media_id = event.get("source_media_id")
        if media_id not in source_by_id:
            raise ProjectValidationError(f"Event {event_id} mengarah ke source yang tidak dikenal.")
        start_us = _require_int(event.get("in_us"), f"event {event_id}.in_us")
        impact_us = _require_int(event.get("source_time_us"), f"event {event_id}.source_time_us")
        end_us = _require_int(event.get("out_us"), f"event {event_id}.out_us")
        if not start_us < end_us or not start_us <= impact_us <= end_us:
            raise ProjectValidationError(f"Range event {event_id} tidak valid: in <= impact <= out.")
        source_duration = source_by_id[media_id].get("duration_us")
        if source_duration is not None and end_us > source_duration:
            raise ProjectValidationError(f"Event {event_id} melewati durasi source.")
        confidence = event.get("confidence")
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= confidence <= 1:
            raise ProjectValidationError(f"Confidence event {event_id} harus dalam rentang 0..1.")
        if event.get("owner") not in {"player", "unknown"}:
            raise ProjectValidationError(f"Owner event {event_id} harus player atau unknown.")
        if not isinstance(event.get("tags", []), list) or not isinstance(event.get("is_user_override"), bool):
            raise ProjectValidationError(f"Tag atau flag user override event {event_id} tidak valid.")
        event_by_id[event_id] = event

    fps = PROFILES[settings["output_profile"]]
    clip_ids: set[str] = set()
    running_frames = 0
    for clip in timeline:
        if not isinstance(clip, dict):
            raise ProjectValidationError("Setiap clip timeline harus berupa object.")
        clip_id = clip.get("clip_id")
        if not isinstance(clip_id, str) or not clip_id or clip_id in clip_ids:
            raise ProjectValidationError("clip_id timeline kosong atau duplikat.")
        clip_ids.add(clip_id)
        event = event_by_id.get(clip.get("event_id"))
        if event is None:
            raise ProjectValidationError(f"Clip {clip_id} merujuk ke event yang tidak dikenal.")
        if clip.get("source_media_id") != event["source_media_id"]:
            raise ProjectValidationError(f"Source clip {clip_id} tidak cocok dengan event.")
        start_us = _require_int(clip.get("in_us"), f"clip {clip_id}.in_us")
        end_us = _require_int(clip.get("out_us"), f"clip {clip_id}.out_us")
        source = source_by_id[clip["source_media_id"]]
        if not start_us < end_us or start_us < event["in_us"] or end_us > event["out_us"]:
            raise ProjectValidationError(f"Trim clip {clip_id} berada di luar event yang dipilih.")
        if source.get("duration_us") is not None and end_us > source["duration_us"]:
            raise ProjectValidationError(f"Trim clip {clip_id} melewati source.")
        included_event_ids = clip.setdefault("included_event_ids", [event["event_id"]])
        if (not isinstance(included_event_ids, list) or not included_event_ids
                or any(not isinstance(item, str) for item in included_event_ids)
                or len(set(included_event_ids)) != len(included_event_ids)
                or event["event_id"] not in included_event_ids):
            raise ProjectValidationError(f"included_event_ids pada clip {clip_id} tidak valid.")
        for included_event_id in included_event_ids:
            included = event_by_id.get(included_event_id)
            if included is None:
                raise ProjectValidationError(f"Clip {clip_id} merujuk ke included event yang tidak dikenal.")
            if included["source_media_id"] != clip["source_media_id"]:
                raise ProjectValidationError(f"Included event {included_event_id} berasal dari source berbeda.")
            if not start_us <= included["source_time_us"] <= end_us:
                raise ProjectValidationError(f"Impact included event {included_event_id} tidak terlihat dalam clip {clip_id}.")
        if clip.get("output_start_frame") != running_frames:
            raise ProjectValidationError("Clip harus berurutan dan tidak saling tumpang tindih.")
        effects = clip.get("effects", [])
        if not isinstance(effects, list):
            raise ProjectValidationError(f"effects pada clip {clip_id} harus array.")
        for effect in effects:
            if not isinstance(effect, dict) or effect.get("type") not in EFFECT_TYPES:
                raise ProjectValidationError(f"Jenis effect pada clip {clip_id} tidak didukung.")
            kind = effect["type"]
            if kind == "impact_zoom":
                value = effect.get("max_zoom")
                if not _bounded_number(value, 1.0, 1.08):
                    raise ProjectValidationError(f"Parameter impact_zoom clip {clip_id} di luar batas.")
                _require_int(effect.get("duration_frames"), f"effect {kind}.duration_frames", 1)
                if effect.get("anchor") != "impact" or not isinstance(effect.get("enabled"), bool):
                    raise ProjectValidationError(f"Konfigurasi impact_zoom clip {clip_id} tidak valid.")
                keyframes = effect.get("keyframes")
                if keyframes is not None:
                    if not isinstance(keyframes, list) or not 2 <= len(keyframes) <= 8:
                        raise ProjectValidationError(f"Keyframe impact_zoom clip {clip_id} harus berisi 2-8 titik.")
                    previous_offset: int | None = None
                    has_impact_key = False
                    for keyframe in keyframes:
                        if not isinstance(keyframe, dict) or type(keyframe.get("frame_offset")) is not int:
                            raise ProjectValidationError(f"Keyframe impact_zoom clip {clip_id} tidak valid.")
                        offset = keyframe["frame_offset"]
                        if abs(offset) > effect["duration_frames"]:
                            raise ProjectValidationError(f"Keyframe impact_zoom clip {clip_id} melewati durasi efek.")
                        if previous_offset is not None and offset <= previous_offset:
                            raise ProjectValidationError(f"Keyframe impact_zoom clip {clip_id} harus terurut.")
                        if not _bounded_number(keyframe.get("scale"), 1.0, value):
                            raise ProjectValidationError(f"Scale keyframe impact_zoom clip {clip_id} di luar batas.")
                        has_impact_key = has_impact_key or offset == 0
                        previous_offset = offset
                    if not has_impact_key:
                        raise ProjectValidationError(f"Keyframe impact_zoom clip {clip_id} harus memiliki anchor pada impact.")
            elif kind == "motion_blur":
                if not _bounded_number(effect.get("strength"), 0.0, 0.65):
                    raise ProjectValidationError(f"Parameter motion_blur clip {clip_id} di luar batas.")
                if effect.get("window_frames") not in {3, 5} or not isinstance(effect.get("enabled"), bool):
                    raise ProjectValidationError(f"Konfigurasi motion_blur clip {clip_id} tidak valid.")
            elif kind == "screen_shake":
                if not _bounded_number(effect.get("amplitude_px"), 0.0, 18.0):
                    raise ProjectValidationError(f"Parameter screen_shake clip {clip_id} di luar batas.")
                _require_int(effect.get("duration_frames"), f"effect {kind}.duration_frames", 1)
                if not isinstance(effect.get("enabled"), bool):
                    raise ProjectValidationError(f"Konfigurasi screen_shake clip {clip_id} tidak valid.")
            elif kind == "impact_flash":
                if not _bounded_number(effect.get("intensity"), 0.0, 0.45):
                    raise ProjectValidationError(f"Parameter impact_flash clip {clip_id} di luar batas.")
                _require_int(effect.get("duration_frames"), f"effect {kind}.duration_frames", 1)
                if not isinstance(effect.get("enabled"), bool):
                    raise ProjectValidationError(f"Konfigurasi impact_flash clip {clip_id} tidak valid.")
        transitions = clip.get("transitions", [])
        if not isinstance(transitions, list):
            raise ProjectValidationError(f"transitions pada clip {clip_id} harus array.")
        for transition in transitions:
            if (not isinstance(transition, dict) or transition.get("type") != "dip_to_black"
                    or not isinstance(transition.get("enabled"), bool)):
                raise ProjectValidationError(f"Transition pada clip {clip_id} tidak didukung.")
            duration = _require_int(transition.get("duration_frames"), f"transition {clip_id}.duration_frames", 1)
            if duration > 24:
                raise ProjectValidationError(f"Transition clip {clip_id} terlalu panjang.")
        duration_frames = _validate_speed_segments(clip, start_us, end_us)
        if clip.get("duration_frames") != duration_frames:
            raise ProjectValidationError(f"Jumlah frame clip {clip_id} tidak cocok dengan time_remap.")
        running_frames += duration_frames

    music = project.get("music")
    if music is not None:
        if not isinstance(music, dict) or not isinstance(music.get("path"), str):
            raise ProjectValidationError("music harus null atau object dengan path.")
        if music.get("beat_grid", []) and not isinstance(music["beat_grid"], list):
            raise ProjectValidationError("music.beat_grid harus berupa array.")
    return project


def _bounded_number(value: Any, low: float, high: float) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and low <= value <= high


def _validate_speed_segments(clip: dict[str, Any], start_us: int, end_us: int) -> int:
    segments = clip.get("time_remap", [{"output_start_frame": 0, "output_end_frame": clip.get("duration_frames", 1),
                                         "source_start_us": start_us, "source_end_us": end_us,
                                         "speed_num": 1, "speed_den": 1, "direction": "forward"}])
    if not isinstance(segments, list) or not segments:
        raise ProjectValidationError("time_remap harus memiliki setidaknya satu segmen.")
    previous_out = 0
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            raise ProjectValidationError("Setiap time_remap segment harus berupa object.")
        out_start = _require_int(segment.get("output_start_frame"), f"time_remap[{index}].output_start_frame")
        out_end = _require_int(segment.get("output_end_frame"), f"time_remap[{index}].output_end_frame")
        src_start = _require_int(segment.get("source_start_us"), f"time_remap[{index}].source_start_us")
        src_end = _require_int(segment.get("source_end_us"), f"time_remap[{index}].source_end_us")
        speed_num = _require_int(segment.get("speed_num"), f"time_remap[{index}].speed_num", 1)
        speed_den = _require_int(segment.get("speed_den"), f"time_remap[{index}].speed_den", 1)
        if out_start != previous_out or out_end <= out_start or src_start < start_us or src_end > end_us or src_end <= src_start:
            raise ProjectValidationError(f"time_remap[{index}] tidak berurutan atau keluar dari source range.")
        ratio = Fraction(speed_num, speed_den)
        if ratio < Fraction(1, 4) or ratio > 4:
            raise ProjectValidationError("Speed remap harus berada antara 0.25x dan 4x.")
        if segment.get("direction", "forward") not in {"forward", "reverse"}:
            raise ProjectValidationError(f"time_remap[{index}].direction harus forward atau reverse.")
        previous_out = out_end
    if previous_out != clip.get("duration_frames"):
        raise ProjectValidationError("time_remap harus menutup seluruh frame clip tanpa gap.")
    return previous_out


def add_timeline_clip(project: dict[str, Any], event_id: str, *, in_us: int | None = None,
                      out_us: int | None = None) -> dict[str, Any]:
    validate_project(project)
    event = next((item for item in project["events"] if item["event_id"] == event_id), None)
    if event is None:
        raise ProjectValidationError(f"Event tidak ditemukan: {event_id}.")
    start_us = event["in_us"] if in_us is None else in_us
    end_us = event["out_us"] if out_us is None else out_us
    fps = PROFILES[project["settings"]["output_profile"]]
    duration_frames = duration_to_frames(end_us - start_us, fps)
    previous_frames = sum(clip["duration_frames"] for clip in project["timeline"])
    intensity = float(project["settings"].get("effects_intensity", 0.45))
    effect_list: list[dict[str, Any]] = []
    if intensity > 0:
        peak = round(min(1.08, 1 + 0.08 * intensity), 4)
        effect_list.append({"type": "impact_zoom", "max_zoom": peak,
                            "duration_frames": 24, "anchor": "impact", "enabled": True,
                            "keyframes": [{"frame_offset": -12, "scale": 1.0},
                                          {"frame_offset": 0, "scale": peak},
                                          {"frame_offset": 12, "scale": 1.0}]})
        if "headshot" in event.get("tags", []) or "multikill" in event.get("tags", []):
            effect_list.append({"type": "impact_flash", "intensity": round(0.22 * intensity, 3),
                                "duration_frames": 3, "enabled": True})
        if "multikill" in event.get("tags", []) and event.get("confidence", 0.0) >= 0.8:
            effect_list.append({"type": "screen_shake", "amplitude_px": round(8.0 * intensity, 2),
                                "duration_frames": 12, "enabled": True})
            effect_list.append({"type": "motion_blur", "strength": round(0.25 * intensity, 3),
                                "window_frames": 3, "enabled": True})
    clip = {
        "clip_id": str(uuid.uuid4()),
        "event_id": event_id,
        "included_event_ids": [event_id],
        "source_media_id": event["source_media_id"],
        "in_us": start_us,
        "out_us": end_us,
        "output_start_frame": previous_frames,
        "duration_frames": duration_frames,
        "time_remap": [{"output_start_frame": 0, "output_end_frame": duration_frames,
                        "source_start_us": start_us, "source_end_us": end_us,
                        "speed_num": 1, "speed_den": 1, "direction": "forward"}],
        "effects": effect_list,
        "transitions": [],
        "audio_gain": float(project["settings"].get("gameplay_gain", 1.0)),
    }
    project["timeline"].append(clip)
    validate_project(project)
    return clip


def normalize_timeline(project: dict[str, Any]) -> None:
    fps = PROFILES[project["settings"]["output_profile"]]
    offset = 0
    for clip in project["timeline"]:
        segments = clip.get("time_remap") or [{"source_start_us": clip["in_us"], "source_end_us": clip["out_us"],
                                               "speed_num": 1, "speed_den": 1, "direction": "forward"}]
        cursor = 0
        for segment in segments:
            segment["direction"] = segment.get("direction", "forward")
            span = segment["source_end_us"] - segment["source_start_us"]
            speed = Fraction(segment["speed_num"], segment["speed_den"])
            count = duration_to_frames(round(span * speed.denominator / speed.numerator), fps)
            segment["output_start_frame"] = cursor
            segment["output_end_frame"] = cursor + count
            cursor += count
        clip["output_start_frame"] = offset
        clip["duration_frames"] = cursor
        clip["time_remap"] = segments
        offset += cursor
    validate_project(project)


def save_project(project: dict[str, Any], path: str | Path) -> None:
    project = validate_project(project)
    destination = Path(path).expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=destination.parent,
                                         prefix=f".{destination.name}.", suffix=".tmp", delete=False) as handle:
            temp_path = Path(handle.name)
            json.dump(project, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, destination)
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


def load_project(path: str | Path) -> dict[str, Any]:
    source = Path(path).expanduser().resolve(strict=True)
    with source.open("r", encoding="utf-8") as handle:
        project = json.load(handle)
    return validate_project(project)


def score_event(event: dict[str, Any], weights: dict[str, float] | None = None) -> float:
    """Explainable manual-event ranking; this is not an automatic kill detector."""
    weights = weights or {"headshot": 1.0, "multikill": 1.8, "clutch": 1.3,
                          "round_win": 0.7, "clean_audio": 0.3}
    tags = set(event.get("tags", []))
    score = float(event.get("confidence", 0.0))
    score += sum(float(weights.get(tag, 0.0)) for tag in tags)
    if event.get("owner") == "unknown":
        score -= 1.0
    if event.get("is_user_override"):
        score += 0.25
    return round(score, 3)
