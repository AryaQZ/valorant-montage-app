"""Prepare editable copies of the reviewed replay for the timeline UI checks."""

import json
from pathlib import Path
from sys import argv

from services.worker.schema import normalize_timeline, validate_project


def main(root: Path) -> None:
    original = json.loads((root / "kill-review.vmsproj.json").read_text(encoding="utf-8"))

    def write(name, data):
        path = root / name
        with path.open("x", encoding="utf-8") as stream:
            json.dump(validate_project(data), stream)

    write("timeline.vmsproj.json", original)
    first, second, *tail = original["timeline"]
    first["out_us"] = second["out_us"]
    original["events"][0]["out_us"] = first["out_us"]
    first["included_event_ids"] = [first["event_id"], second["event_id"]]
    first.pop("time_remap")
    original["timeline"] = [first, *tail]
    normalize_timeline(original)
    write("grouped.vmsproj.json", original)

    bad_source = root / "invalid-gameplay.mp4"
    with bad_source.open("xb") as stream:
        stream.write(b"intentionally invalid media used only by the local QA test")
    original["sources"][0]["path"] = str(bad_source)
    original["sources"][0]["proxy_path"] = None
    write("invalid-source.vmsproj.json", original)


if __name__ == "__main__":
    main(Path(argv[1]).resolve())
