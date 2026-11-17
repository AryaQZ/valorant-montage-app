"""Real FFmpeg integration check; it skips with a reason if local binaries are absent."""

import shutil
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path

from services.worker.render import render_montage
from services.worker.schema import add_timeline_clip, new_project


def _has_encoder() -> bool:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        return False
    result = subprocess.run([ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True, check=False)
    return "libx264" in (result.stdout + result.stderr)


@unittest.skipUnless(_has_encoder(), "FFmpeg/FFprobe with libx264 unavailable; real render path not runnable here")
class RenderEndToEndTests(unittest.TestCase):
    def test_two_sources_three_manual_events_render_1440p144_and_write_qc(self) -> None:
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg is not None
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [root / "source-a.mp4", root / "source-b.mp4"]
            for index, path in enumerate(paths):
                hue = 0 if index == 0 else 70
                command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                           f"testsrc2=size=320x180:rate=60, hue=h={hue}", "-f", "lavfi", "-i",
                           f"sine=frequency={600 + index * 120}:sample_rate=48000", "-t", "2",
                           "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                           "-c:a", "aac", "-shortest", str(path)]
                subprocess.run(command, capture_output=True, check=True, timeout=90)
            project = new_project("Render smoke")
            for index, path in enumerate(paths):
                project["sources"].append({"media_id": f"media-{index}", "path": str(path),
                                           "duration_us": 2_000_000, "has_audio": True,
                                           "video": {"avg_frame_rate": (60, 1)}})
            annotations = [("media-0", 200_000, 400_000, 800_000),
                           ("media-1", 300_000, 500_000, 900_000),
                           ("media-0", 1_000_000, 1_200_000, 1_600_000)]
            for index, (media_id, start, impact, end) in enumerate(annotations):
                project["events"].append({"event_id": f"event-{index}", "source_media_id": media_id,
                                          "source_time_us": impact, "source_frame": round(impact * 60 / 1_000_000),
                                          "in_us": start, "out_us": end, "evidence": [{"type": "user_annotation"}],
                                          "owner": "player", "confidence": 1.0, "tags": ["multikill"],
                                          "cluster_id": None, "rating": None, "is_user_override": True})
                add_timeline_clip(project, f"event-{index}")
            output = root / "montage.mp4"
            progresses: list[float] = []
            result = render_montage(project, str(output), rights_acknowledged=False,
                                    ownership_acknowledged=False, cancel_event=threading.Event(),
                                    progress=lambda fraction, _message: progresses.append(fraction))
            self.assertTrue(output.is_file())
            self.assertTrue(Path(result["project_sidecar"]).is_file())
            self.assertTrue(Path(result["qa_json"]).is_file())
            self.assertTrue(Path(result["qa_html"]).is_file())
            self.assertEqual(result["qa"]["actual"]["width"], 2560)
            self.assertEqual(result["qa"]["actual"]["height"], 1440)
            self.assertEqual(result["qa"]["actual"]["fps"], (144, 1))
            self.assertEqual(result["qa"]["actual"]["frames_counted"], 258)
            self.assertTrue(progresses)


if __name__ == "__main__":
    unittest.main()
