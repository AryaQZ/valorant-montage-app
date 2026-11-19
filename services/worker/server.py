"""Authenticated loopback-only worker API used by the desktop host."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any
from urllib.parse import unquote, urlparse
import hmac
import json
import logging
import os
import secrets
import socket
import sys
import time

from . import __version__
from .audio_beats import analyze_music
from .jobs import JobManager
from .library import index_project, list_projects
from .media import MediaToolError, create_preview_assets, find_media_tools, probe_audio, probe_media
from .render import preflight
from .reference import create_reference_draft, read_reference_draft, reference_preflight
from .schema import ProjectValidationError, validate_project
from .upstream import capabilities as upstream_capabilities, detect_kills

MAX_BODY_BYTES = 8 * 1024 * 1024
LOG = logging.getLogger("montage.worker")


class WorkerServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, address: tuple[str, int], token: str):
        self.token = token
        self.jobs = JobManager()
        super().__init__(address, WorkerHandler)


class WorkerHandler(BaseHTTPRequestHandler):
    server: WorkerServer
    protocol_version = "HTTP/1.1"
    server_version = "VMSWorker"
    sys_version = ""

    def log_message(self, fmt: str, *args: Any) -> None:
        # Avoid recording user media paths and query values.
        LOG.info("%s %s", self.command, self.path.split("?", 1)[0])

    def do_GET(self) -> None:
        if not self._authorized():
            return
        route = urlparse(self.path).path
        if route == "/v1/health":
            self._json(200, {"status": "ok", "worker_version": __version__})
        elif route == "/v1/capabilities":
            self._json(200, {"worker_version": __version__, "media": find_media_tools(),
                             "platform": sys.platform, "upstream": upstream_capabilities()})
        elif route.startswith("/v1/jobs/"):
            job = self.server.jobs.get(unquote(route.rsplit("/", 1)[-1]))
            self._json(200 if job else 404, job or {"error": "Job tidak ditemukan."})
        elif route == "/v1/library/projects":
            self._json(200, {"projects": list_projects()})
        else:
            self._json(404, {"error": "Endpoint tidak ditemukan."})

    def do_POST(self) -> None:
        if not self._authorized():
            return
        route = urlparse(self.path).path
        try:
            body = self._read_json()
            if route == "/v1/probe":
                self._json(200, probe_media(body.get("path", "")))
            elif route == "/v1/music/probe":
                self._json(200, probe_audio(body.get("path", "")))
            elif route == "/v1/media/import":
                media = probe_media(body.get("path", ""))
                media["media_id"] = secrets.token_hex(12)
                try:
                    media.update(create_preview_assets(media))
                except MediaToolError as exc:
                    media.update({"thumbnail_path": None, "proxy_path": None, "warning": str(exc)})
                self._json(200, media)
            elif route == "/v1/music/analyze":
                self._json(200, analyze_music(body.get("path", "")))
            elif route == "/v1/events/detect":
                source_id = body.get("source_media_id")
                if not isinstance(source_id, str) or not source_id or len(source_id) > 80:
                    raise ValueError("source_media_id tidak valid.")
                media = probe_media(body.get("path", ""), sample_vfr=False)
                self._json(200, detect_kills(media["path"], source_id, int(media["duration_us"])))
            elif route == "/v1/project/validate":
                project = validate_project(body.get("project"), require_timeline=bool(body.get("require_timeline")))
                self._json(200, {"valid": True, "event_count": len(project["events"]),
                                 "clip_count": len(project["timeline"]), "project": project})
            elif route == "/v1/library/index":
                counts = index_project(body.get("project"), body.get("json_path"))
                self._json(200, {"indexed": True, "counts": counts})
            elif route == "/v1/render/preflight":
                project = body["project"]
                args = (validate_project(project), body["output_path"],
                        bool(body.get("rights_acknowledged")), bool(body.get("ownership_acknowledged")))
                if project.get("reference_draft"):
                    self._json(200, reference_preflight(*args))
                else:
                    self._json(200, preflight(*args, render_mode=body.get("render_mode", "master")))
            elif route == "/v1/reference/draft":
                self._json(200, create_reference_draft(body["project"]))
            elif route == "/v1/reference/read":
                self._json(200, read_reference_draft(validate_project(body["project"])))
            elif route == "/v1/render":
                job = self.server.jobs.submit_render(body)
                self._json(202, job)
            else:
                self._json(404, {"error": "Endpoint tidak ditemukan."})
        except (KeyError, TypeError, ValueError, MediaToolError, ProjectValidationError) as exc:
            self._json(400, {"error": str(exc)})
        except RuntimeError as exc:
            self._json(409, {"error": str(exc)})
        except Exception as exc:
            LOG.exception("Worker request failed")
            self._json(500, {"error": f"Worker gagal memproses permintaan ({type(exc).__name__})."})

    def do_DELETE(self) -> None:
        if not self._authorized():
            return
        route = urlparse(self.path).path
        if route.startswith("/v1/jobs/"):
            job = self.server.jobs.cancel(unquote(route.rsplit("/", 1)[-1]))
            self._json(200 if job else 404, job or {"error": "Job tidak ditemukan."})
        else:
            self._json(404, {"error": "Endpoint tidak ditemukan."})

    def _authorized(self) -> bool:
        if self.client_address[0] not in {"127.0.0.1", "::1"}:
            self._json(403, {"error": "Loopback only."})
            return False
        expected_host = f"127.0.0.1:{self.server.server_port}"
        if self.headers.get("Host", "") != expected_host:
            self._json(403, {"error": "Invalid Host header."})
            return False
        auth = self.headers.get("Authorization", "")
        supplied = auth.removeprefix("Bearer ")
        if not hmac.compare_digest(supplied, self.server.token):
            self._json(401, {"error": "Unauthorized."})
            return False
        return True

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("Ukuran body request tidak valid.")
        raw = self.rfile.read(length)
        try:
            result = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Body harus JSON UTF-8 yang valid.") from exc
        if not isinstance(result, dict):
            raise ValueError("Body request harus berupa object JSON.")
        return result

    def _json(self, status: int, value: Any) -> None:
        data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)


def _wait_for_desktop_exit(pid: int) -> None:
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        handle = kernel.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            return
        try:
            kernel.WaitForSingleObject(handle, 0xFFFFFFFF)
        finally:
            kernel.CloseHandle(handle)
    else:
        while os.getppid() == pid:
            time.sleep(0.25)


def serve() -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr,
                        format="%(asctime)s %(levelname)s %(message)s")
    parent_pid = os.environ.get("VMS_WORKER_PARENT_PID", "")
    desktop_owned = parent_pid.isdecimal() and int(parent_pid) > 0
    if desktop_owned and os.name == "nt":
        from .windows_lifecycle import protect_child_processes

        try:
            protect_child_processes()
        except OSError as exc:
            LOG.warning("Windows worker child-process protection is unavailable (%s).", exc.winerror)
    token = secrets.token_urlsafe(32)
    server = WorkerServer(("127.0.0.1", 0), token)
    ready = {"type": "ready", "port": server.server_port, "token": token,
             "worker_version": __version__}
    sys.stdout.write(json.dumps(ready) + "\n")
    sys.stdout.flush()
    if desktop_owned:
        def close_when_studio_exits() -> None:
            _wait_for_desktop_exit(int(parent_pid))
            server.shutdown()

        Thread(target=close_when_studio_exits, name="studio-parent", daemon=True).start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.jobs.close()
        server.server_close()

