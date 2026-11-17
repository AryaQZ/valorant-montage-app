"""Generate local synthetic footage for repeatable import and render checks."""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import subprocess


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--duration", type=int, choices=(5, 30), default=5)
    args = parser.parse_args()
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        parser.error("FFmpeg is required to generate a synthetic video fixture.")
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    overlay_end = min(args.duration - 0.5, 3.0)
    filtergraph = ("drawbox=x=iw*0.72:y=ih*0.08:w=iw*0.24:h=ih*0.07:color=red@0.85:t=fill:"
                   f"enable='between(t,1,{overlay_end})'")
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
               "testsrc2=size=1280x720:rate=60", "-f", "lavfi", "-i",
               "sine=frequency=660:sample_rate=48000", "-vf", filtergraph,
               "-t", str(args.duration), "-c:v", "libx264", "-preset", "veryfast",
               "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-y", str(output)]
    result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=600)
    if result.returncode != 0:
        print(result.stderr[-2000:])
        return result.returncode
    print(f"Generated {output} ({args.duration}s, synthetic test pattern; not real VALORANT footage).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
