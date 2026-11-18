"""Render one CFR timeline segment with the upstream RIFE v4.25 implementation.

This helper intentionally accepts only constant-frame-rate sources. The master renderer
uses its timestamp-aware FFmpeg path for VFR material; forcing an approximate frame-index
mapping onto VFR footage would shift kill frames.
"""

from __future__ import annotations

import argparse
import math
import os
from pathlib import Path
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--start-us", required=True, type=int)
    parser.add_argument("--end-us", required=True, type=int)
    parser.add_argument("--stream-start-us", required=True, type=int)
    parser.add_argument("--source-fps-num", required=True, type=int)
    parser.add_argument("--source-fps-den", required=True, type=int)
    parser.add_argument("--speed-num", required=True, type=int)
    parser.add_argument("--speed-den", required=True, type=int)
    parser.add_argument("--output-frames", required=True, type=int)
    parser.add_argument("--output-fps", required=True, type=int)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    if args.source_fps_num <= 0 or args.source_fps_den <= 0 or args.output_frames <= 0:
        raise ValueError("Invalid frame count or source frame rate.")
    if args.speed_num <= 0 or args.speed_den <= 0:
        raise ValueError("Invalid speed ratio.")

    configured_root = os.environ.get("VMS_UPSTREAM_ROOT")
    if configured_root:
        root = Path(configured_root)
    else:
        root = Path(__file__).resolve().parents[2] / "third_party" / "editing-gameplay-montages" / "skills" / "editing-gameplay-montages"
    scripts = root / "scripts"
    sys.path.insert(0, str(scripts))
    import cv2
    import numpy as np
    import rifeutil

    src_fps = args.source_fps_num / args.source_fps_den
    speed = args.speed_num / args.speed_den
    source_start = args.start_us / 1_000_000
    source_end = args.end_us / 1_000_000
    stream_start = args.stream_start_us / 1_000_000
    if source_end <= source_start or speed >= 1.0:
        raise ValueError("RIFE segment must be a forward slow-motion segment with a valid source range.")

    cap = cv2.VideoCapture(args.source)
    if not cap.isOpened():
        raise RuntimeError("OpenCV could not open the local source video.")
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    reported_fps = float(cap.get(cv2.CAP_PROP_FPS))
    if width < 2 or height < 2 or abs(reported_fps - src_fps) > max(0.02, src_fps * 0.0005):
        cap.release()
        raise RuntimeError(f"OpenCV frame metadata does not match the project ({reported_fps:g} vs {src_fps:g} FPS).")

    # Sample packet timestamps in this interval first. RIFE is only used when source PTS
    # confirm the rational CFR grid that VideoCapture frame indices represent.
    ffprobe = shutil_which("ffprobe")
    if not ffprobe:
        cap.release()
        raise RuntimeError("FFprobe is required to verify CFR before using RIFE.")
    verify_start = max(0.0, source_start - stream_start - 0.15)
    # ffprobe seeks to the preceding keyframe, which can be several seconds before the
    # requested timestamp. Read a bounded GOP margin, then inspect only the target range.
    verify_duration = source_end - source_start + 10.30
    pts_args = [ffprobe, "-v", "error", "-select_streams", "v:0", "-read_intervals",
                f"{verify_start:.6f}%+{verify_duration:.6f}", "-show_frames",
                "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0", args.source]
    pts_result = subprocess.run(pts_args, capture_output=True, text=True, timeout=900, check=False)
    if pts_result.returncode != 0:
        cap.release()
        raise RuntimeError("FFprobe could not read source frame timestamps for RIFE.")
    timestamps: list[float] = []
    for line in pts_result.stdout.splitlines():
        try:
            timestamps.append(float(line.split(",", 1)[0]))
        except ValueError:
            continue
    expected_interval = 1.0 / src_fps
    relevant = [time for time in timestamps if verify_start - 0.01 <= time <= verify_start + verify_duration + 0.01]
    deltas = [b - a for a, b in zip(relevant, relevant[1:]) if b > a]
    if len(deltas) < 2 or max(abs(delta - expected_interval) for delta in deltas) > 0.0025:
        cap.release()
        raise RuntimeError("Source timestamps are variable or too sparse for exact frame-indexed RIFE; use the timestamp-aware fallback.")

    first_source_frame = max(0, math.floor((source_start - stream_start) * src_fps) - 2)
    last_target = source_start + (args.output_frames - 1) * speed / args.output_fps
    last_source_frame = math.ceil((last_target - stream_start) * src_fps) + 2
    cap.set(cv2.CAP_PROP_POS_FRAMES, first_source_frame)
    current_frame_index = int(round(cap.get(cv2.CAP_PROP_POS_FRAMES)))
    if current_frame_index > first_source_frame:
        cap.set(cv2.CAP_PROP_POS_FRAMES, first_source_frame)
        current_frame_index = first_source_frame
    frame_cache: dict[int, "np.ndarray"] = {}
    rife = rifeutil.load()
    tween = rifeutil.Tween(rife)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil_which("ffmpeg")
    if not ffmpeg:
        cap.release()
        raise RuntimeError("FFmpeg is required to write the lossless RIFE segment cache.")
    encoder = subprocess.Popen(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
         "-s:v", f"{width}x{height}", "-r", f"{args.output_fps}/1", "-i", "pipe:0", "-an",
         "-c:v", "ffv1", "-level", "3", "-coder", "1", "-context", "1", "-g", "1",
         "-pix_fmt", "bgr0", "-f", "matroska", str(output)],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    try:
        assert encoder.stdin is not None
        for output_index in range(args.output_frames):
            source_time = source_start + output_index * speed / args.output_fps
            position = (source_time - stream_start) * src_fps
            lo = max(0, math.floor(position))
            hi = lo + 1
            while current_frame_index <= min(hi, last_source_frame):
                ok, frame = cap.read()
                if not ok:
                    break
                frame_cache[current_frame_index] = frame
                current_frame_index += 1
            if lo not in frame_cache:
                raise RuntimeError(f"Source frame {lo} could not be decoded for RIFE.")
            first = frame_cache[lo]
            if hi in frame_cache:
                second = frame_cache[hi]
                fraction = max(0.0, min(1.0, position - lo))
                nearest_error = min(fraction, 1.0 - fraction) / src_fps
                if nearest_error <= 0.0015:
                    rendered = first if fraction <= 0.5 else second
                else:
                    rendered = tween(first, second, fraction, tag=(lo, hi))
            else:
                rendered = first
            encoder.stdin.write(rendered.tobytes())
            for old_index in tuple(frame_cache):
                if old_index < lo:
                    del frame_cache[old_index]
        encoder.stdin.close()
        return_code = encoder.wait(timeout=900)
        if return_code != 0:
            detail = encoder.stderr.read().decode("utf-8", errors="replace") if encoder.stderr else ""
            raise RuntimeError(f"Lossless RIFE cache encode failed: {detail[-1600:]}")
    finally:
        cap.release()
        if encoder.poll() is None:
            encoder.kill()
            encoder.wait(timeout=5)
        if encoder.stderr:
            encoder.stderr.close()
        rifeutil.finish(0)
    return 0


def shutil_which(program: str) -> str | None:
    import shutil
    return shutil.which(program)


if __name__ == "__main__":
    raise SystemExit(main())
