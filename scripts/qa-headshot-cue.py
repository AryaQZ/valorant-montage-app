"""Measure the VALORANT kill-feed headshot icon locally, without attributing ownership."""

import argparse
import json
from pathlib import Path
import subprocess

import cv2
import numpy as np


def contiguous(indices):
    return np.split(indices, np.where(np.diff(indices) > 1)[0] + 1)


def measure(source: Path, start: float, duration: float) -> dict:
    game = Path(__file__).resolve().parents[1] / (
        "third_party/editing-gameplay-montages/skills/editing-gameplay-montages/scripts/games")
    profile = json.loads((game / "valorant.json").read_text(encoding="utf-8"))
    width, height = profile["frame"]
    left, top, box_width, box_height = profile["feed"]["region"]
    template = cv2.imread(str(game / profile["headshot"]["template"]), cv2.IMREAD_GRAYSCALE)
    if template is None:
        raise RuntimeError("Could not load the pinned headshot template.")
    template = template.astype(np.float32) / 255
    sample_rate = 4
    video = subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-ss", str(start), "-threads", "3", "-i", str(source),
        "-t", str(duration), "-vf", f"fps={sample_rate},scale={width}:{height},crop={box_width}:{box_height}:{left}:{top}",
        "-an", "-threads", "1", "-c:v", "rawvideo", "-pix_fmt", "bgr24", "-f", "rawvideo", "-",
    ], capture_output=True, check=True, timeout=120)
    frames = np.frombuffer(video.stdout, np.uint8).reshape(-1, box_height, box_width, 3)
    rows = []
    for index, frame in enumerate(frames):
        hue, saturation, value = cv2.split(cv2.cvtColor(frame, cv2.COLOR_BGR2HSV))
        red = ((hue <= 12) | (hue >= 170)) & (saturation >= 90) & (value >= 105)
        teal = (hue >= 70) & (hue <= 112) & (saturation >= 55) & (value >= 100)
        lime = (hue >= 22) & (hue <= 45) & (saturation >= 90) & (value >= 180)
        for row in contiguous(np.flatnonzero(red.sum(1) > 25)):
            if not 10 <= len(row) <= 44:
                continue
            lo, hi = int(row[0]), int(row[-1]) + 1
            red_anchor = max(contiguous(np.flatnonzero(red[lo:hi].mean(0) >= 0.45)), key=len)
            if len(red_anchor) < 40:
                continue
            anchor = int(red_anchor[0])
            if teal[lo:hi, :anchor].sum() < 400:
                continue
            glyph = frame[max(0, lo - 9):hi + 10, max(0, anchor - 90):anchor + 8]
            white = (glyph.min(2) >= profile["headshot"]["white_min"]).astype(np.float32)
            if any(actual < expected for actual, expected in zip(white.shape, template.shape)):
                continue
            score = float(cv2.matchTemplate(white, template, cv2.TM_CCOEFF_NORMED).max())
            rows.append({"time_seconds": start + index / sample_rate, "row_y": top + lo,
                         "headshot_score": round(score, 3), "lime_pixels": int(lime[lo:hi].sum())})
    return {"source": source.name, "sample_fps": sample_rate, "rows": rows}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--start", type=float, default=0)
    parser.add_argument("--duration", type=float, default=12)
    args = parser.parse_args()
    if args.start < 0 or not 0 < args.duration <= 60:
        parser.error("Use a nonnegative start and a duration between 0 and 60 seconds.")
    report = measure(args.source.resolve(strict=True), args.start, args.duration)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2)
        stream.write("\n")
