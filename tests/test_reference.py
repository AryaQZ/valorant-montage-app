from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
import hashlib

from services.worker import reference
from services.worker.native_edit import entry_transition, regular_drum_runs
from services.worker.schema import ProjectValidationError, new_project, validate_project


class ReferenceDraftTests(TestCase):
    def test_empty_highlight_list_scans_each_source_and_filters_unverified_candidates(self):
        project = new_project()
        project["sources"] = [{"media_id": key, "path": f"{key}.mp4", "duration_us": 10_000_000}
                              for key in ("one", "two")]
        def detect(path, source_id, duration):
            return {"candidates": [
                {"source_media_id": source_id, "source_time_us": 3_000_000, "confidence": 0.9,
                 "evidence": [{"upstream_commit": reference.UPSTREAM_COMMIT, "upstream_verified": True,
                               "shot_method": "ammo", "working_frame_60": 180}]},
                {"source_media_id": source_id, "source_time_us": 5_000_000, "confidence": 0.3},
            ]}
        with patch.object(reference, "detect_kills", side_effect=detect) as scan:
            self.assertEqual([event["source_media_id"] for event in reference._select_events(project)],
                             ["one", "two"])
            self.assertEqual(scan.call_count, 2)


    def test_replay_claim_requires_review_even_when_the_shot_is_verified(self):
        project = new_project()
        project["sources"] = [{"media_id": "one", "path": "replay.mp4", "duration_us": 38_000_000}]
        event = {"requires_ownership_review": True, "evidence": [{
            "upstream_commit": reference.UPSTREAM_COMMIT, "upstream_verified": True,
            "working_frame_60": 180, "shot_method": "ammo",
        }]}
        with patch.object(reference, "detect_kills", return_value={"candidates": [event]}):
            with self.assertRaisesRegex(reference.MediaToolError, "Find kills"):
                reference._select_events(project)

    def test_ace_requires_source_time_after_final_selected_impact(self):
        project = new_project()
        project["sources"] = [{"media_id": "one", "duration_us": 38_000_000}]
        first = {"source_media_id": "one", "source_time_us": 24_200_000, "evidence": []}
        last = {"source_media_id": "one", "source_time_us": 35_566_667, "evidence": [{
            "type": "reviewed_ace_banner", "source_time_us": 35_766_667,
        }]}
        self.assertEqual(reference._ace_confirmation([first, last], project),
                         {"kind": "ace", "source_time_us": 35_766_667})
        with self.assertRaisesRegex(reference.MediaToolError, "terakhir"):
            reference._ace_confirmation([last, first], project)
        last["evidence"][0]["source_time_us"] = 38_000_000
        with self.assertRaisesRegex(reference.MediaToolError, "di dalam rekaman"):
            reference._ace_confirmation([first, last], project)



    def test_final_action_marker_preserves_requested_lead_or_defaults_for_ace(self):
        first = {"source_time_us": 1_000_000, "evidence": []}
        last = {"source_time_us": 5_000_000, "evidence": []}
        self.assertIsNone(reference._ending_action([first, last], None))
        self.assertIsNone(reference._ending_action([first, last], {"kind": "ace"})["source_time_us"])
        marker = {"type": "reviewed_final_action", "source_time_us": 3_200_000}
        last["evidence"].append(marker)
        output = reference._ending_action([first, last], None)
        self.assertEqual(output["source_time_us"], 3_200_000)
        self.assertAlmostEqual(output["min_interval_s"], 2.46)
        with self.assertRaisesRegex(reference.MediaToolError, "terakhir"):
            reference._ending_action([last, first], None)
        marker["source_time_us"] = last["source_time_us"]
        with self.assertRaisesRegex(reference.MediaToolError, "sebelum"):
            reference._ending_action([first, last], None)



    def test_replay_ammo_step_rejects_brief_flash_over_unchanged_digits(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("Replay scan requires NumPy in its upstream runtime.")
        from services.worker.replay_scan import _persistent_step

        glyphs = np.zeros((12, 6, 10), dtype=np.float32)
        glyphs[:, :, :2] = 1
        glyphs[4:, :3, 2:5] = 1
        glyphs[8, :, :] = 1
        self.assertTrue(_persistent_step(glyphs, 4))
        self.assertFalse(_persistent_step(glyphs, 8))

    def test_project_checks_plan_id_before_it_can_identify_local_pipeline(self):
        project = new_project()
        project["reference_draft"] = "../timeline.py"
        with self.assertRaises(ProjectValidationError):
            validate_project(project)

    def test_same_source_nearby_shots_with_the_same_feed_are_deduplicated(self):
        def event(source, frame, feed):
            return {"source_media_id": source, "evidence": [{
                "upstream_commit": reference.UPSTREAM_COMMIT, "upstream_verified": True,
                "shot_method": "ammo", "working_frame_60": frame, "feed_frame": feed,
            }]}

        first = event("one", 100, 110)
        other = event("two", 102, 110)
        separate = event("one", 105, 120)
        self.assertEqual(reference._deduplicate([first, event("one", 103, 111), other, separate]),
                         [first, other, separate])

    def test_legacy_render_cannot_silently_replace_stale_reference_plan(self):
        project = new_project()
        project["reference_draft"] = "a" * 32
        with TemporaryDirectory() as directory, patch.object(reference, "app_data_dir", return_value=Path(directory)):
            root = Path(directory)
            draft = root / "reference-drafts" / project["reference_draft"]
            draft.mkdir(parents=True)
            content = b"trusted generated timeline"
            (draft / "timeline.py").write_bytes(content)
            reference._write(draft / "summary.json", {"frames": 120, "fps": 60})
            reference._write(draft / "draft.json", {"fingerprint": reference._fingerprint(project),
                                                    "stamps": {}, "timeline_sha1": hashlib.sha1(content).hexdigest()})
            output = root / "video.mp4"
            self.assertEqual(reference.reference_preflight(project, str(output), True, True)["errors"], [])
            self.assertEqual(len(reference.reference_preflight(project, str(output), False, False)["errors"]), 2)
            project["music"] = {"path": "changed.flac", "offset_us": 0}
            self.assertIn("timeline berubah", reference.reference_preflight(project, str(output), True, True)["errors"][0])

class NativeStyleTests(TestCase):
    def test_native_fingerprint_survives_javascript_integral_number_serialization(self):
        project = new_project()
        project["settings"]["gameplay_gain"] = 1.0
        before = reference._fingerprint(project, native_style=True, canonical=True)
        project["settings"]["gameplay_gain"] = 1
        self.assertEqual(reference._fingerprint(project, native_style=True, canonical=True), before)
        project["settings"]["gameplay_gain"] = 0.99
        self.assertNotEqual(reference._fingerprint(project, native_style=True, canonical=True), before)

    def test_one_matching_new_attack_per_kill(self):
        rows = [[key, 0.1, 0.8, 0.2] for key in (8, 12, 16, 20)]
        attacks = {key: {"mid": key / 3 + 0.02} for key, *_ in rows}
        matches = regular_drum_runs(rows, attacks, 4, 180, 10, 2, 2.5)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["drum"], "snare")
        self.assertEqual(matches[0]["step"], 4)
        self.assertEqual(len(set(matches[0]["attack_us"])), 4)
        self.assertEqual(regular_drum_runs(rows, attacks, 5, 180, 10, 2, 2.5), [])
        self.assertEqual(regular_drum_runs(rows, attacks, 4, 180, 9, 2, 2.5), [])
        self.assertEqual(regular_drum_runs(rows, attacks, 4, 180, 10, 3, 3), [])

    def test_regular_run_rejects_a_weak_or_missing_drum(self):
        rows = [[key, 0.0, 0.8 if key != 16 else 0.3, 0.9] for key in (8, 12, 16, 20)]
        attacks = {key: {"mid": key / 3, "high": key / 3} for key, *_ in rows}
        self.assertEqual(regular_drum_runs(rows, attacks, 4, 180, 10, 2, 2.5), [])

    def test_native_summary_rejects_dropped_duplicate_or_split_impact(self):
        kills = [{"clip": "c1", "K": 50}, {"clip": "c1", "K": 80}]
        self.assertTrue(reference._keep_chain(kills))
        first = {"shot_frame": 30, "working_frame_60": 50}
        second = {"shot_frame": 60, "working_frame_60": 80}
        row = {"kind": "snare", "strength": 0.8, "song_time_us": 500_000}
        draft = {"takes": [{"source_alias": "c1", "impacts": [first, second]}]}
        self.assertEqual(reference._check_impacts(draft, kills, [row, None]), 1)
        self.assertEqual(second["beat_number"], 2)
        with self.assertRaisesRegex(reference.MediaToolError, "rangkaian"):
            reference._check_impacts({"takes": [{"source_alias": "c1", "impacts": [item]}
                                               for item in (first, second)]}, kills, [row, None])
        with self.assertRaisesRegex(reference.MediaToolError, "impact"):
            reference._check_impacts(draft, kills + [{"clip": "c1", "K": 110}], [row, None])
        second["shot_frame"] = first["shot_frame"]
        with self.assertRaisesRegex(reference.MediaToolError, "impact"):
            reference._check_impacts(draft, kills, [row, None])

    def test_native_draft_tracks_style_inputs_and_legacy_draft_can_still_load(self):
        p = new_project()
        legacy = reference._fingerprint(p)
        native = reference._fingerprint(p, native_style=True)
        p["reference_video"] = {"path": "reference.mp4", "filename": "reference.mp4"}
        self.assertEqual(validate_project(p)["reference_video"]["filename"], "reference.mp4")
        self.assertNotEqual(reference._fingerprint(p, native_style=True), native)
        self.assertEqual(reference._fingerprint(p), legacy)
        p["reference_video"]["path"] = ""
        with self.assertRaises(ProjectValidationError):
            validate_project(p)

    def test_transition_depends_on_camera_motion_and_reference_hint(self):
        self.assertEqual(entry_transition(1.0, True, "broll", 1), ("cut", 0.0))
        self.assertEqual(entry_transition(11.0, True, "cut", 2), ("broll", 0.0, -1))
        self.assertEqual(entry_transition(11.0, False, "cut", 2), ("bwhip", 0.0, -1))
        self.assertEqual(entry_transition(6.4, False, "bwhip", 2), ("bwhip", 0.0, -1))
