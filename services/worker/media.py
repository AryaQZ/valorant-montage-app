"""FFprobe inspection and bounded local preview asset generation."""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path
from typing import Any
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".mov", ".m4v", ".webm", ".avi", ".ts", ".mts"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"}


class MediaToolError(RuntimeError):
    """A media input or FFmpeg operation could not be handled."""


def app_data_dir() -> Path:
    override = os.environ.get("VMS_DATA_DIR")
    if override:
        target = Path(override).expanduser().resolve()
    else:
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
        target = base / "VALORANTMontageStudio"
    target.mkdir(parents=True, exist_ok=True)
    return target


def cache_dir() -> Path:
    target = app_data_dir() / "cache"
    target.mkdir(parents=True, exist_ok=True)
    return target


def find_media_tools() -> dict[str, Any]:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    result: dict[str, Any] = {"ffmpeg_path": ffmpeg, "ffprobe_path": ffprobe,
                              "available": bool(ffmpeg and ffprobe), "encoders": []}
    if ffmpeg:
        try:
            version = subprocess.run([ffmpeg, "-version"], capture_output=True, text=True,
                                     timeout=8, check=False)
            result["version"] = (version.stdout.splitlines() or [""])[0][:240]
            encoders = subprocess.run([ffmpeg, "-hide_banner", "-encoders"], capture_output=True,
                                      text=True, timeout=12, check=False)
            text = encoders.stdout + encoders.stderr
            result["encoders"] = [name for name in ("libx264", "h264_nvenc", "h264_amf", "h264_qsv")
                                  if name in text]
        except (OSError, subprocess.TimeoutExpired) as exc:
            result["diagnostic"] = str(exc)
    if not ffmpeg or not ffprobe:
        missing = [name for name, path in (("FFmpeg", ffmpeg), ("FFprobe", ffprobe)) if not path]
        result["diagnostic"] = f"{', '.join(missing)} tidak ditemukan di PATH."
    return result


def _require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise MediaToolError(f"{name} tidak tersedia. Pasang FFmpeg dan pastikan ffmpeg/ffprobe ada di PATH.")
    return path


def _run_probe(path: Path, *, show_streams: bool = True, audio_only: bool = False) -> dict[str, Any]:
    ffprobe = _require_tool("ffprobe")
    entries = "format=format_name,duration,size,bit_rate,start_time:stream=index,codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,r_frame_rate,time_base,start_time,duration,sample_rate,channels,channel_layout,color_range,color_space,color_transfer,color_primaries:stream_tags=rotate:stream_side_data=rotation"
    args = [ffprobe, "-v", "error", "-of", "json", "-show_format"]
    if show_streams:
        args += ["-show_streams", "-show_entries", entries]
    if audio_only:
        args += ["-select_streams", "a"]
    args.append(str(path))
    try:
        completed = subprocess.run(args, capture_output=True, text=True, timeout=45, check=False)
    except subprocess.TimeoutExpired as exc:
        raise MediaToolError("FFprobe melewati batas waktu 45 detik.") from exc
    if completed.returncode != 0:
        message = (completed.stderr or "FFprobe gagal membaca file.").strip()[-1200:]
        raise MediaToolError(message)
    try:
        data = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise MediaToolError("FFprobe mengembalikan metadata yang tidak valid.") from exc
    return data


def _as_fraction(value: Any) -> tuple[int, int] | None:
    if not isinstance(value, str) or not value or value in {"0/0", "N/A"}:
        return None
    try:
        parsed = Fraction(value)
        if parsed <= 0:
            return None
        return parsed.numerator, parsed.denominator
    except (ValueError, ZeroDivisionError):
        return None


def _to_us(value: Any) -> int | None:
    if value in (None, "N/A", ""):
        return None
    try:
        return max(0, round(float(value) * 1_000_000))
    except (ValueError, TypeError, OverflowError):
        return None


def _path_for_probe(path_value: str, allowed: set[str]) -> Path:
    if not isinstance(path_value, str) or not path_value.strip():
        raise MediaToolError("Path media kosong.")
    path = Path(path_value).expanduser().resolve(strict=True)
    if not path.is_file():
        raise MediaToolError("Path yang dipilih bukan file.")
    if path.suffix.lower() not in allowed:
        raise MediaToolError(f"Format {path.suffix or '(tanpa ekstensi)'} belum didukung.")
    return path


def probe_media(path_value: str, *, sample_vfr: bool = True) -> dict[str, Any]:
    path = _path_for_probe(path_value, VIDEO_EXTENSIONS)
    raw = _run_probe(path)
    streams = raw.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = [stream for stream in streams if stream.get("codec_type") == "audio"]
    if not video:
        raise MediaToolError("Tidak ditemukan video stream pada file ini.")
    fmt = raw.get("format", {})
    duration_us = _to_us(video.get("duration")) or _to_us(fmt.get("duration"))
    if not duration_us:
        raise MediaToolError("Durasi video tidak dapat dibaca.")
    avg_rate = _as_fraction(video.get("avg_frame_rate"))
    real_rate = _as_fraction(video.get("r_frame_rate"))
    rotation = 0
    for item in video.get("side_data_list", []):
        if isinstance(item, dict) and item.get("rotation") is not None:
            rotation = int(round(float(item["rotation"])))
    if not rotation:
        rotation = int((video.get("tags") or {}).get("rotate", 0) or 0)
    timestamp_behavior = {"sampled_frames": 0, "variable_frame_rate": None,
                          "method": "rate metadata; packet sample unavailable"}
    if sample_vfr:
        try:
            timestamp_behavior = _sample_timestamps(path)
        except MediaToolError as exc:
            timestamp_behavior["sample_error"] = str(exc)
    return {
        "path": str(path), "filename": path.name, "size_bytes": path.stat().st_size,
        "duration_us": duration_us,
        "container": fmt.get("format_name"),
        "video": {
            "codec": video.get("codec_name"), "width": video.get("width"), "height": video.get("height"),
            "pixel_format": video.get("pix_fmt"), "avg_frame_rate": avg_rate,
            "r_frame_rate": real_rate, "time_base": video.get("time_base"),
            "start_time_us": _to_us(video.get("start_time")) or 0, "rotation_degrees": rotation,
            "color_range": video.get("color_range"), "color_space": video.get("color_space"),
            "color_transfer": video.get("color_transfer"), "color_primaries": video.get("color_primaries"),
            "timestamp_behavior": timestamp_behavior,
        },
        "audio": [{"codec": stream.get("codec_name"), "sample_rate": stream.get("sample_rate"),
                   "channels": stream.get("channels"), "channel_layout": stream.get("channel_layout"),
                   "start_time_us": _to_us(stream.get("start_time")),
                   "duration_us": _to_us(stream.get("duration"))} for stream in audio],
        "has_audio": bool(audio),
    }


def probe_audio(path_value: str) -> dict[str, Any]:
    path = _path_for_probe(path_value, AUDIO_EXTENSIONS | VIDEO_EXTENSIONS)
    raw = _run_probe(path, audio_only=True)
    audio = next((stream for stream in raw.get("streams", []) if stream.get("codec_type") == "audio"), None)
    if not audio:
        raise MediaToolError("File yang dipilih tidak memiliki audio stream.")
    duration_us = _to_us(audio.get("duration")) or _to_us(raw.get("format", {}).get("duration"))
    if not duration_us:
        raise MediaToolError("Durasi audio tidak dapat dibaca.")
    return {"path": str(path), "filename": path.name, "size_bytes": path.stat().st_size,
            "duration_us": duration_us, "codec": audio.get("codec_name"),
            "sample_rate": audio.get("sample_rate"), "channels": audio.get("channels")}


def _sample_timestamps(path: Path) -> dict[str, Any]:
    ffprobe = _require_tool("ffprobe")
    args = [ffprobe, "-v", "error", "-select_streams", "v:0", "-read_intervals", "%+2",
            "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", str(path)]
    try:
        completed = subprocess.run(args, capture_output=True, text=True, timeout=30, check=False)
    except subprocess.TimeoutExpired as exc:
        raise MediaToolError("Sampling timestamp FFprobe melewati batas waktu.") from exc
    if completed.returncode != 0:
        raise MediaToolError((completed.stderr or "Sampling timestamp gagal.").strip()[-500:])
    data = json.loads(completed.stdout)
    times = [_to_us(frame.get("best_effort_timestamp_time")) for frame in data.get("frames", [])]
    times = [value for value in times if value is not None]
    if len(times) < 3:
        return {"sampled_frames": len(times), "variable_frame_rate": None,
                "method": "first two seconds; too few timestamps"}
    gaps = [b - a for a, b in zip(times, times[1:]) if b > a]
    median_gap = sorted(gaps)[len(gaps) // 2]
    varying = sum(abs(gap - median_gap) > max(500, median_gap * 0.02) for gap in gaps)
    return {"sampled_frames": len(times), "median_frame_interval_us": median_gap,
            "variable_frame_rate": varying > max(1, len(gaps) // 30),
            "method": "first two seconds; irregular positive PTS deltas"}


def create_preview_assets(media: dict[str, Any]) -> dict[str, Any]:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return {"thumbnail_path": None, "proxy_path": None,
                "warning": "FFmpeg tidak tersedia; thumbnail dan proxy belum dibuat."}
    source = Path(media["path"]).resolve(strict=True)
    fingerprint = f"{source}|{source.stat().st_size}|{source.stat().st_mtime_ns}"
    digest = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:24]
    folder = cache_dir() / digest
    folder.mkdir(parents=True, exist_ok=True)
    thumbnail = folder / "poster.png"
    proxy = folder / "preview.mp4"
    duration = max(0.0, media["duration_us"] / 1_000_000)
    seek = max(0.0, duration * 0.2)
    if not thumbnail.exists():
        _run_ffmpeg_asset([ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", f"{seek:.6f}",
                           "-i", str(source), "-frames:v", "1", "-vf",
                           "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2",
                           "-y", str(thumbnail)], "Membuat thumbnail")
    if not proxy.exists():
        _run_ffmpeg_asset([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(source),
                           "-map", "0:v:0", "-map", "0:a:0?", "-vf",
                           "fps=30,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2",
                           "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-c:a", "aac",
                           "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", "-y", str(proxy)],
                          "Membuat proxy preview")
    return {"thumbnail_path": str(thumbnail), "proxy_path": str(proxy), "warning": None}


def _run_ffmpeg_asset(args: list[str], action: str) -> None:
    try:
        completed = subprocess.run(args, capture_output=True, text=True, timeout=60 * 60, check=False)
    except subprocess.TimeoutExpired as exc:
        raise MediaToolError(f"{action}: batas waktu satu jam terlewati.") from exc
    if completed.returncode != 0:
        raise MediaToolError(f"{action}: {(completed.stderr or 'FFmpeg gagal.').strip()[-1000:]}")

