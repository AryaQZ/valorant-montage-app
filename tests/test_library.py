from copy import deepcopy
import os
import tempfile
import unittest
from unittest.mock import patch

from services.worker.library import index_project, list_projects
from services.worker.schema import add_timeline_clip, new_project


class LibraryTests(unittest.TestCase):
    def test_sqlite_index_migrates_and_tracks_project_sources_events_and_clips(self) -> None:
        project = new_project("SQLite index")
        project["sources"].append({"media_id": "m1", "path": "C:/fixtures/a.mp4", "duration_us": 3_000_000})
        project["events"].append({"event_id": "e1", "source_media_id": "m1", "source_time_us": 1_500_000,
                                  "in_us": 1_000_000, "out_us": 2_000_000, "evidence": [], "owner": "player",
                                  "confidence": 1, "tags": [], "cluster_id": None, "rating": None,
                                  "is_user_override": True})
        add_timeline_clip(project, "e1")
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"VMS_DATA_DIR": directory}):
            counts = index_project(project, "C:/projects/demo.vmsproj.json")
            found = list_projects()
        self.assertEqual(counts, {"media": 1, "events": 1, "clips": 1})
        self.assertEqual(found[0]["name"], "SQLite index")
        self.assertEqual(found[0]["clip_count"], 1)

    def test_reindex_replaces_removed_project_rows_without_duplicates(self) -> None:
        project = new_project("Reindex")
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"VMS_DATA_DIR": directory}):
            index_project(project)
            changed = deepcopy(project)
            changed["name"] = "Reindexed"
            index_project(changed)
            found = list_projects()
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["name"], "Reindexed")


if __name__ == "__main__":
    unittest.main()
