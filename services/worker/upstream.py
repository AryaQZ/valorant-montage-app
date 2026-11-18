"""Local adapter for the MIT-licensed gameplay-montage reference pipeline."""

from __future__ import annotations

from pathlib import Path
from typing import Any
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import bisect

from .media import MediaToolError, app_data_dir, probe_media

UPSTREAM_COMMIT = "bd016ee02ac3d667f6849a136ab5f69edbd0edec"
def _locate_upstream_root() -> Path:
    repository = Path(__file__).resolve().parents[2]
    packaged = Path(__file__).resolve().parents[3] / "upstream" / "editing-gameplay-montages"
    configured = os.environ.get("VMS_UPSTREAM_ROOT")
    candidates = [Path(configured).expanduser() if configured else None,
                  repository / "third_party" / "editing-gameplay-montages" / "skills" / "editing-gameplay-montages",
                  packaged]
    for candidate in candidates:
        if not candidate:
            continue
        if (candidate / "scripts").is_dir():
            return candidate.resolve()
        nested = candidate / "skills" / "editing-gameplay-montages"
        if (nested / "scripts").is_dir():
            return nested.resolve()
    return candidates[1] or repository


UPSTREAM_ROOT = _locate_upstream_root()
UPSTREAM_SCRIPTS = UPSTREAM_ROOT / "scripts"
UPSTREAM_MODEL = UPSTREAM_ROOT / "models" / "rife-v4.25"


def _candidate_pythons() -> list[str]:
    candidates = [os.environ.get("VMS_UPSTREAM_PYTHON", "")]
    repo = Path(__file__).resolve().parents[2]
    app_data_venv = app_data_dir() / "upstream-venv"
    candidates.extend([
        str(app_data_venv / "Scripts" / "python.exe"),
        str(app_data_venv / "bin" / "python"),
        str(repo / ".build-tools" / "upstream-venv" / "Scripts" / "python.exe"),
        str(repo / ".build-tools" / "upstream-venv" / "bin" / "python"),
        shutil.which("python3.11") or "",
    ])
    return [value for value in candidates if value]


def _rife_gpu_index() -> str:
    configured = os.environ.get("VMS_RIFE_GPU")
    if configured is not None and configured.strip():
        return configured.strip()
    try:
        configured = (app_data_dir() / "rife_gpu.txt").read_text(encoding="ascii").strip()
        if configured:
            return configured
    except OSError:
        pass
    return "0"


def upstream_python(*, require_rife: bool = False) -> str | None:
    if not UPSTREAM_SCRIPTS.is_dir():
        return None
    for candidate in dict.fromkeys(_candidate_pythons()):
        path = Path(candidate)
        if path.parent.name == "Scripts" and not path.is_file():
            continue
        if not path.exists() and shutil.which(candidate) is None:
            continue
        command = [candidate, "-c", "import sys; assert sys.version_info[:2] == (3, 11); import numpy, cv2, scipy"]
        if require_rife:
            command[-1] += "; import rife_ncnn_vulkan_python"
        try:
            result = subprocess.run(command, capture_output=True, timeout=12, check=False)
        except (OSError, subprocess.TimeoutExpired):
            continue
        if result.returncode == 0:
            return candidate
    return None


def capabilities() -> dict[str, Any]:
    python = upstream_python()
    rife_python = upstream_python(require_rife=True) if python else None
    model_ok = (UPSTREAM_MODEL / "flownet.bin").is_file() and (UPSTREAM_MODEL / "flownet.param").is_file()
    return {
        "repository": "https://github.com/gustavomenani/editing-gameplay-montages",
        "commit": UPSTREAM_COMMIT,
        "license": "MIT",
        "available": bool(python),
        "python": python,
        "kill_detection": bool(python),
        "measured_music_attacks": bool(python),
        "rife_python": rife_python,
        "rife_model_available": bool(rife_python and model_ok),
        "rife_model": "RIFE v4.25 / ncnn Vulkan" if rife_python and model_ok else None,
        "note": "Deteksi kill tetap kandidat yang wajib ditinjau pengguna; proses media lokal.",
    }


def _run(python: str, script: Path, args: list[str], cwd: Path, timeout: int,
         *, allow_nonzero: bool = False) -> str:
    env = dict(os.environ)
    env.setdefault("RIFE_MODEL", str(UPSTREAM_MODEL))
    env.setdefault("RIFE_GPU", _rife_gpu_index())
    command = [python, str(script), *args]
    try:
        result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise MediaToolError(f"Tahap upstream {script.name} melewati batas {timeout // 60} menit.") from exc
    except OSError as exc:
        raise MediaToolError(f"Tidak dapat menjalankan tahap upstream {script.name}: {type(exc).__name__}.") from exc
    if result.returncode != 0 and not allow_nonzero:
        detail = "\n".join((result.stdout + "\n" + result.stderr).splitlines()[-10:]).strip()
        raise MediaToolError(f"Pipeline upstream {script.name} gagal ({result.returncode}). {detail[-1600:]}")
    return result.stdout


def _run_upstream_cancellable(python: str, script: Path, args: list[str], cwd: Path, timeout: int,
                              cancel_event: Any = None, *, allow_nonzero: bool = False) -> str:
    env = dict(os.environ)
    env.setdefault("RIFE_MODEL", str(UPSTREAM_MODEL))
    env.setdefault("RIFE_GPU", _rife_gpu_index())
    env.setdefault("VMS_UPSTREAM_ROOT", str(UPSTREAM_ROOT))
    env.pop("ACCEPT", None)
    env["PYTHONIOENCODING"] = "utf-8"
    log_path = cwd / f"{script.stem}.log"
    process: subprocess.Popen[bytes] | None = None
    try:
        if cancel_event is not None and cancel_event.is_set():
            raise InterruptedError(f"Tahap upstream {script.name} dibatalkan.")
        with log_path.open("wb") as log:
            process = subprocess.Popen([python, str(script), *args], cwd=cwd, env=env,
                                       stdout=log, stderr=subprocess.STDOUT,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                                       start_new_session=os.name != "nt")
            deadline = time.monotonic() + timeout
            while process.poll() is None:
                if cancel_event is not None and cancel_event.is_set():
                    _stop_upstream_process(process)
                    raise InterruptedError(f"Tahap upstream {script.name} dibatalkan.")
                if time.monotonic() >= deadline:
                    _stop_upstream_process(process)
                    raise MediaToolError(f"Tahap upstream {script.name} melewati batas {timeout // 60} menit.")
                time.sleep(0.2)
    except InterruptedError:
        raise
    except MediaToolError:
        raise
    except OSError as exc:
        raise MediaToolError(f"Tidak dapat menjalankan tahap upstream {script.name}: {type(exc).__name__}.") from exc
    output = log_path.read_text(encoding="utf-8", errors="replace") if log_path.is_file() else ""
    if process is None or (process.returncode != 0 and not allow_nonzero):
        detail = "\n".join(output.splitlines()[-12:]).strip()
        raise MediaToolError(f"Pipeline upstream {script.name} gagal ({None if process is None else process.returncode}). {detail[-1800:]}")
    return output


def _stop_upstream_process(process: subprocess.Popen) -> None:
    # Upstream Python stages can have FFmpeg running under them.
    if os.name == "nt":
        taskkill = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "taskkill.exe"
        try:
            subprocess.run([str(taskkill), "/PID", str(process.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5,
                           creationflags=subprocess.CREATE_NO_WINDOW, check=False)
        except (OSError, subprocess.TimeoutExpired):
            pass
    else:
        import signal
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if process.poll() is None:
        process.kill()
    process.wait(timeout=5)


def _normalize_vfr_source(source_path: Path, source_digest: str, *, cancel_event: Any = None) -> tuple[Path, int, str] | None:
    """Use upstream's timestamp-aware exact ingest to create a frame-indexed 60 fps working copy."""
    python = upstream_python(require_rife=True)
    if not python or not (UPSTREAM_MODEL / "flownet.bin").is_file():
        return None
    identity = hashlib.sha256(json.dumps({"source_sha256": source_digest, "mode": "exact",
                                          "fps": 60, "upstream_commit": UPSTREAM_COMMIT},
                                         sort_keys=True).encode("utf-8")).hexdigest()
    work = app_data_dir() / "upstream" / "normalized" / identity
    source_dir = work / "src"
    ingest_manifest = work / "src" / "ingest.json"
    candidates = sorted(source_dir.glob("c1.*")) if source_dir.is_dir() else []
    normalized = next((path for path in candidates if path.is_file()), None)
    if normalized is None or not ingest_manifest.is_file():
        work.mkdir(parents=True, exist_ok=True)
        (work / "clips.json").write_text(json.dumps({"c1": source_path.as_posix()}, ensure_ascii=False, indent=2) + "\n",
                                             encoding="utf-8")
        _run_upstream_cancellable(python, UPSTREAM_SCRIPTS / "ingest.py", ["--exact", "--convert"], work,
                                  3 * 60 * 60, cancel_event)
        _run_upstream_cancellable(python, UPSTREAM_SCRIPTS / "mkpts.py", ["c1"], work,
                                  30 * 60, cancel_event)
        candidates = sorted(path for path in source_dir.glob("c1.*") if path.is_file())
        normalized = candidates[0] if candidates else None
    if normalized is None:
        raise MediaToolError("Upstream exact ingest selesai tanpa source CFR yang dapat dibaca.")
    try:
        entry = json.loads(ingest_manifest.read_text(encoding="utf-8"))["c1"]
        origin_us = round(float(entry["t0"]) * 1_000_000)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise MediaToolError("Upstream exact ingest tidak menghasilkan frame origin metadata yang valid.") from exc
    return normalized, origin_us, _sha256_file(normalized)


def _source_packet_timestamps(path: Path) -> list[float]:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return []
    try:
        result = subprocess.run([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_packets",
                                 "-show_entries", "packet=pts_time", "-of", "csv=p=0", str(path)],
                                capture_output=True, text=True, timeout=20 * 60, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return []
    if result.returncode != 0:
        return []
    values = []
    for line in result.stdout.splitlines():
        try:
            value = float(line.strip().split(",", 1)[0])
        except (ValueError, IndexError):
            continue
        values.append(value)
    return sorted(values)


def _nearest_source_frame(timestamps: list[float], time_us: int, fallback_frame: int) -> tuple[int, str]:
    if not timestamps:
        return max(0, fallback_frame), "average_rate_fallback"
    target = time_us / 1_000_000
    index = bisect.bisect_left(timestamps, target)
    candidates = [value for value in (index - 1, index) if 0 <= value < len(timestamps)]
    nearest = min(candidates, key=lambda value: abs(timestamps[value] - target))
    return nearest, "ffprobe_packet_pts"


def detect_kills(path_value: str, source_media_id: str, duration_us: int | None) -> dict[str, Any]:
    """Run original Valorant feed/shot detection and return review-only event candidates."""
    python = upstream_python()
    if not python:
        raise MediaToolError("Deteksi upstream memerlukan Python 3.11 dengan NumPy, OpenCV, dan SciPy. Jalankan scripts/setup-upstream.ps1.")
    media = probe_media(path_value, sample_vfr=False)
    duration_us = min(duration_us, media["duration_us"]) if duration_us is not None else media["duration_us"]
    path = Path(media["path"])
    stat = path.stat()
    cache_key = hashlib.sha256(f"{path}|{stat.st_size}|{stat.st_mtime_ns}".encode("utf-8")).hexdigest()[:24]
    work = app_data_dir() / "upstream" / cache_key
    work.mkdir(parents=True, exist_ok=True)
    clips_path = work / "clips.json"
    clips_path.write_text(json.dumps({"c1": str(path)}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Kill review needs the original 60 fps timeline, but not the expensive
    # exact RIFE reconstruction for every source frame. Upstream --fast keeps
    # that same frame grid, bounds nearest-frame error to half a source frame,
    # and interpolates only when needed to avoid repeating a source frame.
    # Final montage rendering still reads the original timestamped source.
    _run(python, UPSTREAM_SCRIPTS / "ingest.py", ["--fast"], work, 60 * 60)
    _run(python, UPSTREAM_SCRIPTS / "mkpts.py", ["c1"], work, 15 * 60)
    _run(python, UPSTREAM_SCRIPTS / "kills_auto.py", ["valorant", "c1"], work, 60 * 60)
    try:
        detections = json.loads((work / "kills.json").read_text(encoding="utf-8"))
        ingest = json.loads((work / "src" / "ingest.json").read_text(encoding="utf-8"))["c1"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise MediaToolError("Pipeline upstream tidak menghasilkan kills.json atau ingest.json yang valid.") from exc
    if not detections and (work / "rows_other.json").is_file():
        rejected = json.loads((work / "rows_other.json").read_text(encoding="utf-8"))
        if any(row.get("why") == "other player" for row in rejected.get("c1", [])):
            _run(python, Path(__file__).with_name("replay_scan.py"), [str(UPSTREAM_SCRIPTS)], work, 3600)
            detections = json.loads((work / "kills.json").read_text(encoding="utf-8"))
    verification: dict[str, Any] = {}
    ranked: dict[str, Any] = {}
    if detections:
        review_dir = work / "kverify"
        review_dir.mkdir(parents=True, exist_ok=True)
        _run(python, UPSTREAM_SCRIPTS / "kverify.py",
             ["kills.json", "--update", "--game", "valorant", "--out", str(review_dir / "kv")],
             work, 60 * 60, allow_nonzero=True)
        try:
            verification = json.loads((review_dir / "kv.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise MediaToolError("kverify upstream tidak menghasilkan kv.json yang dapat dibaca.") from exc
        try:
            detections = json.loads((work / "kills.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise MediaToolError("kverify upstream tidak dapat memperbarui kills.json.") from exc

        # Feed timing can put an ammo-backed candidate one CFR frame before the
        # actual shot. Verify the two adjacent frames with the original
        # kverify algorithm; correct only when exactly one neighbor is a
        # verified shot. Feed-lag guesses are never promoted this way.
        corrected = False
        for key, item in detections.items():
            if not isinstance(item, dict) or type(item.get("K")) is not int:
                continue
            current_k = item["K"]
            original_k = int(item.get("K_was", current_k))
            initial = verification.get(f"c1@{current_k}", verification.get(f"c1@{original_k}", {}))
            cues = f"{item.get('how', '')} {item.get('method', '')}".lower()
            has_ammo_evidence = "ammo" in cues and "feed-lag" not in cues and "guess" not in cues
            if (initial.get("verdict") in {"verified", "correct"}
                    or not has_ammo_evidence):
                continue
            verified_neighbors: list[tuple[int, dict[str, Any]]] = []
            for delta in (-1, 1):
                neighbor_k = current_k + delta
                if neighbor_k < 0:
                    continue
                output_prefix = review_dir / f"adj_{key}_{neighbor_k}"
                _run(python, UPSTREAM_SCRIPTS / "kverify.py",
                     [f"c1@{neighbor_k}", "--game", "valorant", "--no-sheets", "--out", str(output_prefix)],
                     work, 30 * 60, allow_nonzero=True)
                try:
                    neighbor_result = json.loads(output_prefix.with_suffix(".json").read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                measured = neighbor_result.get(f"c1@{neighbor_k}", {})
                if (measured.get("verdict") in {"verified", "correct"}
                        and measured.get("how") in {"ammo", "flash"}):
                    verified_neighbors.append((neighbor_k, measured))
            if len(verified_neighbors) != 1:
                continue
            corrected_k, measured = verified_neighbors[0]
            item["K_was"] = current_k
            item["K"] = corrected_k
            item["conf"] = "medium"
            item["how"] = measured["how"]
            item["verified"] = True
            item["kverify"] = "verified"
            item["frame_correction"] = {"from": current_k, "to": corrected_k,
                                         "reason": measured.get("why"), "method": measured["how"]}
            verification[f"c1@{corrected_k}"] = measured
            corrected = True
        if corrected:
            (work / "kills.json").write_text(json.dumps(detections, ensure_ascii=False, indent=1) + "\n",
                                               encoding="utf-8")
        _run(python, UPSTREAM_SCRIPTS / "kill_rank.py",
             ["--no-flick", "--no-dupes", "--out", "kill_rank.json"], work, 60 * 60)
        try:
            ranked = json.loads((work / "kill_rank.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise MediaToolError("kill_rank upstream tidak menghasilkan kill_rank.json yang dapat dibaca.") from exc
        try:
            detections = json.loads((work / "kills.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise MediaToolError("kverify upstream tidak dapat memperbarui kills.json.") from exc
    confidence = {"high": 0.90, "medium": 0.65, "low": 0.35, "guess": 0.15}
    source_rate = media["video"].get("avg_frame_rate") or (60, 1)
    if not isinstance(source_rate, (list, tuple)) or len(source_rate) != 2:
        source_rate = (60, 1)
    source_fps = float(source_rate[0]) / max(1, float(source_rate[1]))
    source_start_us = int(media["video"].get("start_time_us") or 0)
    t0_us = round(float(ingest.get("t0", 0.0)) * 1_000_000)
    source_pts = _source_packet_timestamps(path) if detections else []
    candidates: list[dict[str, Any]] = []
    for key, item in detections.items():
        if not isinstance(item, dict) or type(item.get("K")) is not int:
            continue
        source_time_us = t0_us + round(item["K"] * 1_000_000 / 60.0)
        if not 0 <= source_time_us <= duration_us:
            continue
        start_us = max(0, source_time_us - 2_000_000)
        end_us = min(duration_us, source_time_us + 1_250_000)
        if start_us >= source_time_us or source_time_us >= end_us:
            continue
        old_k = int(item.get("K_was", item["K"]))
        kverify = verification.get(f"c1@{item['K']}", verification.get(f"c1@{old_k}", {}))
        rank_row = next((row for row in ranked.get("kills", []) if str(row.get("id")) == str(key)), {})
        headshot_score = item.get("headshot")
        rank_run = rank_row.get("run") or []
        # Context affects the director's selection and effect schedule. Do not
        # let a probabilistic feed-lag guess masquerade as a verified headshot
        # or multikill: kverify's actual shot-frame result is the gate.
        shot_how = kverify.get("how")
        verified_on_frame = (kverify.get("verdict") in {"verified", "correct"}
                             and shot_how in {"ammo", "flash"})
        suggested_tags = []
        if verified_on_frame and isinstance(headshot_score, (int, float)) and headshot_score >= 0.6:
            suggested_tags.append("headshot")
        if verified_on_frame and rank_run and isinstance(rank_run[0], int) and rank_run[0] >= 2:
            suggested_tags.append("multikill")
        fallback_frame = round((source_time_us - source_start_us) * source_fps / 1_000_000)
        source_frame, source_frame_mapping = _nearest_source_frame(source_pts, source_time_us, fallback_frame)
        review_sheet = str(work / f"autokill_{int(key) // 5 + 1:02d}.jpg")
        kverify_sheet = str(review_dir / f"kv_{int(key) // 6 + 1:02d}.jpg") if verification else None
        candidates.append({
            "candidate_id": f"upstream-c1-{key}",
            "source_media_id": source_media_id,
            "source_time_us": source_time_us,
            "source_frame": source_frame,
            "in_us": start_us,
            "out_us": end_us,
            "confidence": confidence.get(str(item.get("conf", "guess")).lower(), 0.15),
            "confidence_label": str(item.get("conf", "guess")),
            "method": str(item.get("method", "unknown")),
            "feed_frame": item.get("feed"),
            "verified_by_upstream": verified_on_frame,
            "suggested_tags": suggested_tags,
            "requires_user_review": True,
            "requires_ownership_review": bool(item.get("review_ownership")),
            "evidence": [{"type": "upstream_kill_candidate", "upstream_commit": UPSTREAM_COMMIT,
                          "requires_ownership_review": bool(item.get("review_ownership")),
                          "game": "valorant", "shot_method": str(item.get("how", item.get("method", "unknown"))),
                          "feed_frame": item.get("feed"), "upstream_verified": verified_on_frame,
                          "working_frame_60": item["K"], "original_working_frame_60": old_k,
                          "confidence_label": str(item.get("conf", "guess")),
                          "shot_verification": {"verdict": kverify.get("verdict"), "how": kverify.get("how"),
                                                 "reason": kverify.get("why"), "corrected_frame": item.get("K"),
                                                 "frame_correction": item.get("frame_correction")},
                          "headshot_score": headshot_score, "visibility": item.get("visible"),
                          "source_frame_mapping": source_frame_mapping,
                          "hidden": bool(item.get("hidden")), "no_shot": bool(item.get("no_shot")),
                          "kill_rank": {"score": rank_row.get("score"), "reasons": rank_row.get("reasons"),
                                        "run": rank_row.get("run"), "rank": rank_row.get("rank")},
                          "suggested_tags": suggested_tags,
                          "review_sheet": review_sheet, "shot_verification_sheet": kverify_sheet}],
        })
    return {"source_media_id": source_media_id, "candidates": candidates,
            "upstream_commit": UPSTREAM_COMMIT, "candidate_count": len(candidates),
            "status": "needs_user_review", "working_directory": str(work)}


def render_rife_segment(source: dict[str, Any], segment: dict[str, Any], fps: int,
                        output_frames: int, *, cancel_event: Any = None) -> dict[str, Any] | None:
    """Render a forward slow-motion segment with upstream RIFE, normalizing VFR sources first."""
    rate = source.get("video", {}).get("avg_frame_rate")
    real_rate = source.get("video", {}).get("r_frame_rate")
    if (segment.get("direction", "forward") != "forward"
            or segment["speed_num"] >= segment["speed_den"]):
        return None
    behavior = source.get("video", {}).get("timestamp_behavior") or {}
    python = upstream_python(require_rife=True)
    if not python or not (UPSTREAM_MODEL / "flownet.bin").is_file():
        return None
    original_path = Path(source["path"]).resolve(strict=True)
    source_digest = _sha256_file(original_path)
    source_path = original_path
    effective_segment = dict(segment)
    effective_rate = rate
    stream_start_us = int(source.get("video", {}).get("start_time_us") or 0)
    normalized_digest = None
    rate_cfr = (isinstance(rate, (list, tuple)) and len(rate) == 2 and bool(rate[0]) and bool(rate[1])
                and isinstance(real_rate, (list, tuple)) and len(real_rate) == 2
                and rate[0] * real_rate[1] == real_rate[0] * rate[1])
    if behavior.get("variable_frame_rate") is True or not rate_cfr:
        normalized = _normalize_vfr_source(original_path, source_digest, cancel_event=cancel_event)
        if normalized is None:
            return None
        source_path, origin_us, normalized_digest = normalized
        effective_segment["source_start_us"] = max(0, int(segment["source_start_us"]) - origin_us)
        effective_segment["source_end_us"] = max(0, int(segment["source_end_us"]) - origin_us)
        if effective_segment["source_end_us"] <= effective_segment["source_start_us"]:
            return None
        effective_rate = (60, 1)
        stream_start_us = 0
    if not isinstance(effective_rate, (list, tuple)) or len(effective_rate) != 2 or not effective_rate[0] or not effective_rate[1]:
        return None
    stat = source_path.stat()
    gpu = _rife_gpu_index()
    model_digest = _sha256_file(UPSTREAM_MODEL / "flownet.bin")
    key = hashlib.sha256(json.dumps({
        "source_sha256": source_digest,
        "normalized_source_sha256": normalized_digest,
        "range_us": [segment["source_start_us"], segment["source_end_us"]],
        "speed": [segment["speed_num"], segment["speed_den"]],
        "output_frames": output_frames,
        "fps": fps,
        "model_sha256": model_digest,
        "upstream_commit": UPSTREAM_COMMIT,
        "gpu": gpu,
        "renderer": 1,
    }, sort_keys=True).encode("utf-8")).hexdigest()
    cache = app_data_dir() / "rife-cache" / f"{key}.mkv"
    if cache.is_file() and cache.stat().st_size > 1024 and _count_video_frames(cache) == output_frames:
        return {"path": str(cache), "cache_key": key, "cache_hit": True,
                "source_sha256": source_digest, "model_sha256": model_digest,
                "normalized_source_sha256": normalized_digest, "fps": fps, "frames": output_frames}
    cache.parent.mkdir(parents=True, exist_ok=True)
    temporary = cache.with_name(f".{cache.stem}.{os.getpid()}.{stat.st_mtime_ns}.partial.mkv")
    args = [python, str(Path(__file__).with_name("rife_segment.py")),
            "--source", str(source_path), "--start-us", str(effective_segment["source_start_us"]),
            "--end-us", str(effective_segment["source_end_us"]),
            "--stream-start-us", str(stream_start_us),
            "--source-fps-num", str(int(effective_rate[0])), "--source-fps-den", str(int(effective_rate[1])),
            "--speed-num", str(segment["speed_num"]), "--speed-den", str(segment["speed_den"]),
            "--output-frames", str(output_frames), "--output-fps", str(fps), "--output", str(temporary)]
    env = dict(os.environ)
    env["RIFE_MODEL"] = str(UPSTREAM_MODEL)
    env["RIFE_GPU"] = gpu
    env["VMS_UPSTREAM_ROOT"] = str(UPSTREAM_ROOT)
    process: subprocess.Popen[bytes] | None = None
    try:
        process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=env)
        if cancel_event is not None and hasattr(cancel_event, "attach_process"):
            cancel_event.attach_process(process)
        deadline = time.monotonic() + max(900, output_frames * 2)
        while process.poll() is None:
            if cancel_event is not None and cancel_event.is_set():
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                temporary.unlink(missing_ok=True)
                raise InterruptedError("Render dibatalkan pengguna saat RIFE menyiapkan slow motion.")
            if time.monotonic() >= deadline:
                process.kill()
                process.wait(timeout=5)
                raise MediaToolError("RIFE slow-motion pre-render melewati batas waktu.")
            time.sleep(0.2)
        if cancel_event is not None and cancel_event.is_set():
            temporary.unlink(missing_ok=True)
            raise InterruptedError("Render dibatalkan pengguna saat RIFE menyiapkan slow motion.")
        stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
        if process.stderr:
            process.stderr.close()
    except InterruptedError:
        temporary.unlink(missing_ok=True)
        raise
    except MediaToolError:
        temporary.unlink(missing_ok=True)
        raise
    except (OSError, subprocess.TimeoutExpired) as exc:
        temporary.unlink(missing_ok=True)
        raise MediaToolError(f"RIFE gagal dijalankan untuk segmen slow motion ({type(exc).__name__}).") from exc
    if process is None or process.returncode != 0 or not temporary.is_file() or _count_video_frames(temporary) != output_frames:
        detail = "\n".join(stderr.splitlines()[-8:]).strip()
        temporary.unlink(missing_ok=True)
        raise MediaToolError(f"RIFE tidak menghasilkan {output_frames} frame terverifikasi. {detail[-1200:]}")
    os.replace(temporary, cache)
    return {"path": str(cache), "cache_key": key, "cache_hit": False,
            "source_sha256": source_digest, "model_sha256": model_digest,
            "normalized_source_sha256": normalized_digest, "fps": fps, "frames": output_frames}


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _count_video_frames(path: Path) -> int | None:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    try:
        result = subprocess.run([ffprobe, "-v", "error", "-select_streams", "v:0", "-count_frames",
                                 "-show_entries", "stream=nb_read_frames", "-of", "default=nokey=1:noprint_wrappers=1",
                                 str(path)], capture_output=True, text=True, timeout=900, check=False)
        return int(result.stdout.strip()) if result.returncode == 0 and result.stdout.strip().isdigit() else None
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None


def analyze_music_attacks(path_value: str, preliminary: dict[str, Any]) -> dict[str, Any] | None:
    """Use the upstream sample-rate onset definition when its pinned runtime is installed."""
    python = upstream_python()
    if not python:
        return None
    duration_us = int(preliminary.get("duration_us", 0))
    bpm = preliminary.get("bpm_estimate")
    beat_grid = preliminary.get("beat_grid") or []
    if not isinstance(bpm, (int, float)) or bpm <= 0 or duration_us < 8_000_000 or not beat_grid:
        return None
    beat0_us = min((int(item["time_us"]) for item in beat_grid if isinstance(item, dict) and type(item.get("time_us")) is int), default=0)
    per_us = 60_000_000 / float(bpm)
    end_beat = max(0.0, (duration_us - 3_500_000 - beat0_us) / per_us)
    if end_beat < 1.0:
        return None
    temp = app_data_dir() / "upstream" / "music"
    temp.mkdir(parents=True, exist_ok=True)
    output = temp / (hashlib.sha256(str(Path(path_value).resolve()).encode("utf-8")).hexdigest()[:20] + ".hits.json")
    _run(python, UPSTREAM_SCRIPTS / "music_hits.py", ["--music", str(Path(path_value).resolve()),
         "--bpm", str(float(bpm)), "--beat0", str(beat0_us / 1_000_000), "--m0", "0", "--r0", "0",
         "--r1", f"{end_beat:.9f}", "--sub", "4", "--all", "-o", str(output)], temp, 60 * 60)
    try:
        doc = json.loads(output.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise MediaToolError("Analisis attack upstream tidak menghasilkan hits.json yang valid.") from exc
    markers = []
    for index, hit in enumerate(doc.get("hits", [])):
        if not isinstance(hit, dict) or not isinstance(hit.get("t"), (int, float)):
            continue
        strength = max(float(hit.get("low", 0)), float(hit.get("mid", 0)), float(hit.get("high", 0)))
        markers.append({"marker_id": f"attack-{index + 1:05d}", "time_us": round(float(hit["t"]) * 1_000_000),
                        "confidence": round(max(0.05, min(1.0, strength)), 3), "kind": "measured_attack",
                        "attack_band": hit.get("band"), "strength": round(strength, 3)})
    return {"beat_grid": markers, "method": "upstream beat_hits.py: 44.1 kHz sample-domain attack timing",
            "onset_definition": doc.get("definition"), "upstream_commit": UPSTREAM_COMMIT,
            "review_note": "Attack times are measured locally; event selection and musical fit still require review."}
