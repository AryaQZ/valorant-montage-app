"""Regression tests for final-file quality checks and unavailable probe tools."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from services.worker.quality import (_audit_beat_sync, _detect_intervals, _feature_gates,
                                     find_near_duplicate_plays, missing_default_editing_requirements,
                                     run_quality_control)
from services.worker.render import preflight
from services.worker.schema import add_timeline_clip, new_project


class QualityControlTests(unittest.TestCase):
    def _project(self) -> dict:
        project = new_project("QC fixture")
        # The fixture does not request a musical edit. Tests that exercise beat
        # sync opt in explicitly and provide measured attacks.
        project["settings"]["beat_sync_priority"] = 0
        project["sources"].append({"media_id": "media-12345678", "path": "unused.mp4",
                                   "duration_us": 2_000_000, "has_audio": True,
                                   "video": {"avg_frame_rate": (60, 1)}})
        project["events"].append({"event_id": "event-12345678", "source_media_id": "media-12345678",
                                   "source_time_us": 1_000_000, "source_frame": 60,
                                   "in_us": 500_000, "out_us": 1_500_000,
                                   "evidence": [{"type": "user_annotation"}], "owner": "player",
                                   "confidence": 1.0, "tags": [], "cluster_id": None,
                                   "rating": None, "is_user_override": True})
        clip = add_timeline_clip(project, "event-12345678")
        timeline_hash = hashlib.sha256(json.dumps(project["timeline"], ensure_ascii=False,
                                                   sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        project["render_manifest"] = {
            "render_version": 2,
            "timeline_sha256": timeline_hash,
            "master_profile": {"width": 2560, "height": 1440, "fps_num": 144, "fps_den": 1},
            "render_mode": "master",
            "audio": {"sample_rate": 48000, "music_ducking": "off"},
            "effects_applied": [{"clip_id": clip["clip_id"], "event_id": "event-12345678",
                                  "included_event_ids": ["event-12345678"],
                                  "impact_output_frames": {"event-12345678": 72},
                                  "types": ["impact_zoom"]}],
            "interpolation": {"rife_segments": []},
        }
        return project

    def test_frame_count_falls_back_to_full_pts_enumeration_and_tool_errors_warn(self) -> None:
        project = self._project()
        expected_frames = project["timeline"][0]["duration_frames"]
        media = {"video": {"width": 2560, "height": 1440, "avg_frame_rate": (144, 1)},
                 "has_audio": True, "audio": [{"duration_us": 1_000_000, "start_time_us": 0}],
                 "duration_us": 1_000_000}
        timing = {"monotonic": True, "cfr": True, "frames": expected_frames,
                  "max_delta_error_us": 0.0, "first_pts_s": 0.0, "last_pts_s": 0.993056}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "fixture.mp4"
            output.write_bytes(b"fixture")
            with (patch("services.worker.quality.probe_media", return_value=media),
                  patch("services.worker.quality._count_frames", return_value=None) as count_frames,
                  patch("services.worker.quality._audit_pts", return_value=timing),
                  patch("services.worker.quality._max_duplicate_run", return_value=1),
                  patch("services.worker.quality._detect_intervals", side_effect=[None, None]),
                  patch("services.worker.quality._measure_peak", return_value=-1.0)):
                report = run_quality_control(str(output), project)
        count_frames.assert_not_called()

        checks = report["checks"]
        frame_check = next(item for item in checks if item["message"].startswith("Jumlah frame terhitung"))
        black_check = next(item for item in checks if item["message"].startswith("Black segments"))
        silence_check = next(item for item in checks if item["message"].startswith("Silence"))
        self.assertEqual(report["actual"]["frames_counted"], expected_frames)
        self.assertEqual(report["actual"]["frame_count_source"], "ffprobe_show_frames")
        self.assertEqual(frame_check["status"], "PASS")
        self.assertEqual(black_check["status"], "WARN")
        self.assertEqual(silence_check["status"], "WARN")
        self.assertEqual(report["status"], "WARN")

    def test_legacy_v1_manifest_and_unknown_audio_start_are_reported_without_false_failure(self) -> None:
        project = self._project()
        project["render_manifest"]["render_version"] = 1
        project["render_manifest"]["effects_applied"][0].pop("included_event_ids")
        project["render_manifest"]["effects_applied"][0].pop("impact_output_frames")
        expected_frames = project["timeline"][0]["duration_frames"]
        media = {"video": {"width": 2560, "height": 1440, "avg_frame_rate": (144, 1)},
                 "has_audio": True, "audio": [{"duration_us": 1_000_000, "start_time_us": None}],
                 "duration_us": 1_000_000}
        timing = {"monotonic": True, "cfr": True, "frames": expected_frames,
                  "max_delta_error_us": 0.0, "first_pts_s": 0.0, "last_pts_s": 0.993056}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "legacy.mp4"
            output.write_bytes(b"fixture")
            with (patch("services.worker.quality.probe_media", return_value=media),
                  patch("services.worker.quality._count_frames", return_value=None),
                  patch("services.worker.quality._audit_pts", return_value=timing),
                  patch("services.worker.quality._max_duplicate_run", return_value=1),
                  patch("services.worker.quality._detect_intervals", return_value=[]),
                  patch("services.worker.quality._measure_peak", return_value=-1.0)):
                report = run_quality_control(str(output), project)

        audio_check = next(item for item in report["checks"] if item["message"].startswith("Audio mulai"))
        self.assertEqual(report["actual"]["frame_count_source"], "ffprobe_show_frames")
        self.assertEqual(audio_check["status"], "WARN")
        self.assertEqual(report["status"], "WARN")

    def test_missing_ffmpeg_filter_tool_is_not_reported_as_no_intervals(self) -> None:
        with patch("services.worker.quality.shutil.which", return_value=None):
            result = _detect_intervals(Path("unused.mp4"), "blackdetect", r"black_start:([0-9.]+)")
        self.assertIsNone(result)

    def test_unavailable_audio_peak_and_manifest_only_effects_need_review(self) -> None:
        project = self._project()
        media = {"video": {"width": 2560, "height": 1440, "avg_frame_rate": (144, 1)},
                 "has_audio": True, "audio": [{"duration_us": 1_000_000, "start_time_us": 0}],
                 "duration_us": 1_000_000}
        timing = {"monotonic": True, "cfr": True, "frames": 144, "max_delta_error_us": 0,
                  "first_pts_s": 0.0, "last_pts_s": 143 / 144}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "fixture.mp4"
            output.touch()
            with (patch("services.worker.quality.probe_media", return_value=media),
                  patch("services.worker.quality._audit_pts", return_value=timing),
                  patch("services.worker.quality._max_duplicate_run", return_value=1),
                  patch("services.worker.quality._detect_intervals", return_value=[]),
                  patch("services.worker.quality._measure_peak", return_value=None)):
                report = run_quality_control(str(output), project)
        self.assertEqual(next(check for check in report["checks"] if "Peak audio tidak" in check["message"])["status"], "WARN")
        self.assertEqual(report["feature_gates"]["visual_effects"]["status"], "MANIFEST_ONLY")
        self.assertEqual(report["status"], "WARN")

    def test_requested_beat_sync_without_music_or_measured_attacks_fails(self) -> None:
        project = self._project()
        project["settings"]["beat_sync_priority"] = 0.75
        expected_frames = project["timeline"][0]["duration_frames"]
        media = {"video": {"width": 2560, "height": 1440, "avg_frame_rate": (144, 1)},
                 "has_audio": True, "audio": [{"duration_us": 1_000_000, "start_time_us": 0}],
                 "duration_us": 1_000_000}
        timing = {"monotonic": True, "cfr": True, "frames": expected_frames,
                  "max_delta_error_us": 0.0, "first_pts_s": 0.0, "last_pts_s": 0.993056}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "missing-beat-source.mp4"
            output.write_bytes(b"fixture")
            with (patch("services.worker.quality.probe_media", return_value=media),
                  patch("services.worker.quality._count_frames", return_value=None),
                  patch("services.worker.quality._audit_pts", return_value=timing),
                  patch("services.worker.quality._max_duplicate_run", return_value=1),
                  patch("services.worker.quality._detect_intervals", return_value=[]),
                  patch("services.worker.quality._measure_peak", return_value=-1.0)):
                report = run_quality_control(str(output), project)

        self.assertEqual(report["feature_gates"]["beat_sync"]["status"], "REQUESTED_BUT_MISSING")
        self.assertEqual(report["feature_gates"]["music"]["status"], "REQUESTED_BUT_MISSING")
        self.assertEqual(report["status"], "FAIL")
        beat_check = next(item for item in report["checks"] if item["message"].startswith("beat_sync:"))
        self.assertEqual(beat_check["status"], "FAIL")

    def test_measured_attack_gate_succeeds_only_when_impact_is_aligned(self) -> None:
        project = self._project()
        project["settings"]["beat_sync_priority"] = 0.75
        project["music"] = {"path": "song.wav", "offset_us": 0,
                             "method": "upstream beat_hits.py: 44.1 kHz sample-domain attack timing",
                             "beat_grid": [{"marker_id": "attack-1", "time_us": 500_000,
                                            "kind": "measured_attack", "confidence": 0.9}]}
        project["render_manifest"]["audio"]["music_ducking"] = "sidechaincompress"
        expected_frames = project["timeline"][0]["duration_frames"]
        media = {"video": {"width": 2560, "height": 1440, "avg_frame_rate": (144, 1)},
                 "has_audio": True, "audio": [{"duration_us": 1_000_000, "start_time_us": 0}],
                 "duration_us": 1_000_000}
        timing = {"monotonic": True, "cfr": True, "frames": expected_frames,
                  "max_delta_error_us": 0.0, "first_pts_s": 0.0, "last_pts_s": 0.993056}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "aligned.mp4"
            output.write_bytes(b"fixture")
            with (patch("services.worker.quality.probe_media", return_value=media),
                  patch("services.worker.quality._count_frames", return_value=None),
                  patch("services.worker.quality._audit_pts", return_value=timing),
                  patch("services.worker.quality._max_duplicate_run", return_value=1),
                  patch("services.worker.quality._detect_intervals", return_value=[]),
                  patch("services.worker.quality._measure_peak", return_value=-1.0)):
                report = run_quality_control(str(output), project)

        self.assertEqual(report["feature_gates"]["beat_sync"]["status"], "EXECUTED_SUCCESSFULLY")
        self.assertEqual(report["feature_gates"]["music"]["status"], "EXECUTED_SUCCESSFULLY")

    def test_beat_sync_audit_does_not_use_unmeasured_candidates(self) -> None:
        project = self._project()
        project["music"] = {"path": "song.wav", "offset_us": 0,
                             "method": "upstream sample-domain attack timing",
                             "beat_grid": [
                                 {"marker_id": "candidate-on-impact", "time_us": 500_000,
                                  "kind": "beat_candidate", "confidence": 1.0},
                                 {"marker_id": "measured-away", "time_us": 800_000,
                                  "kind": "measured_attack", "confidence": 0.9,
                                  "strength": 0.9, "attack_band": "mid"},
                             ]}

        beat_sync = _audit_beat_sync(project, 144)

        self.assertEqual(beat_sync["events"][0]["nearest_attack_id"], "measured-away")
        self.assertEqual(beat_sync["events"][0]["marker_assignment"], "unmatched")

    def test_beat_sync_audit_rejects_weak_measured_impacts(self) -> None:
        project = self._project()
        project["music"] = {"path": "song.wav", "offset_us": 0,
                             "method": "upstream sample-domain attack timing",
                             "beat_grid": [
                                 {"marker_id": "weak-on-impact", "time_us": 500_000,
                                  "kind": "measured_attack", "confidence": 0.1,
                                  "strength": 0.1, "attack_band": "low"},
                                 {"marker_id": "strong-away", "time_us": 800_000,
                                  "kind": "measured_attack", "confidence": 0.9,
                                  "strength": 0.9, "attack_band": "mid"},
                             ]}

        beat_sync = _audit_beat_sync(project, 144)

        self.assertEqual(beat_sync["events"][0]["nearest_attack_id"], "strong-away")
        self.assertEqual(beat_sync["events"][0]["marker_assignment"], "unmatched")

    def test_music_and_beat_gates_fail_when_track_ends_before_video(self) -> None:
        project = self._project()
        project["settings"]["beat_sync_priority"] = 0.75
        project["music"] = {"path": "short.wav", "offset_us": 0,
                             "method": "upstream measured attacks",
                             "beat_grid": [{"marker_id": "attack-1", "time_us": 500_000,
                                            "kind": "measured_attack", "confidence": 0.9}]}
        manifest = project["render_manifest"]
        manifest["audio"].update({"music_ducking": "sidechaincompress",
                                  "music_coverage_us": 2_100_000,
                                  "music_required_coverage_us": 16_250_000})

        gates = _feature_gates(project, manifest, {"events": []}, set(), set())

        self.assertEqual(gates["music"]["status"], "REQUESTED_BUT_MISSING")
        self.assertEqual(gates["beat_sync"]["status"], "REQUESTED_BUT_MISSING")

    def test_one_measured_attack_cannot_be_reused_for_two_timeline_impacts(self) -> None:
        project = self._project()
        project["settings"]["beat_sync_priority"] = 0.75
        project["events"].append({"event_id": "event-22345678", "source_media_id": "media-12345678",
                                  "source_time_us": 1_100_000, "source_frame": 66,
                                  "in_us": 500_000, "out_us": 1_500_000,
                                  "evidence": [{"type": "user_annotation"}], "owner": "player",
                                  "confidence": 1.0, "tags": [], "cluster_id": None,
                                  "rating": None, "is_user_override": True})
        add_timeline_clip(project, "event-22345678")
        project["music"] = {"path": "unused.wav", "offset_us": 0,
                             "method": "upstream beat_hits.py: sample-domain attack timing",
                             "beat_grid": [{"marker_id": "attack-only-once", "time_us": 500_000,
                                            "kind": "measured_attack", "confidence": 0.9}]}
        project["render_manifest"]["audio"]["music_ducking"] = "sidechaincompress"

        beat_sync = _audit_beat_sync(project, 144)
        gates = _feature_gates(project, project["render_manifest"], beat_sync, set(), set())

        self.assertEqual(beat_sync["events"][0]["marker_assignment"], "unique")
        self.assertEqual(beat_sync["events"][1]["marker_assignment"], "unmatched")
        self.assertEqual(gates["beat_sync"]["status"], "REQUESTED_BUT_MISSING")
        self.assertEqual(gates["beat_sync"]["unassigned_event_ids"], ["event-22345678"])

    def test_unrequested_beat_sync_does_not_grade_candidate_marker_alignment(self) -> None:
        project = self._project()
        project["music"] = {"path": "unused.wav", "offset_us": 0,
                             "method": "local beat candidates",
                             "beat_grid": [{"marker_id": "candidate-1", "time_us": 100_000,
                                            "kind": "beat_candidate", "confidence": 0.5}]}
        project["render_manifest"]["audio"]["music_ducking"] = "sidechaincompress"
        expected_frames = project["timeline"][0]["duration_frames"]
        media = {"video": {"width": 2560, "height": 1440, "avg_frame_rate": (144, 1)},
                 "has_audio": True, "audio": [{"duration_us": 1_000_000, "start_time_us": 0}],
                 "duration_us": 1_000_000}
        timing = {"monotonic": True, "cfr": True, "frames": expected_frames,
                  "max_delta_error_us": 0.0, "first_pts_s": 0.0, "last_pts_s": 0.993056}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "beat-not-requested.mp4"
            output.write_bytes(b"fixture")
            with (patch("services.worker.quality.probe_media", return_value=media),
                  patch("services.worker.quality._count_frames", return_value=None),
                  patch("services.worker.quality._audit_pts", return_value=timing),
                  patch("services.worker.quality._max_duplicate_run", return_value=1),
                  patch("services.worker.quality._detect_intervals", return_value=[]),
                  patch("services.worker.quality._measure_peak", return_value=-1.0)):
                report = run_quality_control(str(output), project)

        self.assertEqual(report["beat_sync"]["events"], [])
        self.assertEqual(report["feature_gates"]["beat_sync"]["status"], "NOT_REQUESTED")
        self.assertFalse(any("Offset visual impact" in item["message"] for item in report["checks"]))
        self.assertEqual(report["status"], "WARN")
        self.assertEqual([item["message"].split(":")[0] for item in report["checks"] if item["status"] == "WARN"],
                         ["visual_effects"])

    def test_preflight_blocks_requested_beat_sync_without_local_music(self) -> None:
        project = self._project()
        project["settings"]["beat_sync_priority"] = 0.75
        with tempfile.TemporaryDirectory() as directory:
            report = preflight(project, str(Path(directory) / "out.mp4"),
                               rights_acknowledged=False, ownership_acknowledged=True)

        self.assertTrue(any("Beat sync diminta" in error and "track musik" in error
                            for error in report["errors"]))

    def test_preflight_blocks_music_that_ends_before_the_timeline(self) -> None:
        project = self._project()
        project["settings"]["beat_sync_priority"] = 0
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "gameplay.mp4"
            source.write_bytes(b"fixture")
            project["sources"][0]["path"] = str(source)
            music_path = root / "preview.wav"
            music_path.write_bytes(b"fixture")
            project["music"] = {"path": str(music_path), "duration_us": 500_000,
                                "offset_us": 100_000, "beat_grid": [], "rights_acknowledged": True}
            with patch("services.worker.render.probe_audio", return_value={"duration_us": 500_000}):
                report = preflight(project, str(root / "out.mp4"),
                                   rights_acknowledged=True, ownership_acknowledged=True)

        self.assertTrue(any("durasi musik" in error.lower() and "berhenti sebelum video" in error.lower()
                            for error in report["errors"]))

    def test_near_duplicate_source_replay_is_reported_and_blocks_render(self) -> None:
        project = self._project()
        duplicate = dict(project["events"][0])
        duplicate.update({"event_id": "event-22345678", "source_time_us": 1_066_667,
                          "source_frame": 64, "in_us": 66_667, "out_us": 2_000_000,
                          "evidence": [{"type": "upstream_kill_candidate", "feed_frame": 64,
                                        "working_frame_60": 64, "upstream_verified": True}]})
        project["events"].append(duplicate)
        add_timeline_clip(project, duplicate["event_id"])
        third = dict(project["events"][0])
        third.update({"event_id": "event-32345678", "source_time_us": 1_800_000,
                      "source_frame": 108, "in_us": 1_300_000, "out_us": 2_000_000,
                      "evidence": [{"type": "user_annotation"}]})
        project["events"].append(third)
        add_timeline_clip(project, third["event_id"])

        pairs = find_near_duplicate_plays(project)
        gates = _feature_gates(project, project["render_manifest"], {"events": []}, set(), set())
        with tempfile.TemporaryDirectory() as directory:
            report = preflight(project, str(Path(directory) / "out.mp4"),
                               rights_acknowledged=True, ownership_acknowledged=True)

        self.assertEqual(len(pairs), 1)
        self.assertEqual(gates["source_replay"]["status"], "REQUESTED_BUT_MISSING")
        self.assertEqual(gates["editing_pipeline"]["status"], "REQUESTED_BUT_MISSING")
        self.assertEqual(set(missing_default_editing_requirements(project)), {
            "selective slow motion and a speed ramp", "impact zoom with motion blur",
            "a contextual flash or camera shake", "a restrained transition between selected takes"})
        self.assertTrue(any("Timeline mengulang hampir seluruh source" in error
                            for error in report["errors"]))
        self.assertTrue(any("belum memenuhi minimum editing" in error for error in report["errors"]))

    def test_rough_preview_marks_skipped_transitions_not_requested(self) -> None:
        project = self._project()
        project["timeline"][0]["transitions"] = [
            {"type": "dip_to_black", "duration_frames": 12, "enabled": True}]
        project["render_manifest"]["render_mode"] = "rough_preview"

        gates = _feature_gates(project, project["render_manifest"], {"events": []}, set(), set())

        self.assertEqual(gates["transitions"]["status"], "NOT_REQUESTED")

    def test_rough_preview_bypasses_master_quality_floor(self) -> None:
        project = self._project()
        for index, (impact, start, end) in enumerate(((300_000, 100_000, 450_000),
                                                       (1_700_000, 1_550_000, 1_950_000)), start=2):
            event_id = f"event-{index}2345678"
            project["events"].append({"event_id": event_id, "source_media_id": "media-12345678",
                                      "source_time_us": impact, "source_frame": round(impact * 60 / 1_000_000),
                                      "in_us": start, "out_us": end, "evidence": [{"type": "user_annotation"}],
                                      "owner": "player", "confidence": 1.0, "tags": [], "cluster_id": None,
                                      "rating": None, "is_user_override": True})
            add_timeline_clip(project, event_id)
        project["render_manifest"]["render_mode"] = "rough_preview"

        gates = _feature_gates(project, project["render_manifest"], {"events": []}, set(), set())
        with tempfile.TemporaryDirectory() as directory:
            report = preflight(project, str(Path(directory) / "rough.mp4"),
                               rights_acknowledged=True, ownership_acknowledged=True,
                               render_mode="rough_preview")

        self.assertEqual(gates["rife"]["status"], "NOT_REQUESTED")
        self.assertEqual(gates["editing_pipeline"]["status"], "NOT_REQUESTED")
        self.assertFalse(any("belum memenuhi minimum editing" in error for error in report["errors"]))

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg unavailable; silence filter integration test skipped")
    def test_silencedetect_uses_audio_filter_and_finds_silent_audio(self) -> None:
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg is not None
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "silence.wav"
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                            "anullsrc=r=48000:cl=stereo", "-t", "2", "-c:a", "pcm_s16le", str(audio)],
                           capture_output=True, check=True, timeout=30)
            intervals = _detect_intervals(
                audio,
                "silencedetect=noise=-50dB:d=1",
                r"silence_start:\s*([0-9.]+)(?:[\s\S]*?silence_end:\s*([0-9.]+))?",
                audio=True,
            )

        self.assertIsNotNone(intervals)
        assert intervals is not None
        self.assertEqual(len(intervals), 1)
        self.assertEqual(intervals[0]["start_s"], 0.0)
        self.assertEqual(intervals[0]["end_s"], 2.0)


if __name__ == "__main__":
    unittest.main()
