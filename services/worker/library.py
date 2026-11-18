"""Small durable SQLite project/media index; project files remain portable JSON."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import sqlite3

from .media import app_data_dir
from .schema import validate_project

DB_SCHEMA_VERSION = 1


def _connect() -> sqlite3.Connection:
    path = app_data_dir() / "studio-index.sqlite3"
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    _migrate(connection)
    return connection


@contextmanager
def _connection():
    connection = _connect()
    try:
        yield connection
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()


def _migrate(connection: sqlite3.Connection) -> None:
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    if version > DB_SCHEMA_VERSION:
        raise RuntimeError(f"Index DB versi {version} lebih baru daripada aplikasi.")
    if version < 1:
        with connection:
            connection.executescript("""
                CREATE TABLE projects (
                    project_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    json_path TEXT,
                    schema_version INTEGER NOT NULL,
                    updated_utc TEXT NOT NULL
                );
                CREATE TABLE media (
                    media_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                    path TEXT NOT NULL,
                    duration_us INTEGER,
                    metadata_json TEXT NOT NULL
                );
                CREATE INDEX media_project_idx ON media(project_id);
                CREATE TABLE events (
                    event_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                    source_media_id TEXT NOT NULL REFERENCES media(media_id) ON DELETE CASCADE,
                    source_time_us INTEGER NOT NULL,
                    event_json TEXT NOT NULL
                );
                CREATE INDEX events_project_idx ON events(project_id);
                CREATE TABLE clips (
                    clip_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                    event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    clip_json TEXT NOT NULL,
                    UNIQUE(project_id, position)
                );
                CREATE TABLE music (
                    project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
                    path TEXT NOT NULL,
                    music_json TEXT NOT NULL
                );
                PRAGMA user_version=1;
            """)


def index_project(project: dict[str, Any], json_path: str | None = None) -> dict[str, int]:
    validate_project(project)
    counts = {"media": len(project["sources"]), "events": len(project["events"]),
              "clips": len(project["timeline"])}
    with _connection() as connection:
        updated_utc = datetime.now(timezone.utc).isoformat()
        connection.execute("INSERT INTO projects(project_id,name,json_path,schema_version,updated_utc) VALUES(?,?,?,?,?) "
                           "ON CONFLICT(project_id) DO UPDATE SET name=excluded.name,json_path=excluded.json_path,"
                           "schema_version=excluded.schema_version,updated_utc=excluded.updated_utc",
                           (project["project_id"], project["name"], json_path, project["schema_version"],
                            updated_utc))
        for table in ("clips", "events", "media", "music"):
            if table == "music":
                connection.execute("DELETE FROM music WHERE project_id=?", (project["project_id"],))
            else:
                connection.execute(f"DELETE FROM {table} WHERE project_id=?", (project["project_id"],))
        for source in project["sources"]:
            connection.execute("INSERT INTO media(media_id,project_id,path,duration_us,metadata_json) VALUES(?,?,?,?,?)",
                               (source["media_id"], project["project_id"], source["path"], source.get("duration_us"),
                                json.dumps(source, ensure_ascii=False)))
        for event in project["events"]:
            connection.execute("INSERT INTO events(event_id,project_id,source_media_id,source_time_us,event_json) VALUES(?,?,?,?,?)",
                               (event["event_id"], project["project_id"], event["source_media_id"], event["source_time_us"],
                                json.dumps(event, ensure_ascii=False)))
        for position, clip in enumerate(project["timeline"]):
            connection.execute("INSERT INTO clips(clip_id,project_id,event_id,position,clip_json) VALUES(?,?,?,?,?)",
                               (clip["clip_id"], project["project_id"], clip["event_id"], position,
                                json.dumps(clip, ensure_ascii=False)))
        if project.get("music"):
            connection.execute("INSERT INTO music(project_id,path,music_json) VALUES(?,?,?)",
                               (project["project_id"], project["music"]["path"],
                                json.dumps(project["music"], ensure_ascii=False)))
    return counts


def list_projects() -> list[dict[str, Any]]:
    with _connection() as connection:
        rows = connection.execute("""
            SELECT p.project_id,p.name,p.json_path,p.schema_version,p.updated_utc,
                   (SELECT COUNT(*) FROM media m WHERE m.project_id=p.project_id) AS media_count,
                   (SELECT COUNT(*) FROM events e WHERE e.project_id=p.project_id) AS event_count,
                   (SELECT COUNT(*) FROM clips c WHERE c.project_id=p.project_id) AS clip_count
            FROM projects p ORDER BY p.updated_utc DESC
        """).fetchall()
        return [dict(row) for row in rows]

