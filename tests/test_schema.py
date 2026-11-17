from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
import uuid

from services.worker.schema import (ProjectValidationError, add_timeline_clip, duration_to_frames,
                                    load_project, new_project, normalize_timeline, save_project,
                                    score_event, validate_project)


def sample_project() -> dict:
    project = new_project("Test montage")
    source_id = "media-1"
    project["sources"].append({"media_id": source_id, "path": "C:/fixtures/source.mp4",
                               "duration_us": 5_000_000, "has_audio": True,
                               "video": {"avg_frame_rate": (60, 1)}})
    project["events"].append({"event_id": "event-1", "source_media_id": source_id,
                              "source_time_us": 2_000_000, "source_frame": 120,
                              "in_us": 1_000_000, "out_us": 3_000_000,
                              "evidence": [{"type": "user_annotation"}], "owner": "player",
                              "confidence": 1.0, "tags": ["headshot", "multikill"],
                              "cluster_id": None, "rating": None, "is_user_override": True})
    return project


class ProjectSchemaTests(unittest.TestCase):
    def test_integer_frame_conversion_is_stable(self) -> None:
        self.assertEqual(duration_to_frames(1_000_000, 144), 144)
        self.assertEqual(duration_to_frames(6_944, 144), 1)
        with self.assertRaises(ProjectValidationError):
            duration_to_frames(0, 144)

    def test_project_id_cannot_escape_local_autosave_directory(self) -> None:
        project = sample_project()
        project["project_id"] = "../../outside"
        with self.assertRaisesRegex(ProjectValidationError, "project_id"):
            validate_project(project)

    def test_manual_event_can_be_added_to_non_destructive_timeline(self) -> None:
        project = sample_project()
        clip = add_timeline_clip(project, "event-1")
        self.assertEqual(clip["duration_frames"], 288)
        self.assertEqual(clip["output_start_frame"], 0)
        self.assertEqual(clip["time_remap"][0]["speed_num"], 1)
        self.assertEqual(clip["effects"][0]["type"], "impact_zoom")
        validate_project(project, require_timeline=True)

    def test_reordered_clips_recalculate_integer_frame_offsets(self) -> None:
        project = sample_project()
        add_timeline_clip(project, "event-1")
        second = deepcopy(project["events"][0])
        second.update({"event_id": "event-2", "in_us": 3_000_000, "source_time_us": 3_250_000, "out_us": 3_500_000})
        project["events"].append(second)
        add_timeline_clip(project, "event-2")
        project["timeline"].reverse()
        normalize_timeline(project)
        self.assertEqual([clip["output_start_frame"] for clip in project["timeline"]], [0, 72])

    def test_rejects_invalid_event_ranges_and_unknown_references(self) -> None:
        project = sample_project()
        project["events"][0]["source_time_us"] = 4_500_000
        with self.assertRaisesRegex(ProjectValidationError, "Range event"):
            validate_project(project)
        project = sample_project()
        project["events"][0]["source_media_id"] = "missing"
        with self.assertRaisesRegex(ProjectValidationError, "source yang tidak dikenal"):
            validate_project(project)

    def test_rejects_out_of_source_trim_and_overlapping_placement(self) -> None:
        project = sample_project()
        add_timeline_clip(project, "event-1")
        project["timeline"][0]["out_us"] = 5_100_000
        with self.assertRaises(ProjectValidationError):
            validate_project(project)
        project = sample_project()
        add_timeline_clip(project, "event-1")
        project["timeline"][0]["output_start_frame"] = 1
        with self.assertRaisesRegex(ProjectValidationError, "berurutan"):
            validate_project(project)

    def test_rejects_unsupported_effect_and_extreme_speed(self) -> None:
        project = sample_project()
        clip = add_timeline_clip(project, "event-1")
        clip["effects"].append({"type": "flash", "max_zoom": 1.0})
        with self.assertRaisesRegex(ProjectValidationError, "effect.*tidak didukung"):
            validate_project(project)
        clip["effects"] = []
        clip["time_remap"][0]["speed_num"] = 5
        with self.assertRaisesRegex(ProjectValidationError, "Speed remap"):
            validate_project(project)

    def test_save_load_round_trip_is_versioned_json(self) -> None:
        project = sample_project()
        add_timeline_clip(project, "event-1")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "project.vmsproj.json"
            save_project(project, path)
            reopened = load_project(path)
        self.assertEqual(reopened["project_id"], project["project_id"])
        self.assertEqual(reopened["timeline"], project["timeline"])

    def test_manual_score_uses_user_tags_and_owner_confidence(self) -> None:
        event = {"confidence": 1.0, "tags": ["multikill"], "owner": "player", "is_user_override": True}
        score = score_event(event)
        event["owner"] = "unknown"
        self.assertGreater(score, score_event(event))


if __name__ == "__main__":
    unittest.main()
