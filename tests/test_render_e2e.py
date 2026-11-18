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
            music_path = root / "synthetic-click-track.wav"
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                            "sine=frequency=880:sample_rate=48000:duration=3", "-c:a", "pcm_s16le",
                            str(music_path)], capture_output=True, check=True, timeout=30)
            project = new_project("Render smoke")
            # This fixture validates the renderer's timestamp mapping with
            # manually authored markers; it does not request a music director
            # or the multi-kill Smooth/Clean effect profile. The separate
            # quality-gate tests cover that mandatory edit floor.
            project["settings"]["beat_sync_priority"] = 0
            project["settings"]["effects_intensity"] = 0
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
            project["events"].append({"event_id": "event-grouped", "source_media_id": "media-0",
                                      "source_time_us": 500_000, "source_frame": 30,
                                      "in_us": 200_000, "out_us": 800_000,
                                      "evidence": [{"type": "user_annotation"}], "owner": "player",
                                      "confidence": 1.0, "tags": ["multikill"], "cluster_id": "cluster-1",
                                      "rating": None, "is_user_override": True})
            project["timeline"][0]["included_event_ids"] = ["event-0", "event-grouped"]
            project["music"] = {"path": str(music_path), "filename": music_path.name, "duration_us": 3_000_000,
                                 "bpm_estimate": 120.0, "confidence": 1.0, "sample_rate": 48_000,
                                 "beat_grid": [
                                     {"marker_id": "synthetic-hit-1", "time_us": 201_389, "confidence": 1.0,
                                      "kind": "beat_candidate"},
                                     {"marker_id": "synthetic-hit-grouped", "time_us": 298_611, "confidence": 1.0,
                                      "kind": "beat_candidate"},
                                     {"marker_id": "synthetic-hit-2", "time_us": 798_611, "confidence": 1.0,
                                      "kind": "beat_candidate"},
                                     {"marker_id": "synthetic-hit-3", "time_us": 1_395_833, "confidence": 1.0,
                                      "kind": "beat_candidate"}],
                                 "method": "synthetic fixture; known 144 FPS frame impacts", "rights_acknowledged": True,
                                 "offset_us": 0}
            output = root / "montage.mp4"
            progresses: list[float] = []
            result = render_montage(project, str(output), rights_acknowledged=True,
                                    ownership_acknowledged=False, cancel_event=threading.Event(),
                                    progress=lambda fraction, _message: progresses.append(fraction))
            self.assertTrue(output.is_file())
            self.assertTrue(Path(result["project_sidecar"]).is_file())
            self.assertTrue(Path(result["qa_json"]).is_file())
            self.assertTrue(Path(result["qa_html"]).is_file())
            self.assertEqual(result["qa"]["status"], "PASS")
            self.assertEqual(result["qa"]["actual"]["width"], 2560)
            self.assertEqual(result["qa"]["actual"]["height"], 1440)
            self.assertEqual(result["qa"]["actual"]["fps"], (144, 1))
            self.assertEqual(result["qa"]["actual"]["frames_counted"], 258)
            self.assertEqual(result["qa"]["actual"]["frame_count_source"], "ffprobe_show_frames")
            self.assertEqual(result["qa"]["render_manifest"]["render_version"], 2)
            self.assertEqual(result["qa"]["render_manifest"]["master_profile"],
                             {"width": 2560, "height": 1440, "fps_num": 144, "fps_den": 1})
            self.assertEqual(result["qa"]["render_manifest"]["audio"]["music_ducking"], "sidechaincompress")
            self.assertEqual(result["qa"]["beat_sync"]["frame_accurate_count"], 0)
            self.assertIsNone(result["qa"]["beat_sync"]["max_delta_us"])
            self.assertEqual(result["qa"]["feature_gates"]["beat_sync"]["status"], "NOT_REQUESTED")
            self.assertEqual(result["qa"]["render_manifest"]["effects_applied"][0]["included_event_ids"],
                             ["event-0", "event-grouped"])
            self.assertEqual(set(result["qa"]["render_manifest"]["effects_applied"][0]["impact_output_frames"]),
                             {"event-0", "event-grouped"})
            self.assertTrue(progresses)


if __name__ == "__main__":
    unittest.main()
