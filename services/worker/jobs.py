"""Cancelable background render jobs."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Event, Lock
from typing import Any
import uuid

from .render import render_montage
from .reference import render_reference
from .schema import validate_project


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CancelSignal(Event):
    def __init__(self) -> None:
        super().__init__()
        self._process = None
        self._process_lock = Lock()

    def attach_process(self, process: Any) -> None:
        with self._process_lock:
            self._process = process
            if self.is_set() and process.poll() is None:
                process.terminate()

    def cancel(self) -> None:
        self.set()
        with self._process_lock:
            if self._process is not None and self._process.poll() is None:
                self._process.terminate()


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, dict[str, Any]] = {}
        self._signals: dict[str, CancelSignal] = {}
        self._lock = Lock()
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="montage-render")

    def submit_render(self, body: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            running = next((job for job in self._jobs.values() if job["status"] in {"queued", "running"}), None)
            if running:
                raise RuntimeError("Satu render sedang berlangsung. Tunggu atau batalkan sebelum memulai render lain.")
            job_id = str(uuid.uuid4())
            signal = CancelSignal()
            self._signals[job_id] = signal
            job = {"job_id": job_id, "status": "queued", "progress": 0.0,
                   "message": "Menunggu worker", "created_utc": _now(), "result": None, "error": None}
            self._jobs[job_id] = job
        self._pool.submit(self._run, job_id, signal, body)
        return self.get(job_id)

    def _run(self, job_id: str, signal: CancelSignal, body: dict[str, Any]) -> None:
        self._update(job_id, status="running", message="Memulai render")
        try:
            progress = lambda value, message: self._update(job_id, progress=value, message=message)
            project = body["project"]
            if project.get("reference_draft"):
                if body.get("render_mode", "master") not in {"master", "effects_preview"}:
                    raise ValueError("Draft upstream mendukung preview dengan efek dan ekspor 1080p60.")
                result = render_reference(validate_project(project), body["output_path"],
                                          bool(body.get("rights_acknowledged")),
                                          bool(body.get("ownership_acknowledged")), signal, progress,
                                          partial_token=body.get("partial_token"))
            else:
                result = render_montage(project, body["output_path"],
                                    rights_acknowledged=bool(body.get("rights_acknowledged")),
                                    ownership_acknowledged=bool(body.get("ownership_acknowledged")),
                                    cancel_event=signal,
                                    render_mode=str(body.get("render_mode", "master")),
                                    partial_token=body.get("partial_token"),
                                    progress=progress)
            self._update(job_id, status="complete" if result["state"] == "complete" else "needs_review",
                         progress=1.0, message=result["state"], result=result)
        except InterruptedError as exc:
            self._update(job_id, status="cancelled", message="Render dibatalkan", error=str(exc))
        except Exception as exc:  # surfaced as a concise job error; full details stay in the local worker log
            self._update(job_id, status="failed", message="Render gagal", error=str(exc))
        finally:
            with self._lock:
                self._signals.pop(job_id, None)

    def _update(self, job_id: str, **values: Any) -> None:
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].update(values)
                self._jobs[job_id]["updated_utc"] = _now()

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job is not None else None

    def cancel(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            signal = self._signals.get(job_id)
            job = self._jobs.get(job_id)
            if job is None:
                return None
            if signal is not None:
                signal.cancel()
                job["message"] = "Membatalkan render…"
            return dict(job)

    def close(self) -> None:
        with self._lock:
            signals = list(self._signals.values())
        for signal in signals:
            signal.cancel()
        self._pool.shutdown(wait=False, cancel_futures=True)
