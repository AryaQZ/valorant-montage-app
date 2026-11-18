"""Local lightweight beat-grid estimation for supported music files."""

from __future__ import annotations

from array import array
from pathlib import Path
from typing import Any
import math
import shutil
import subprocess

from .media import MediaToolError
from .upstream import analyze_music_attacks


def analyze_music(path_value: str, *, max_minutes: int = 15) -> dict[str, Any]:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise MediaToolError("Analisis musik membutuhkan FFmpeg.")
    path = Path(path_value).expanduser().resolve(strict=True)
    if not path.is_file():
        raise MediaToolError("File musik tidak ditemukan.")
    sample_rate = 11_025
    args = [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(path), "-vn", "-ac", "1",
            "-ar", str(sample_rate), "-t", str(max_minutes * 60), "-f", "s16le", "-"]
    try:
        completed = subprocess.run(args, capture_output=True, timeout=max_minutes * 60 + 90, check=False)
    except subprocess.TimeoutExpired as exc:
        raise MediaToolError("Analisis musik melewati batas waktu.") from exc
    if completed.returncode != 0 or not completed.stdout:
        detail = completed.stderr.decode("utf-8", errors="replace")[-800:]
        raise MediaToolError(f"FFmpeg gagal membaca musik: {detail}")
    samples = array("h")
    samples.frombytes(completed.stdout[:len(completed.stdout) - len(completed.stdout) % 2])
    if samples.itemsize != 2:
        raise MediaToolError("Format PCM 16-bit tidak didukung oleh runtime ini.")
    if __import__("sys").byteorder != "little":
        samples.byteswap()
    block = 110  # about 10 ms at 11.025 kHz
    energies: list[float] = []
    for start in range(0, len(samples) - block + 1, block):
        total = 0
        for value in samples[start:start + block]:
            total += value * value
        energies.append(math.sqrt(total / block))
    if len(energies) < 100:
        raise MediaToolError("Audio terlalu pendek untuk membangun beat grid.")
    novelty = [0.0]
    for previous, current in zip(energies, energies[1:]):
        novelty.append(max(0.0, current - previous))
    mean = sum(novelty) / len(novelty)
    novelty = [value - mean for value in novelty]
    min_lag = 33  # about 180 BPM
    max_lag = min(100, len(novelty) // 3)  # about 60 BPM
    correlations: list[tuple[float, int]] = []
    for lag in range(min_lag, max_lag + 1):
        correlations.append((sum(a * b for a, b in zip(novelty[:-lag], novelty[lag:])), lag))
    if not correlations:
        raise MediaToolError("Belum cukup durasi untuk memperkirakan tempo.")
    waveform_count = min(480, len(energies))
    waveform_raw = []
    for index in range(waveform_count):
        start = index * len(energies) // waveform_count
        end = max(start + 1, (index + 1) * len(energies) // waveform_count)
        waveform_raw.append(math.sqrt(sum(value * value for value in energies[start:end]) / (end - start)))
    waveform_peak = max(waveform_raw, default=1.0) or 1.0
    waveform = [round(min(1.0, value / waveform_peak), 3) for value in waveform_raw]
    best_score, period = max(correlations)
    sorted_scores = sorted((score for score, _ in correlations), reverse=True)
    confidence = 0.0 if best_score <= 0 else min(1.0, best_score / max(best_score, sorted_scores[min(4, len(sorted_scores) - 1)] * 2.0))
    phase = max(range(period), key=lambda offset: sum(max(0.0, novelty[i]) for i in range(offset, len(novelty), period)))
    block_us = round(block * 1_000_000 / sample_rate)
    duration_us = round(len(samples) * 1_000_000 / sample_rate)
    bpm = round(60_000_000 / (period * block_us), 2)
    beats = []
    index = phase
    while index < len(novelty):
        time_us = index * block_us
        if time_us <= duration_us:
            beats.append({"marker_id": f"beat-{len(beats) + 1:05d}", "time_us": time_us,
                          "confidence": round(confidence, 3), "kind": "beat_candidate"})
        index += period
    result = {"bpm_estimate": bpm, "confidence": round(confidence, 3),
              "duration_us": duration_us, "sample_rate": sample_rate,
              "method": "10ms RMS energy novelty autocorrelation; beat candidates require review",
              "beat_grid": beats, "waveform": waveform}
    try:
        precise = analyze_music_attacks(str(path), result)
    except MediaToolError as exc:
        result["upstream_warning"] = str(exc)
    else:
        if precise:
            result.update(precise)
    return result
