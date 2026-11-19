"""Run the real local native worker stages with a reviewed project and fresh file analysis."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import threading

from services.worker.audio_beats import analyze_music
from services.worker.media import probe_audio, probe_media
from services.worker.reference import create_reference_draft, render_reference
from services.worker.schema import validate_project


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path, help="Reviewed JSON with locally verified shots")
    parser.add_argument("--output", required=True, type=Path, help="New directory for the render and local QA data")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    os.environ["VMS_DATA_DIR"] = str(output / "profile")

    def record(name, data):
        (output / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    project = validate_project(json.loads(args.project.read_text(encoding="utf-8-sig")))
    if not project.get("music") or not project["events"]:
        parser.error("The project must include local music and reviewed events.")
    project.pop("reference_draft", None)
    for source in project["sources"]:
        verified = probe_media(str(Path(source["path"]).resolve(strict=True)), sample_vfr=False)
        source.update(verified)
    music = project["music"]
    song = str(Path(music["path"]).resolve(strict=True))
    music.update(probe_audio(song))
    music.update(analyze_music(song))
    inputs = {Path(path) for path in [song, *(source["path"] for source in project["sources"])]}
    if project.get("reference_video"):
        inputs.add(Path(project["reference_video"]["path"]).resolve(strict=True))

    def digests():
        result = {}
        for path in inputs:
            with path.open("rb") as stream:
                result[str(path)] = hashlib.file_digest(stream, "sha256").hexdigest()
        return result

    before = digests()
    print("Planning native draft", flush=True)
    draft = create_reference_draft(project)
    project["reference_draft"] = draft["id"]
    record("draft.json", draft)
    record("planned-project.json", project)
    result = render_reference(project, str(output / "native-1080p60.mp4"), True, True,
                              threading.Event(), lambda fraction, stage: print(f"{fraction:.0%} {stage}", flush=True))
    record("input-hashes.json", before)
    record("result.json", result)
    if digests() != before:
        raise RuntimeError("Source hash changed during rendering.")
    if result["qa"]["status"] == "FAIL":
        raise RuntimeError("Native output failed QA; see result.json.")


if __name__ == "__main__":
    main()
