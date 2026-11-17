"""Independent post-render verification and readable QA reporting."""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path
from typing import Any
import re
import shutil
import subprocess

from .media import MediaToolError, probe_media
from .schema import PROFILES, frames_to_duration_us


def run_quality_control(path_value: str, project: dict[str, Any]) -> dict[str, Any]:
    path = Path(path_value).resolve(strict=True)
    fps = PROFILES[project["settings"]["output_profile"]]
    expected_frames = sum(clip["duration_frames"] for clip in project["timeline"])
    expected_us = frames_to_duration_us(expected_frames, fps)
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

    check(video.get("width") == 2560 and video.get("height") == 1440,
          f"Ukuran output {video.get('width')}x{video.get('height')}; target 2560x1440.")
    rate = video.get("avg_frame_rate")
    check(rate == (fps, 1), f"Frame rate {rate}; target {fps}/1 FPS.")
    check(bool(media.get("has_audio")), "Output memiliki audio stream.")
    check(abs(media["duration_us"] - expected_us) <= max(10_000, round(1_000_000 / fps)),
          f"Durasi aktual {media['duration_us']} us; target {expected_us} us.")
    counted_frames = _count_frames(path)
    check(counted_frames == expected_frames,
          f"Jumlah frame terhitung {counted_frames}; target {expected_frames}.")
    black = _detect_intervals(path, "blackdetect=d=0.08:pix_th=0.08:pic_th=0.98", r"black_start:([0-9.]+).*?black_end:([0-9.]+)")
    check(not black, f"Black segments terdeteksi: {len(black)}.", warning=True)
    silence = _detect_intervals(path, "silencedetect=noise=-50dB:d=1", r"silence_start:([0-9.]+).*?silence_end:([0-9.]+)")
    check(not silence, f"Silence >=1 detik terdeteksi: {len(silence)}.", warning=True)
    peak = _measure_peak(path)
    check(peak is None or peak < -0.1, "Peak audio di bawah -0.1 dBFS." if peak is not None else
          "Peak audio tidak dapat diukur; filter volumedetect tidak tersedia.", warning=peak is None)
    status = "FAIL" if failures else "WARN" if warnings else "PASS"
    return {"report_version": 1, "status": status, "file": str(path),
            "expected": {"width": 2560, "height": 1440, "fps": fps,
                         "frames": expected_frames, "duration_us": expected_us},
            "actual": {"width": video.get("width"), "height": video.get("height"),
                       "fps": rate, "duration_us": media["duration_us"],
                       "audio_streams": len(media.get("audio", [])), "frames_counted": counted_frames},
            "intervals": {"black": black, "silence": silence},
            "peak_dbfs": peak, "checks": checks}


def _count_frames(path: Path) -> int | None:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    args = [ffprobe, "-v", "error", "-select_streams", "v:0", "-count_frames",
            "-show_entries", "stream=nb_read_frames", "-of", "default=nokey=1:noprint_wrappers=1", str(path)]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=20, check=False)
        return int(result.stdout.strip()) if result.returncode == 0 and result.stdout.strip().isdigit() else None
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None


def _detect_intervals(path: Path, filter_name: str, pattern: str) -> list[dict[str, float]]:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return []
    args = [ffmpeg, "-hide_banner", "-i", str(path), "-vf", filter_name, "-an", "-f", "null", "-"]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=60 * 60, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return []
    matches = re.findall(pattern, result.stderr or "")
    return [{"start_s": float(start), "end_s": float(end)} for start, end in matches]


def _measure_peak(path: Path) -> float | None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    args = [ffmpeg, "-hide_banner", "-i", str(path), "-vn", "-af", "volumedetect", "-f", "null", "-"]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=60 * 60, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    match = re.search(r"max_volume:\s*(-?inf|-?[0-9.]+)\s*dB", result.stderr or "")
    if not match or match.group(1) == "-inf":
        return None
    return float(match.group(1))
