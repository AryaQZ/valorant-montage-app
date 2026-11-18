"""Windows orchestration for the pinned, native upstream montage pipeline."""

from __future__ import annotations

from pathlib import Path
from typing import Any
import hashlib
import html
import json
import math
import os
import re
import shutil
import uuid

from .media import MediaToolError, app_data_dir, probe_audio, probe_media
from .schema import validate_project
from .upstream import (UPSTREAM_COMMIT, UPSTREAM_SCRIPTS, _count_video_frames,
                       _run_upstream_cancellable, detect_kills, upstream_python)


def _write(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _fingerprint(project: dict, *, native_style: bool = False) -> str:
    # UI-only attributes do not affect the render. Editing the set/order of
    # inputs, song, or timeline requires another planning pass.
    data = {key: project.get(key) for key in ("project_id", "events", "timeline", "music")}
    data["sources"] = [(s["media_id"], s["path"]) for s in project["sources"]]
    if native_style:
        data["reference_video"] = project.get("reference_video")
        data["mix_settings"] = {key: project["settings"].get(key, default) for key, default in (
            ("effects_intensity", 0.45), ("music_gain", 0.18), ("gameplay_gain", 1.0))}
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _media_stamp(path: str) -> list:
    resolved = Path(path).resolve(strict=True)
    stat = resolved.stat()
    return [str(resolved), stat.st_size, stat.st_mtime_ns]


def _stage_scripts(work: Path) -> None:
    # Reference scripts override like-named common scripts, as prescribed
    # by upstream's reference-style workspace setup.
    for base in (UPSTREAM_SCRIPTS, UPSTREAM_SCRIPTS / "refstyle"):
        for script in base.glob("*.py"):
            shutil.copy2(script, work / script.name)
    shutil.copytree(UPSTREAM_SCRIPTS / "games", work / "games")
    shutil.copy2(Path(__file__).with_name("native_edit.py"), work / "vms_edit.py")


def _confirmed_events(project: dict) -> list[dict]:
    included = [
        event_id for clip in project["timeline"]
        for event_id in (clip.get("included_event_ids") or [clip["event_id"]])
    ]
    by_id = {e["event_id"]: e for e in project["events"]}
    selected = [by_id[key] for key in dict.fromkeys(included)] if included else project["events"]
    return [event for event in selected if event["owner"] == "player" and _evidence(event)]


def _evidence(event: dict) -> dict | None:
    evidence = event.get("evidence")
    if not isinstance(evidence, list):
        return None
    return next((item for item in evidence if isinstance(item, dict)
                 and item.get("upstream_commit") == UPSTREAM_COMMIT
                 and item.get("upstream_verified") is True and type(item.get("working_frame_60")) is int
                 and item["working_frame_60"] >= 0 and item.get("shot_method") in {"ammo", "flash"}
                 and not item.get("hidden") and not item.get("no_shot")), None)


def _select_events(project: dict, notices: list[str] | None = None) -> list[dict]:
    if project["events"]:
        selected = _confirmed_events(project)
        if notices is not None:
            ids = {key for clip in project["timeline"]
                   for key in (clip.get("included_event_ids") or [clip["event_id"]])}
            requested = ids or {event["event_id"] for event in project["events"]}
            if len(selected) != len(requested):
                raise MediaToolError(
                    "Beberapa highlight belum punya bukti frame kill terverifikasi. "
                    "Tinjau Find kills dan susun pilihan native, atau gunakan ekspor timeline manual."
                )
        return selected
    selected = []
    unresolved = 0
    for source in project["sources"]:
        result = detect_kills(source["path"], source["media_id"], source.get("duration_us"))
        if any(event.get("requires_ownership_review") and _evidence(event) for event in result["candidates"]):
            raise MediaToolError("Replay memiliki kandidat dengan bukti tembakan tanpa penanda pemain. Gunakan Find kills, tinjau feed, lalu konfirmasi kill milik pemain sebelum Generate draft.")
        verified = [event for event in result["candidates"] if _evidence(event)]
        selected.extend(verified)
        unresolved += len(result["candidates"]) - len(verified)
    if notices is not None:
        notices.append("Deteksi otomatis adalah daftar kandidat. Tinjau kepemilikan dan cakupan setiap rekaman.")
        if unresolved:
            notices.append(f"{unresolved} kandidat belum punya frame impact terverifikasi. Tinjau Find kills.")

    def rank(event: dict) -> tuple:
        score = (_evidence(event).get("kill_rank") or {}).get("score")
        return (score if isinstance(score, (float, int)) else 0, event["confidence"])
    best = _deduplicate(sorted(selected, key=rank, reverse=True))
    import_order = {source["media_id"]: index for index, source in enumerate(project["sources"])}
    return sorted(best, key=lambda event: (import_order[event["source_media_id"]], event["source_time_us"]))


def _deduplicate(events: list[dict]) -> list[dict]:
    def feed_frame(event: dict) -> int | None:
        frame = _evidence(event).get("feed_frame")
        return frame if type(frame) is int else None

    unique: list[dict] = []
    for event in events:
        frame = _evidence(event)["working_frame_60"]
        feed = feed_frame(event)
        if any(other["source_media_id"] == event["source_media_id"]
               and abs(_evidence(other)["working_frame_60"] - frame) <= 6
               and (feed is None or feed_frame(other) is None
                    or abs(feed_frame(other) - feed) <= 3) for other in unique):
            continue
        unique.append(event)
    return unique


def _kill_record(event: dict, alias: str) -> dict:
    evidence = _evidence(event)
    verification = evidence.get("shot_verification")
    record = {"clip": alias, "K": evidence["working_frame_60"], "game": "valorant",
              "how": evidence["shot_method"], "verified": True,
              "kverify": verification.get("verdict") if isinstance(verification, dict) else None}
    for key, value in (("feed", evidence.get("feed_frame")), ("conf", evidence.get("confidence_label")),
                       ("method", event.get("method", evidence.get("shot_method")))):
        if value is not None:
            record[key] = value
    return record


def _stage_media(work: Path, aliases: dict[str, str], stamp_by_alias: dict[str, list]) -> None:
    ingest = {}
    (work / "src").mkdir()
    (work / "pts").mkdir()
    for alias, path in aliases.items():
        original, size, mtime = stamp_by_alias[alias]
        key = hashlib.sha256(f"{original}|{size}|{mtime}".encode("utf-8")).hexdigest()[:24]
        cache = app_data_dir() / "upstream" / key
        try:
            row = _read(cache / "src" / "ingest.json")["c1"]
            cached = next((cache / "src").glob("c1.*"))
            pts = cache / "pts" / "c1.csv"
            if row["method"] not in {"exact", "copied", "remuxed"} or not pts.is_file():
                continue
            if Path(row["original"]).resolve() != Path(path) or row["size"] != size:
                continue
        except (OSError, ValueError, KeyError, StopIteration):
            continue
        target = work / "src" / (alias + cached.suffix)
        try:
            os.link(cached, target)
        except OSError:
            shutil.copyfile(cached, target)
        shutil.copyfile(pts, work / "pts" / (alias + ".csv"))
        ingest[alias] = row
    _write(work / "src" / "ingest.json", ingest)


def _music_plan(work: Path, stage, music: dict, length: float) -> dict:
    tempo = stage("music_tempo.py", "src/music.flac")
    match = re.search(r"best fit: (\d+(?:\.\d+)?) bpm, first beat at (\d+(?:\.\d+)?) s", tempo)
    if not match:
        raise MediaToolError("Upstream tidak dapat mengukur BPM dan beat pertama lagu.")
    bpm, beat0 = map(float, match.groups())
    grid = stage("music_grid.py", str(bpm), str(beat0), "src/music.flac", allow_nonzero=True)
    measured = re.search(r"=> (?:BPM = ([\d.]+)\s+)?BEAT0 = ([\d.]+)", grid)
    if measured:
        bpm = float(measured[1] or bpm)
        beat0 = float(measured[2])
    period = 60 / bpm
    duration = probe_audio(str(work / "src" / "music.flac"))["duration_us"] / 1_000_000
    if duration < length:
        raise MediaToolError("Lagu tidak cukup panjang untuk montage upstream.")
    offset = music.get("offset_us", 0) / 1_000_000
    candidates = [int(beat) for beat in re.findall(r"^\s+beat\s+(\d+)\s+[\d.]+s\s+after", tempo, re.M)]
    candidates = [beat for beat in candidates if 1.5 <= beat0 + beat * period <= duration - length]
    drop = round((offset + 1.5 - beat0) / period) if offset else (candidates[0] if candidates else round((1.5 - beat0) / period))
    return {"music": "src/music.flac", "bpm": bpm, "beat0": beat0, "drop_beat": max(1, drop)}


def _snapshot(work: Path, python: str) -> dict:
    # Only the worker writes this module, via pinned upstream scripts.
    script = work / "vms_snapshot.py"
    script.write_text(
        'import json, clipio, timeline as t\n'
        'ingest = json.load(open("src/ingest.json", encoding="utf-8"))\n'
        'us = lambda seconds: round(seconds * 1000000)\n'
        'frame = t.nearest_frame\n'
        'source = lambda s, k: us(float(clipio.n2t(s["clip"], s["map"](k)[0])) + ingest[s["clip"]].get("t0", 0))\n'
        'takes = [{"source_alias": s["clip"], "start_frame": frame(s["a"][0][0]),\n'
        '          "end_frame": frame(s["a"][-1][0]), "transition": s["tin"][0],\n'
        '          "impacts": [{"shot_frame": frame(k), "beat_time_us": us((h-t.R0)*t.PER),\n'
        '                       "track_time_us": us(t.beat_time(h)),\n'
        '                       "working_frame_60": round(float(s["map"](k)[0])),\n'
        '                       "setup_frame": max(frame(s["a"][0][0]), frame(k)-24),\n'
        '                       "confirmation_frame": min(t.N_FRAMES-1, frame(s["a"][-1][0])-1, frame(k)+21),\n'
        '                       "source_time_us": source(s, k)}\n'
        '                      for (k, _), h in zip(s["kills"], s["hits"])],\n'
        '          "anchors": [{"output_frame": frame(a[0]), "source_us": us(a[1]/60)} for a in s["a"]]}\n'
        '         for s in t.SEGS]\n'
        'json.dump({"frames": t.N_FRAMES, "fps": t.FPS, "music_offset_us": us(t.MUSIC_T0),\n'
        '           "takes": takes}, open("summary.json", "w"))\n',
        encoding="utf-8",
    )
    _run_upstream_cancellable(python, script, [], work, 60)
    return _read(work / "summary.json")


def _style_configuration(project: dict, reference_info: dict | None) -> dict:
    settings = project["settings"]
    strength = min(1.35, settings.get("effects_intensity", 0.45) / 0.45)
    music_gain = math.sqrt(settings.get("music_gain", 0.18) / 0.18)
    game_gain = settings.get("gameplay_gain", 1.0)
    return {
        "prefer_roll": bool(reference_info and reference_info["roll_share"] >= 0.18),
        "music_level": 0.84 * music_gain,
        "GAME_LEVEL": 0.95 * game_gain,
        "HEADROOM": 0.5 / max(1.0, music_gain, game_gain),
        "KILL_THUMP": 0.12 * game_gain,
        "look": {
            "vignette": 0.35, "saturation": 1.08, "contrast": 1.05, "grain": 0,
            "bloom": 0.55 * strength, "shake": 0.55 * strength, "flash": 0.55 * strength,
            "fringe": 0.25 * strength, "impact": False, "exposure": 1.0,
            "kill_zoom": strength, "blur_in": strength, "wide_glow": 0.25 * strength,
        },
    }


def _style_reference(work: Path, stage, path: str) -> dict:
    directory = work / "reference-analysis"
    stage("ref_analyze.py", path, "--out", str(directory), "--no-sheets", "--max-seconds", "150")
    data = _read(directory / "ref_notes.json")
    adopt = data.get("adopt") or {}
    transitions = adopt.get("transitions") or {}
    ending = adopt.get("ending") or {}
    # The reference is a visual hint. Its audio, beat grid and cut count do not
    # replace the song and actions already selected for the user's project.
    return {"filename": Path(path).name,
            "duration_s": round(data["analysed_seconds"], 2),
            "roll_share": max(0.0, min(1.0, float(transitions.get("roll", 0.0)))),
            "fade_s": max(0.16, min(0.6, float(ending.get("fade_s") or 0.27)))}


def _keep_chain(kills: list[dict]) -> bool:
    found = False
    for left, right in zip(kills, kills[1:]):
        if right.get("with_previous") or (
            left["clip"] == right["clip"] and 0 < right["K"] - left["K"] <= 56
        ):
            right["with_previous"] = True
            found = True
    return found


def _plan_native_style(work: Path, stage, plan: dict, music: dict, preserve_chain: bool,
                       min_final_interval: float = 0) -> dict:
    path = work / "plan.json"
    offset = music.get("offset_us", 0) / 1e6
    options = []
    if not preserve_chain:
        _write(work / "beat-search.json", {**plan, "count": len(plan["kills"]),
                                          "earliest_drop": max(1.4, offset + 1.4)})
        stage("vms_edit.py", "beats", "beat-search.json", "beat-options.json")
        options = _read(work / "beat-options.json")
    options = [option for option in options if option["step"] * 60 / plan["bpm"] >= min_final_interval]
    for option in options[:5]:
        interval = option["step"] * 60 / plan["bpm"]
        measured = {**plan, "drop_beat": option["drop_beat"],
                    "length": max(7.0, 4.02 + interval * (len(plan["kills"]) - 1)),
                    "kills": [{**item, "at": number * option["step"], **({"bullet": True} if number == 0 else {})}
                              for number, item in enumerate(plan["kills"])]}
        _write(path, measured)
        candidate = work / "vms_candidate.py"
        stage("draft_ref_timeline.py", "plan.json", "-o", candidate.name, allow_nonzero=True)
        if not candidate.is_file():
            continue
        candidate.replace(work / "timeline.py")
        stage("vms_edit.py", "inspect", "measured-matches.json")
        actual = _read(work / "measured-matches.json")
        if len(actual) == len(option["attack_us"]) and all(
            row and row["kind"] == option["drum"] and abs(row["song_time_us"] - expected) <= 8_400
            for row, expected in zip(actual, option["attack_us"])
        ):
            return {"mode": "regular_drums", "drum": option["drum"],
                    "beat_spacing": option["step"]}
    _write(path, plan)
    stage("draft_ref_timeline.py", "plan.json", "--force")
    stage("vms_edit.py", "inspect", "measured-matches.json")
    return {"mode": "measured_attacks",
            "reason": "continuous_engagement" if preserve_chain else "no_audible_regular_run"}


def _check_impacts(summary: dict, kills: list[dict], measured: list) -> int:
    actual = []
    frames = []
    index = 0
    groups = []
    for group, take in enumerate(summary["takes"]):
        for hit in take["impacts"]:
            actual.append((take["source_alias"], hit["working_frame_60"]))
            frames.append(hit["shot_frame"])
            groups.append(group)
            hit["beat_number"] = index + 1
            hit["attack"] = measured[index] if index < len(measured) else None
            index += 1
    if actual != [(kill["clip"], kill["K"]) for kill in kills] or frames != sorted(set(frames)):
        raise MediaToolError("Draft tidak mempertahankan semua impact terpilih dalam urutan yang sama.")
    if any(kill.get("with_previous") and groups[i] != groups[i - 1]
           for i, kill in enumerate(kills) if i):
        raise MediaToolError("Draft memisah rangkaian kill yang harus utuh. Tinjau pilihan musik dan highlight.")
    return sum(hit is not None for hit in measured)



def _ace_confirmation(events: list[dict], project: dict) -> dict | None:
    confirmed = []
    durations = {source["media_id"]: source["duration_us"] for source in project["sources"]}
    for index, event in enumerate(events):
        notes = [row for row in event.get("evidence", []) if isinstance(row, dict)
                 and row.get("type") == "reviewed_ace_banner"]
        if not notes:
            continue
        time = notes[-1].get("source_time_us")
        if type(time) is not int or not event["source_time_us"] < time < durations[event["source_media_id"]]:
            raise MediaToolError("Titik ACE harus berada setelah impact dan di dalam rekaman yang sama.")
        if index != len(events) - 1:
            raise MediaToolError("Letakkan kill dengan konfirmasi ACE terakhir dalam pilihan draft.")
        confirmed.append({"source_time_us": time, "kind": "ace"})
    return confirmed[0] if confirmed else None



def _ending_action(events: list[dict], ace: dict | None) -> dict | None:
    for event in events[:-1]:
        if any(isinstance(row, dict) and row.get("type") == "reviewed_final_action"
               for row in event.get("evidence", [])):
            raise MediaToolError("Letakkan kill dengan awal aksi yang ditandai terakhir dalam draft.")
    event = events[-1]
    marks = [row for row in event.get("evidence", []) if isinstance(row, dict)
             and row.get("type") == "reviewed_final_action"]
    time = marks[-1].get("source_time_us") if marks else None
    if marks and (type(time) is not int or not 0 <= time < event["source_time_us"]):
        raise MediaToolError("Awal aksi harus berada sebelum impact di rekaman yang sama.")
    if not marks and not ace:
        return None
    lead = (event["source_time_us"] - time) / 1e6 if marks else 1.2
    return {"source_time_us": time, "min_interval_s": lead + 0.66}


def create_reference_draft(project: dict) -> dict:
    project = validate_project(project)
    music = project.get("music")
    if not music:
        raise MediaToolError("Impor lagu sebelum membuat draft upstream untuk beat sync.")
    python = upstream_python(require_rife=True)
    if not python:
        raise MediaToolError("Jalankan scripts/setup-upstream.ps1 untuk mengaktifkan upstream dan RIFE.")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise MediaToolError("FFmpeg dan FFprobe dibutuhkan untuk membuat draft upstream.")
    notices: list[str] = []
    selected = _select_events(project, notices)
    events = _deduplicate(selected)
    if len(events) < len(selected):
        notices.append("Anotasi duplikat pada frame dan baris feed yang sama digabung.")
    if len(events) < 2:
        raise MediaToolError("Planner upstream memerlukan minimal dua tembakan terverifikasi. Tinjau kandidat Find kills atau impor rekaman tambahan.")
    ace = _ace_confirmation(events, project)
    action = _ending_action(events, ace)
    plan_id = uuid.uuid4().hex
    work = app_data_dir() / "reference-drafts" / plan_id
    work.mkdir(parents=True)
    try:
        _stage_scripts(work)
        sources = {source["media_id"]: source["path"] for source in project["sources"]}
        ids = dict.fromkeys(event["source_media_id"] for event in events)
        alias_by_id = {key: f"c{index}" for index, key in enumerate(ids, 1)}
        clips = {alias: str(Path(sources[key]).resolve(strict=True)) for key, alias in alias_by_id.items()}
        stamps = {alias: _media_stamp(path) for alias, path in clips.items()}
        stamps["music"] = _media_stamp(music["path"])
        reference_info = None
        reference_video = project.get("reference_video")
        if reference_video:
            video = probe_media(reference_video["path"], sample_vfr=False)
            stamps["reference"] = _media_stamp(video["path"])
        _stage_media(work, clips, stamps)
        _write(work / "clips.json", {**clips, "music": stamps["music"][0]})

        def stage(name, *args, allow_nonzero=False):
            return _run_upstream_cancellable(python, work / name, list(args), work, 3600, allow_nonzero=allow_nonzero)

        stage("ingest.py", "--exact", "--aspect", "pad")
        stage("mkpts.py")
        if reference_video:
            reference_info = _style_reference(work, stage, stamps["reference"][0])
        config = _style_configuration(project, reference_info)
        config["keep_final_action_clear"] = bool(action)
        _write(work / "vms-style.json", config)
        _write(work / "vms-ending.json", {"adopt": {
            "ending": {"fade_s": reference_info["fade_s"] if reference_info else 0.27, "black_s": 0.25}
        }})
        grouped = {key for clip in project["timeline"]
                   for key in (clip.get("included_event_ids") or [clip["event_id"]])[1:]}
        kills = []
        kill_db = {}
        for index, event in enumerate(events):
            alias = alias_by_id[event["source_media_id"]]
            record = _kill_record(event, alias)
            item = {"clip": alias, "K": record["K"], "upto": 34}
            if event.get("event_id") in grouped and kills and kills[-1]["clip"] == alias and kills[-1]["K"] < item["K"]:
                item["with_previous"] = True
            kills.append(item)
            kill_db[str(index)] = record
        _write(work / "kills.json", kill_db)
        chain = _keep_chain(kills)
        length = max(8.0, 2.4 * len(kills))
        plan = {**_music_plan(work, stage, music, length), "length": length, "frame": "horizontal",
                "kills": kills, "look": config["look"], "lead_frames": 20, "hit_lead_frames": 0,
                "cut_lead_frames": 0, "auto_bullet": False, "ref_notes": "vms-ending.json"}
        rhythm = _plan_native_style(work, stage, plan, music, chain, action["min_interval_s"] if action else 0)
        if action:
            _write(work / "action-review.json", action)
            stage("vms_edit.py", "action", "action-review.json", "action-timing.json")
            stage("preflight.py")
        stage("vms_edit.py", "tune", "vms-style.json")
        if ace:
            _write(work / "ace-review.json", ace)
            stage("vms_edit.py", "ace", "ace-review.json", "ace-timing.json")
            stage("preflight.py")
        summary = _snapshot(work, python)
        if ace:
            summary["ending_confirmation"] = _read(work / "ace-timing.json")
        if action:
            summary["final_action"] = _read(work / "action-timing.json")
        rhythm["measured_count"] = _check_impacts(summary, kills, _read(work / "measured-matches.json"))
        rhythm["selected_count"] = len(kills)
        if rhythm["measured_count"] != len(kills):
            notices.append("Sebagian penempatan beat belum terukur. Periksa penanda pada draft sebelum export.")
        summary.update(rhythm=rhythm, planning_notices=notices, visual_reference=reference_info)
        labels = {alias: Path(path).name for alias, path in clips.items()}
        selection = [
            {
                **{key: event[key] for key in ("source_media_id", "source_time_us", "source_frame",
                                              "in_us", "out_us", "confidence", "evidence")},
                "event_id": event.get("event_id", uuid.uuid4().hex),
                "tags": event.get("tags", event.get("suggested_tags", [])),
                "owner": "player", "is_user_override": True, "cluster_id": None, "rating": None,
            }
            for event in events
        ]
        summary.update(id=plan_id, sources=labels, source_ids={alias: key for key, alias in alias_by_id.items()},
                       auto_selected=not bool(project["events"]), selection=selection)
        _write(work / "summary.json", summary)
        metadata = {"native_style": True, "fingerprint": _fingerprint(project, native_style=True), "stamps": stamps,
                    "timeline_sha1": hashlib.sha1((work / "timeline.py").read_bytes()).hexdigest()}
        _write(work / "draft.json", metadata)
        return summary
    except Exception:
        shutil.rmtree(work, ignore_errors=True)
        raise


def _load_reference(project: dict) -> tuple[Path, dict, dict]:
    plan_id = project.get("reference_draft")
    if not isinstance(plan_id, str) or not re.fullmatch("[a-f0-9]{32}", plan_id):
        raise MediaToolError("ID draft upstream tidak valid.")
    work = app_data_dir() / "reference-drafts" / plan_id
    try:
        metadata = _read(work / "draft.json")
        summary = _read(work / "summary.json")
        stamps = {alias: _media_stamp(stamp[0]) for alias, stamp in metadata["stamps"].items()}
        timeline_hash = hashlib.sha1((work / "timeline.py").read_bytes()).hexdigest()
    except OSError as exc:
        raise MediaToolError("Draft upstream atau media sumber tidak ditemukan. Buat draft baru setelah memeriksa file.") from exc
    if (metadata["fingerprint"] != _fingerprint(project, native_style=bool(metadata.get("native_style")))
            or stamps != metadata["stamps"] or timeline_hash != metadata["timeline_sha1"]):
        raise MediaToolError("Input atau timeline berubah sejak draft upstream dibuat. Buat draft baru.")
    return work, metadata, summary


def reference_preflight(project: dict, output_path: str, rights: bool, ownership: bool) -> dict:
    errors = []
    destination = Path(output_path).resolve()
    try:
        _, _, summary = _load_reference(project)
    except (MediaToolError, OSError) as exc:
        errors.append(str(exc))
        summary = {"frames": 0, "fps": 60, "auto_selected": False}
    if not rights:
        errors.append("Konfirmasi hak penggunaan musik.")
    if not ownership:
        errors.append("Konfirmasi bahwa semua highlight draft upstream sudah ditinjau dan diizinkan.")
    if (destination.suffix.lower() != ".mp4" or not destination.parent.is_dir()
            or not os.access(destination.parent, os.W_OK) or destination.exists()):
        errors.append("Pilih nama output MP4 baru di folder yang tersedia.")
    elif any(destination.with_suffix(ext).exists() for ext in (".qa.json", ".qa.html", ".project.json")):
        errors.append("File QA atau project dengan nama output ini sudah ada.")
    elif shutil.disk_usage(destination.parent).free < max(64 * 1024 * 1024, summary["frames"] * 90_000):
        errors.append("Ruang disk output tidak cukup.")
    return {"errors": errors, "warnings": [], "output_path": str(destination),
            "fps": 60, "width": 1920, "height": 1080, "total_frames": summary["frames"],
            "duration_us": round(summary["frames"] * 1_000_000 / 60)}


def read_reference_draft(project: dict) -> dict:
    return _load_reference(project)[2]


def render_reference(project: dict, output_path: str, rights: bool, ownership: bool,
                     cancel_event, progress) -> dict:
    report = reference_preflight(project, output_path, rights, ownership)
    if report["errors"]:
        raise MediaToolError(" ".join(report["errors"]))
    work, metadata, summary = _load_reference(project)
    python = upstream_python(require_rife=True)
    ffmpeg = shutil.which("ffmpeg")
    if not python or not ffmpeg:
        raise MediaToolError("Runtime upstream/RIFE dan FFmpeg diperlukan.")
    destination = Path(report["output_path"])
    partial = destination.with_name(f".{uuid.uuid4().hex}.partial.mp4")

    def stage(value, name, *args, allow_nonzero=False):
        progress(value, f"Upstream · {name}")
        return _run_upstream_cancellable(python, work / name, list(args), work, 7200, cancel_event,
                                         allow_nonzero=allow_nonzero)

    try:
        stage(.05, "preflight.py")
        stage(.08, "ranges.py")
        stage(.12, "prep.py", "ranges.json")
        stage(.33, "posmap.py")
        stage(.36, "check_store.py")
        if metadata.get("native_style"):
            stage(.4, "vms_edit.py", "render", "video.mp4")
        else:
            stage(.4, "render.py", "0", str(summary["frames"]), "video.mp4")
        stage(.8, "ff.py", "pts", "video.mp4", str(summary["frames"]))
        if metadata.get("native_style"):
            stage(.82, "vms_edit.py", "mix", "vms-style.json")
        else:
            stage(.82, "audio.py")
        mux = work / "vms_mux.py"
        mux.write_text(
            'import subprocess, sys\nfrom audio import master_chain\n'
            'subprocess.run([sys.argv[1], "-v", "error", "-y", "-i", "video.mp4", "-i", "mix.wav",\n'
            ' "-af", master_chain(), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",\n'
            ' "-b:a", "320k", "-aac_pns", "0", "-aac_tns", "0", "-aac_is", "0", "-metadata",\n'
            ' "comment=timeline_sha1=" + sys.argv[2], "-movflags", "+faststart", sys.argv[3]], check=True)\n',
            encoding="utf-8")
        stage(.88, mux.name, ffmpeg, metadata["timeline_sha1"], str(partial))
        peak_guard = stage(.9, "peakguard.py", str(partial), "chain", "mix.wav")
        result = stage(.92, "gate.py", str(partial), "--json", allow_nonzero=True)
        try:
            # The command merges stderr and stdout. Parse the last JSON array
            # even if an upstream tool emitted a diagnostic before it.
            start = re.search(r"^\[", result, re.M)
            items = json.JSONDecoder().raw_decode(result[start.start():])[0] if start else None
            if not isinstance(items, list):
                raise ValueError("gate output is not a list")
        except ValueError as exc:
            raise MediaToolError("QA upstream tidak menghasilkan laporan yang valid.") from exc
        if summary.get("final_action"):
            stage(.96, "vms_edit.py", "audit-action", str(partial), "action-timing.json", "action-audit.json")
            action_audit = _read(work / "action-audit.json")
            if not action_audit["verified"]:
                items.append({"severity": "ERROR", "code": "final-action-unverified",
                              "msg": "The encoded final action could not be matched to the reviewed source."})
        else:
            action_audit = None
        counted_frames = _count_video_frames(partial)
        if counted_frames != summary["frames"]:
            items.append({"severity": "ERROR", "code": "decoded-frame-count",
                          "msg": f"Decoded {counted_frames} frames; expected {summary['frames']}."})
        status = "FAIL" if any(i["severity"] == "ERROR" for i in items) else "WARN" if items else "PASS"
        checks = [{"status": "FAIL" if i["severity"] == "ERROR" else i["severity"],
                   "name": i["code"], "message": i["msg"], "details": i} for i in items]
        checks.append({"status": "PASS", "name": "interpolation-store",
                       "message": "Upstream check_store completed before picture render."})
        checks.append({"status": "PASS", "name": "peak-guard", "message": peak_guard.strip()})
        qc = {"status": status, "checks": checks, "decoded_frames": counted_frames,
              "engine": "upstream-refstyle", "upstream_commit": UPSTREAM_COMMIT,
              "timeline": summary, "audio": _read(work / "audio_report.json")}
        if action_audit:
            qc["final_action"] = action_audit
        qa_json = destination.with_suffix(".qa.json")
        qa_html = destination.with_suffix(".qa.html")
        sidecar = destination.with_suffix(".project.json")
        if cancel_event.is_set():
            raise InterruptedError("Render upstream dibatalkan.")
        if destination.exists():
            raise MediaToolError("Output sudah ada.")
        if any(path.exists() for path in (qa_json, qa_html, sidecar)):
            raise MediaToolError("File QA atau project dengan nama output ini sudah ada.")
        written = []
        try:
            for filename, content in ((qa_json, json.dumps(qc, ensure_ascii=False, indent=2)),
                                      (qa_html, "<meta charset=utf-8><h1>Upstream QA · " + status + "</h1><pre>"
                                       + html.escape(json.dumps(qc, ensure_ascii=False, indent=2)) + "</pre>"),
                                      (sidecar, json.dumps({**project, "reference_render": summary},
                                                           ensure_ascii=False, indent=2))):
                with filename.open("x", encoding="utf-8") as stream:
                    written.append(filename)
                    stream.write(content + "\n")
            partial.rename(destination)
        except Exception:
            for filename in written:
                filename.unlink(missing_ok=True)
            raise
        return {"output_path": str(destination), "project_sidecar": str(sidecar), "qa_json": str(qa_json),
                "qa_html": str(qa_html), "qa": qc, "state": "complete" if status == "PASS" else "needs_review"}
    finally:
        partial.unlink(missing_ok=True)
