from pathlib import Path
import io
import json
import tempfile
import unittest
from unittest.mock import patch

from services.worker import upstream


class UpstreamDetectionTests(unittest.TestCase):
    def test_vfr_source_frame_index_uses_packet_pts_instead_of_average_fps(self) -> None:
        frame, method = upstream._nearest_source_frame([0.0, 0.019, 0.041, 0.060], 39_000, 2)

        self.assertEqual(frame, 2)
        self.assertEqual(method, "ffprobe_packet_pts")

    def test_kill_review_ingest_uses_upstream_fast_mode(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.mp4"
            source.write_bytes(b"fixture")
            app_data = root / "appdata"
            media = {
                "path": str(source),
                "duration_us": 10_000_000,
                "video": {"avg_frame_rate": (60, 1), "start_time_us": 0},
            }
            runs: list[tuple[str, list[str]]] = []

            def fake_run(python: str, script: Path, args: list[str], cwd: Path, timeout: int,
                         *, allow_nonzero: bool = False) -> str:
                runs.append((script.name, list(args)))
                if script.name == "kills_auto.py":
                    work = Path(cwd)
                    (work / "src").mkdir(parents=True, exist_ok=True)
                    (work / "kills.json").write_text("{}", encoding="utf-8")
                    (work / "src" / "ingest.json").write_text('{"c1":{"t0":0}}', encoding="utf-8")
                return ""

            with (patch.object(upstream, "upstream_python", return_value="python"),
                  patch.object(upstream, "probe_media", return_value=media),
                  patch.object(upstream, "app_data_dir", return_value=app_data),
                  patch.object(upstream, "_run", side_effect=fake_run)):
                result = upstream.detect_kills(str(source), "media-1", 10_000_000)

            self.assertEqual(runs[0], ("ingest.py", ["--fast"]))
            self.assertEqual(result["candidate_count"], 0)

    def test_candidate_retains_upstream_shot_verification_rank_and_context(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.mp4"
            source.write_bytes(b"fixture")
            app_data = root / "appdata"
            media = {"path": str(source), "duration_us": 10_000_000,
                     "video": {"avg_frame_rate": (60, 1), "start_time_us": 0}}

            def fake_run(python: str, script: Path, args: list[str], cwd: Path, timeout: int,
                         *, allow_nonzero: bool = False) -> str:
                work = Path(cwd)
                if script.name == "kills_auto.py":
                    (work / "src").mkdir(parents=True, exist_ok=True)
                    (work / "src" / "ingest.json").write_text('{"c1":{"t0":0}}', encoding="utf-8")
                    (work / "kills.json").write_text(
                        '{"1":{"clip":"c1","K":300,"feed":308,"conf":"high",'
                        '"method":"ammo","how":"ammo","verified":true,"headshot":0.82,'
                        '"visible":{"covered":0,"std":2.0,"edge":3.0}},'
                        '"2":{"clip":"c1","K":500,"feed":508,"conf":"guess",'
                        '"method":"feed-lag","how":"guess","verified":false,"headshot":0.84,'
                        '"visible":{"covered":0,"std":2.0,"edge":3.0}}}', encoding="utf-8")
                elif script.name == "kverify.py":
                    output_prefix = Path(args[args.index("--out") + 1])
                    output_prefix.parent.mkdir(parents=True, exist_ok=True)
                    output_prefix.with_suffix(".json").write_text(
                        '{"c1@300":{"clip":"c1","K":300,"verdict":"verified",'
                        '"how":"ammo","conf":"high","why":"ammo step on K","K_sure":null},'
                        '"c1@500":{"clip":"c1","K":500,"verdict":"suspect",'
                        '"how":null,"conf":"guess","why":"nothing on K","K_sure":null}}',
                        encoding="utf-8")
                elif script.name == "kill_rank.py":
                    (work / "kill_rank.json").write_text(
                        '{"kills":[{"id":"1","score":4.5,"reasons":["headshot","ace"],'
                        '"run":[2,2],"rank":1},{"id":"2","score":2.0,"reasons":["headshot","K guess"],'
                        '"run":[1,1],"rank":2}],"duplicates_dropped":[]}', encoding="utf-8")
                return ""

            with (patch.object(upstream, "upstream_python", return_value="python"),
                  patch.object(upstream, "probe_media", return_value=media),
                  patch.object(upstream, "app_data_dir", return_value=app_data),
                  patch.object(upstream, "_run", side_effect=fake_run)):
                result = upstream.detect_kills(str(source), "media-1", 10_000_000)

            candidate = result["candidates"][0]
            self.assertTrue(candidate["verified_by_upstream"])
            self.assertEqual(candidate["suggested_tags"], ["headshot"])
            self.assertEqual(candidate["source_time_us"], 5_000_000)
            evidence = candidate["evidence"][0]
            self.assertEqual(evidence["shot_verification"]["verdict"], "verified")
            self.assertEqual(evidence["kill_rank"]["score"], 4.5)
            self.assertEqual(evidence["headshot_score"], 0.82)
            unverified = result["candidates"][1]
            self.assertFalse(unverified["verified_by_upstream"])
            self.assertEqual(unverified["suggested_tags"], [])
            self.assertEqual(unverified["evidence"][0]["shot_verification"]["verdict"], "suspect")

    def test_ammo_candidate_corrects_one_frame_only_with_unique_verified_neighbor(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.mp4"
            source.write_bytes(b"fixture")
            app_data = root / "appdata"
            media = {"path": str(source), "duration_us": 10_000_000,
                     "video": {"avg_frame_rate": (60, 1), "start_time_us": 0}}
            neighbor_checks: list[str] = []
            ranking_saw_corrected_k = False

            def fake_run(python: str, script: Path, args: list[str], cwd: Path, timeout: int,
                         *, allow_nonzero: bool = False) -> str:
                nonlocal ranking_saw_corrected_k
                work = Path(cwd)
                if script.name == "kills_auto.py":
                    (work / "src").mkdir(parents=True, exist_ok=True)
                    (work / "src" / "ingest.json").write_text('{"c1":{"t0":0}}', encoding="utf-8")
                    (work / "kills.json").write_text(
                        '{"1":{"clip":"c1","K":300,"feed":308,"conf":"low",'
                        '"method":"ammo+audio","how":"ammo-loose","verified":false,"headshot":0.82}}',
                        encoding="utf-8")
                elif script.name == "kverify.py":
                    target = args[0] if args and args[0].startswith("c1@") else None
                    output_prefix = Path(args[args.index("--out") + 1])
                    output_prefix.parent.mkdir(parents=True, exist_ok=True)
                    if target is None:
                        result = {"c1@300": {"clip": "c1", "K": 300, "verdict": "suspect",
                                               "how": None, "why": "ammo step stronger on K+1"}}
                    else:
                        neighbor_checks.append(target)
                        candidate_k = int(target.split("@", 1)[1])
                        verdict = "verified" if candidate_k == 301 else "suspect"
                        result = {target: {"clip": "c1", "K": candidate_k, "verdict": verdict,
                                           "how": "ammo" if verdict == "verified" else None,
                                           "why": "ammo step on K" if verdict == "verified" else "nothing on K"}}
                    output_prefix.with_suffix(".json").write_text(json.dumps(result), encoding="utf-8")
                elif script.name == "kill_rank.py":
                    corrected = json.loads((work / "kills.json").read_text(encoding="utf-8"))["1"]
                    ranking_saw_corrected_k = corrected["K"] == 301 and corrected["K_was"] == 300
                    (work / "kill_rank.json").write_text(
                        '{"kills":[{"id":"1","score":3.0,"reasons":["headshot"],'
                        '"run":[1,1],"rank":1}],"duplicates_dropped":[]}', encoding="utf-8")
                return ""

            with (patch.object(upstream, "upstream_python", return_value="python"),
                  patch.object(upstream, "probe_media", return_value=media),
                  patch.object(upstream, "app_data_dir", return_value=app_data),
                  patch.object(upstream, "_source_packet_timestamps", return_value=[]),
                  patch.object(upstream, "_run", side_effect=fake_run)):
                result = upstream.detect_kills(str(source), "media-1", 10_000_000)

            self.assertEqual(neighbor_checks, ["c1@299", "c1@301"])
            self.assertTrue(ranking_saw_corrected_k)
            candidate = result["candidates"][0]
            self.assertTrue(candidate["verified_by_upstream"])
            self.assertEqual(candidate["source_time_us"], 5_016_667)
            self.assertEqual(candidate["confidence_label"], "medium")
            self.assertEqual(candidate["evidence"][0]["working_frame_60"], 301)
            self.assertEqual(candidate["evidence"][0]["original_working_frame_60"], 300)
            self.assertEqual(candidate["evidence"][0]["shot_verification"]["frame_correction"],
                             {"from": 300, "to": 301, "reason": "ammo step on K", "method": "ammo"})

    def test_vfr_normalization_uses_upstream_exact_timestamp_aware_ingest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "capture.mp4"
            source.write_bytes(b"source")
            app_data = root / "appdata"
            model = root / "model"
            model.mkdir()
            (model / "flownet.bin").write_bytes(b"model")

            def fake_stage(python: str, script: Path, args: list[str], cwd: Path, timeout: int,
                           cancel_event: object = None) -> str:
                work = Path(cwd)
                if script.name == "ingest.py":
                    self.assertEqual(args, ["--exact", "--convert"])
                    (work / "src").mkdir(parents=True, exist_ok=True)
                    (work / "src" / "c1.mkv").write_bytes(b"normalized")
                    (work / "src" / "ingest.json").write_text('{"c1":{"t0":1.25}}', encoding="utf-8")
                return ""

            with (patch.object(upstream, "upstream_python", return_value="python"),
                  patch.object(upstream, "UPSTREAM_MODEL", model),
                  patch.object(upstream, "app_data_dir", return_value=app_data),
                  patch.object(upstream, "_run_upstream_cancellable", side_effect=fake_stage)):
                result = upstream._normalize_vfr_source(source, "source-sha")

            self.assertIsNotNone(result)
            assert result is not None
            normalized, origin_us, normalized_sha = result
            self.assertEqual(normalized, next((app_data / "upstream" / "normalized").glob("*/src/c1.mkv")))
            self.assertEqual(origin_us, 1_250_000)
            self.assertTrue(normalized_sha)

    def test_vfr_segment_is_rife_rendered_from_normalized_60_fps_frames(self) -> None:
        class Process:
            returncode = 0
            stderr = io.BytesIO()

            def poll(self) -> int:
                return 0

            def wait(self, timeout: int | None = None) -> int:
                return 0

            def terminate(self) -> None:
                pass

            def kill(self) -> None:
                pass

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "vfr.mp4"
            source.write_bytes(b"source")
            normalized = root / "normalized.mkv"
            normalized.write_bytes(b"normalized")
            model = root / "model"
            model.mkdir()
            (model / "flownet.bin").write_bytes(b"model")
            captured: list[list[str]] = []

            def fake_popen(args: list[str], **kwargs: object) -> Process:
                captured.append(args)
                output = Path(args[args.index("--output") + 1])
                output.write_bytes(b"rendered r ife segment" * 100)
                return Process()

            media_source = {"path": str(source), "video": {"avg_frame_rate": (50, 1),
                             "r_frame_rate": (60, 1), "start_time_us": 0,
                             "timestamp_behavior": {"variable_frame_rate": True}}}
            segment = {"source_start_us": 2_000_000, "source_end_us": 3_000_000,
                       "speed_num": 1, "speed_den": 2, "direction": "forward"}
            with (patch.object(upstream, "upstream_python", return_value="python"),
                  patch.object(upstream, "UPSTREAM_MODEL", model),
                  patch.object(upstream, "app_data_dir", return_value=root / "appdata"),
                  patch.object(upstream, "_normalize_vfr_source", return_value=(normalized, 1_000_000, "normalized-sha")),
                  patch.object(upstream, "_count_video_frames", return_value=10),
                  patch.object(upstream.subprocess, "Popen", side_effect=fake_popen),
                  patch.object(upstream, "_rife_gpu_index", return_value="0")):
                asset = upstream.render_rife_segment(media_source, segment, 144, 10)

            self.assertIsNotNone(asset)
            assert captured
            args = captured[0]
            self.assertEqual(args[args.index("--source") + 1], str(normalized))
            self.assertEqual(args[args.index("--start-us") + 1], "1000000")
            self.assertEqual(args[args.index("--end-us") + 1], "2000000")
            self.assertEqual(args[args.index("--source-fps-num") + 1], "60")


if __name__ == "__main__":
    unittest.main()
