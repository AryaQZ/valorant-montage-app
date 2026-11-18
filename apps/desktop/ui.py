"""Windows-first desktop interface for manual highlight editing and export."""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
import json
import os
import subprocess
import sys
import threading
import tkinter as tk
import urllib.error
import urllib.request
import uuid

from services.worker.media import app_data_dir
from services.worker.schema import (PROFILES, ProjectValidationError, add_timeline_clip,
                                    duration_to_frames, load_project, new_project,
                                    normalize_timeline, save_project, score_event,
                                    validate_project)

ROOT_DIR = Path(__file__).resolve().parents[2]
BG = "#10141b"
PANEL = "#181e27"
PANEL_2 = "#202936"
TEXT = "#f2f4f8"
MUTED = "#a8b1c0"
ACCENT = "#ff4655"
GREEN = "#51d4a0"


def seconds_to_us(value: str) -> int:
    try:
        number = Decimal(value.strip())
    except (InvalidOperation, AttributeError) as exc:
        raise ValueError("Waktu harus berupa angka detik, misalnya 12.5.") from exc
    if not number.is_finite() or number < 0:
        raise ValueError("Waktu harus angka non-negatif.")
    return int((number * Decimal(1_000_000)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def us_to_seconds(value: int) -> str:
    return f"{value / 1_000_000:.3f}"


class MontageStudioApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("VALORANT Montage Studio")
        self.geometry("1440x900")
        self.minsize(1120, 720)
        self.configure(bg=BG)
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.project = new_project()
        self.project_path: Path | None = None
        self.undo_stack: list[dict] = []
        self.redo_stack: list[dict] = []
        self.dirty = False
        self.current_job: str | None = None
        self.worker = None
        self.worker_port: int | None = None
        self.worker_token: str | None = None
        self._poster = None
        self._index_after: str | None = None
        self._media_ids: list[str] = []
        self._event_ids: list[str] = []
        self._clip_ids: list[str] = []
        self.status_var = tk.StringVar(value="Starting local media worker…")
        self.output_var = tk.StringVar(value="")
        self.profile_var = tk.StringVar(value="MASTER 144 FPS")
        self.owner_var = tk.StringVar(value="player")
        self.source_var = tk.StringVar(value="")
        self.effects_var = tk.DoubleVar(value=0.45)
        self.beat_var = tk.DoubleVar(value=0.75)
        self.rights_var = tk.BooleanVar(value=False)
        self.owner_ack_var = tk.BooleanVar(value=False)
        self.preview_status_var = tk.StringVar(value="Pilih rekaman untuk melihat metadata.")
        self.music_status_var = tk.StringVar(value="Belum ada musik.")
        self.render_status_var = tk.StringVar(value="Belum ada render.")
        self._style()
        self._build_shell()
        try:
            self._start_worker()
            self.status_var.set("Worker lokal terhubung; file media tetap di perangkat ini.")
            self._load_capabilities()
        except Exception as exc:
            self.status_var.set("Worker lokal gagal dijalankan.")
            messagebox.showerror("Worker tidak tersedia", str(exc), parent=self)
            self.after(200, self.destroy)
            return
        self.after(30_000, self._periodic_autosave)

    def _style(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TFrame", background=BG)
        style.configure("Panel.TFrame", background=PANEL)
        style.configure("TLabel", background=BG, foreground=TEXT, font=("Segoe UI", 10))
        style.configure("Muted.TLabel", background=BG, foreground=MUTED, font=("Segoe UI", 9))
        style.configure("Panel.TLabel", background=PANEL, foreground=TEXT, font=("Segoe UI", 10))
        style.configure("Title.TLabel", background=BG, foreground=TEXT, font=("Segoe UI Semibold", 17))
        style.configure("TButton", padding=(12, 7), font=("Segoe UI Semibold", 9))
        style.configure("Accent.TButton", background=ACCENT, foreground="white", padding=(14, 8))
        style.map("Accent.TButton", background=[("active", "#e63849"), ("disabled", "#6d343c")])
        style.configure("TEntry", fieldbackground="#0c1016", foreground=TEXT, insertcolor=TEXT)
        style.configure("TCombobox", fieldbackground="#0c1016", foreground=TEXT)
        style.configure("Treeview", background="#0d1117", fieldbackground="#0d1117", foreground=TEXT,
                        rowheight=28, bordercolor=PANEL_2)
        style.configure("Treeview.Heading", background=PANEL_2, foreground=TEXT,
                        font=("Segoe UI Semibold", 9), padding=(7, 6))
        style.map("Treeview", background=[("selected", "#573039")], foreground=[("selected", "white")])
        style.configure("TNotebook", background=BG, borderwidth=0)
        style.configure("TNotebook.Tab", background=PANEL_2, foreground=TEXT, padding=(16, 9))
        style.map("TNotebook.Tab", background=[("selected", PANEL)], foreground=[("selected", "white")])
        style.configure("Horizontal.TProgressbar", background=ACCENT, troughcolor=PANEL_2)

    def _build_shell(self) -> None:
        header = ttk.Frame(self, padding=(20, 16, 20, 12))
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)
        brand = ttk.Frame(header)
        brand.grid(row=0, column=0, sticky="w")
        ttk.Label(brand, text="VALORANT MONTAGE STUDIO", style="Title.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(brand, text="LOCAL WORKFLOW  ·  MANUAL BASELINE", style="Muted.TLabel").grid(row=1, column=0, sticky="w", pady=(3, 0))
        actions = ttk.Frame(header)
        actions.grid(row=0, column=1, sticky="e")
        ttk.Button(actions, text="New", command=self.new).grid(row=0, column=0, padx=3)
        ttk.Button(actions, text="Open", command=self.open_project).grid(row=0, column=1, padx=3)
        ttk.Button(actions, text="Save", command=self.save).grid(row=0, column=2, padx=3)
        ttk.Button(actions, text="Undo", command=self.undo).grid(row=0, column=3, padx=(16, 3))
        ttk.Button(actions, text="Redo", command=self.redo).grid(row=0, column=4, padx=3)

        body = ttk.Panedwindow(self, orient="horizontal")
        body.grid(row=1, column=0, sticky="nsew", padx=16, pady=(0, 10))
        self.rowconfigure(1, weight=1)
        self.columnconfigure(0, weight=1)
        sidebar = ttk.Frame(body, style="Panel.TFrame", padding=14, width=320)
        main = ttk.Frame(body)
        body.add(sidebar, weight=1)
        body.add(main, weight=4)
        self._build_sidebar(sidebar)
        self._build_notebook(main)
        footer = ttk.Frame(self, padding=(18, 6, 18, 11))
        footer.grid(row=2, column=0, sticky="ew")
        footer.columnconfigure(0, weight=1)
        ttk.Label(footer, textvariable=self.status_var, style="Muted.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(footer, text="Smooth / Clean  ·  75% beat preference  ·  CPU-safe export",
                  style="Muted.TLabel").grid(row=0, column=1, sticky="e")

    def _build_sidebar(self, panel: ttk.Frame) -> None:
        panel.columnconfigure(0, weight=1)
        ttk.Label(panel, text="MEDIA LIBRARY", style="Panel.TLabel", font=("Segoe UI Semibold", 10)).grid(row=0, column=0, sticky="w")
        button_row = ttk.Frame(panel, style="Panel.TFrame")
        button_row.grid(row=1, column=0, sticky="ew", pady=(10, 12))
        ttk.Button(button_row, text="+ Recordings", command=self.add_media).grid(row=0, column=0, sticky="ew", padx=(0, 4))
        ttk.Button(button_row, text="+ Music", command=self.add_music).grid(row=0, column=1, sticky="ew", padx=(4, 0))
        button_row.columnconfigure(0, weight=1)
        button_row.columnconfigure(1, weight=1)
        self.media_tree = ttk.Treeview(panel, columns=("duration", "codec"), show="tree headings", height=10, selectmode="browse")
        self.media_tree.heading("#0", text="Recording")
        self.media_tree.heading("duration", text="Length")
        self.media_tree.heading("codec", text="Video")
        self.media_tree.column("#0", width=160, anchor="w")
        self.media_tree.column("duration", width=70, anchor="center")
        self.media_tree.column("codec", width=65, anchor="center")
        self.media_tree.grid(row=2, column=0, sticky="nsew")
        self.media_tree.bind("<<TreeviewSelect>>", self._on_media_selected)
        panel.rowconfigure(2, weight=1)
        self.poster_label = ttk.Label(panel, text="", style="Panel.TLabel", anchor="center")
        self.poster_label.grid(row=3, column=0, sticky="ew", pady=(12, 5))
        ttk.Label(panel, textvariable=self.preview_status_var, style="Panel.TLabel", wraplength=280,
                  justify="left").grid(row=4, column=0, sticky="ew", pady=(2, 10))
        ttk.Button(panel, text="Open selected proxy preview", command=self.open_selected_preview).grid(row=5, column=0, sticky="ew")
        self.music_badge = ttk.Label(panel, textvariable=self.music_status_var, style="Panel.TLabel", wraplength=280)
        self.music_badge.grid(row=6, column=0, sticky="ew", pady=(15, 0))

    def _build_notebook(self, panel: ttk.Frame) -> None:
        self.notebook = ttk.Notebook(panel)
        self.notebook.pack(fill="both", expand=True)
        self.highlights_tab = ttk.Frame(self.notebook, padding=18)
        self.timeline_tab = ttk.Frame(self.notebook, padding=18)
        self.export_tab = ttk.Frame(self.notebook, padding=18)
        self.ai_tab = ttk.Frame(self.notebook, padding=18)
        self.notebook.add(self.highlights_tab, text="Highlights")
        self.notebook.add(self.timeline_tab, text="Timeline")
        self.notebook.add(self.export_tab, text="Export / QA")
        self.notebook.add(self.ai_tab, text="AI Director")
        self._build_highlights_tab()
        self._build_timeline_tab()
        self._build_export_tab()
        self._build_ai_tab()

    def _build_highlights_tab(self) -> None:
        tab = self.highlights_tab
        tab.columnconfigure(0, weight=1)
        ttk.Label(tab, text="Mark verified moments from the recording", style="Title.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(tab, text="Manual baseline: this build never claims automatic kill detection.", style="Muted.TLabel").grid(row=1, column=0, sticky="w", pady=(3, 16))
        form = ttk.Frame(tab, padding=14, style="Panel.TFrame")
        form.grid(row=2, column=0, sticky="ew")
        for col in range(8):
            form.columnconfigure(col, weight=1 if col in (1, 3, 5, 7) else 0)
        ttk.Label(form, text="Source", style="Panel.TLabel").grid(row=0, column=0, sticky="w", padx=4, pady=4)
        self.source_combo = ttk.Combobox(form, textvariable=self.source_var, state="readonly", width=24)
        self.source_combo.grid(row=0, column=1, columnspan=3, sticky="ew", padx=4, pady=4)
        ttk.Label(form, text="Owner", style="Panel.TLabel").grid(row=0, column=4, sticky="w", padx=4, pady=4)
        self.owner_combo = ttk.Combobox(form, textvariable=self.owner_var, state="readonly", width=16,
                                        values=("player", "unknown"))
        self.owner_combo.grid(row=0, column=5, sticky="ew", padx=4, pady=4)
        ttk.Label(form, text="Start (s)", style="Panel.TLabel").grid(row=1, column=0, sticky="w", padx=4, pady=4)
        self.in_entry = ttk.Entry(form, width=12)
        self.in_entry.insert(0, "0")
        self.in_entry.grid(row=1, column=1, sticky="ew", padx=4, pady=4)
        ttk.Label(form, text="Impact (s)", style="Panel.TLabel").grid(row=1, column=2, sticky="w", padx=4, pady=4)
        self.impact_entry = ttk.Entry(form, width=12)
        self.impact_entry.insert(0, "0")
        self.impact_entry.grid(row=1, column=3, sticky="ew", padx=4, pady=4)
        ttk.Label(form, text="End (s)", style="Panel.TLabel").grid(row=1, column=4, sticky="w", padx=4, pady=4)
        self.out_entry = ttk.Entry(form, width=12)
        self.out_entry.insert(0, "1")
        self.out_entry.grid(row=1, column=5, sticky="ew", padx=4, pady=4)
        ttk.Label(form, text="Tags", style="Panel.TLabel").grid(row=1, column=6, sticky="w", padx=4, pady=4)
        self.tags_entry = ttk.Entry(form, width=24)
        self.tags_entry.insert(0, "headshot, multikill, clutch")
        self.tags_entry.grid(row=1, column=7, sticky="ew", padx=4, pady=4)
        action_row = ttk.Frame(form, style="Panel.TFrame")
        action_row.grid(row=2, column=0, columnspan=8, sticky="ew", pady=(12, 2))
        ttk.Button(action_row, text="Add manual highlight", style="Accent.TButton", command=self.add_event).pack(side="left", padx=(4, 8))
        ttk.Button(action_row, text="Add selected to timeline", command=self.add_selected_event_to_timeline).pack(side="left", padx=4)
        ttk.Button(action_row, text="Remove highlight", command=self.remove_event).pack(side="left", padx=4)
        ttk.Button(action_row, text="Generate rule draft", command=self.generate_rule_draft).pack(side="right", padx=4)
        self.event_tree = ttk.Treeview(tab, columns=("source", "range", "impact", "owner", "tags", "score"), show="headings", selectmode="extended")
        for column, title in (("source", "Recording"), ("range", "Source range"), ("impact", "Impact"), ("owner", "Owner"), ("tags", "Tags"), ("score", "Director score")):
            self.event_tree.heading(column, text=title)
        self.event_tree.column("source", width=180, anchor="w")
        self.event_tree.column("range", width=150, anchor="center")
        self.event_tree.column("impact", width=90, anchor="center")
        self.event_tree.column("owner", width=90, anchor="center")
        self.event_tree.column("tags", width=360, anchor="w")
        self.event_tree.column("score", width=110, anchor="center")
        self.event_tree.grid(row=3, column=0, sticky="nsew", pady=(16, 0))
        tab.rowconfigure(3, weight=1)
        self.event_tree.bind("<<TreeviewSelect>>", self._on_event_selected)

    def _build_timeline_tab(self) -> None:
        tab = self.timeline_tab
        tab.columnconfigure(0, weight=1)
        tab.rowconfigure(2, weight=1)
        ttk.Label(tab, text="Editable non-destructive cut list", style="Title.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(tab, text="Source ranges stay linked to the original recording. Reorder and trim before export.",
                  style="Muted.TLabel").grid(row=1, column=0, sticky="w", pady=(3, 12))
        self.timeline_tree = ttk.Treeview(tab, columns=("event", "source", "trim", "frames", "effects"), show="headings", selectmode="browse")
        for column, title in (("event", "Highlight"), ("source", "Recording"), ("trim", "Source trim"), ("frames", "Output frames"), ("effects", "Smooth / Clean FX")):
            self.timeline_tree.heading(column, text=title)
        self.timeline_tree.column("event", width=130, anchor="center")
        self.timeline_tree.column("source", width=260, anchor="w")
        self.timeline_tree.column("trim", width=180, anchor="center")
        self.timeline_tree.column("frames", width=120, anchor="center")
        self.timeline_tree.column("effects", width=200, anchor="center")
        self.timeline_tree.grid(row=2, column=0, sticky="nsew")
        controls = ttk.Frame(tab)
        controls.grid(row=3, column=0, sticky="ew", pady=(12, 8))
        ttk.Button(controls, text="Remove clip", command=self.remove_clip).pack(side="left", padx=(0, 6))
        ttk.Button(controls, text="Move up", command=lambda: self.move_clip(-1)).pack(side="left", padx=6)
        ttk.Button(controls, text="Move down", command=lambda: self.move_clip(1)).pack(side="left", padx=6)
        ttk.Button(controls, text="Edit trim", command=self.edit_trim).pack(side="left", padx=6)
        ttk.Button(controls, text="Preview source proxy", command=self.open_timeline_proxy).pack(side="right", padx=0)
        self.timeline_summary = ttk.Label(tab, text="Timeline kosong.", style="Muted.TLabel")
        self.timeline_summary.grid(row=4, column=0, sticky="w", pady=(3, 0))

    def _build_export_tab(self) -> None:
        tab = self.export_tab
        tab.columnconfigure(1, weight=1)
        ttk.Label(tab, text="Render and quality report", style="Title.TLabel").grid(row=0, column=0, columnspan=3, sticky="w")
        ttk.Label(tab, text="The renderer uses the same timeline model as the editor. Master export is never silently downgraded.",
                  style="Muted.TLabel", wraplength=920).grid(row=1, column=0, columnspan=3, sticky="w", pady=(4, 18))
        ttk.Label(tab, text="Output profile").grid(row=2, column=0, sticky="w", pady=6)
        self.profile_combo = ttk.Combobox(tab, textvariable=self.profile_var, state="readonly",
                                          values=("MASTER 144 FPS", "YouTube 60 FPS"), width=24)
        self.profile_combo.grid(row=2, column=1, sticky="w", pady=6)
        self.profile_combo.bind("<<ComboboxSelected>>", self._on_profile_changed)
        ttk.Label(tab, text="Output MP4").grid(row=3, column=0, sticky="w", pady=6)
        path_row = ttk.Frame(tab)
        path_row.grid(row=3, column=1, columnspan=2, sticky="ew", pady=6)
        path_row.columnconfigure(0, weight=1)
        ttk.Entry(path_row, textvariable=self.output_var).grid(row=0, column=0, sticky="ew", padx=(0, 8))
        ttk.Button(path_row, text="Browse", command=self.choose_output).grid(row=0, column=1)
        ttk.Label(tab, text="Beat sync priority").grid(row=4, column=0, sticky="w", pady=6)
        self.beat_scale = ttk.Scale(tab, from_=0, to=1, variable=self.beat_var)
        self.beat_scale.grid(row=4, column=1, sticky="ew", pady=6)
        self.beat_scale.bind("<ButtonRelease-1>", lambda _event: self._set_beat_priority(str(self.beat_var.get())))
        ttk.Label(tab, text="75% soft preference; rule planner does not align cuts to beats yet.",
                  style="Muted.TLabel").grid(row=4, column=2, sticky="w", padx=8)
        ttk.Label(tab, text="Effects intensity").grid(row=5, column=0, sticky="w", pady=6)
        self.effects_scale = ttk.Scale(tab, from_=0, to=1, variable=self.effects_var)
        self.effects_scale.grid(row=5, column=1, sticky="ew", pady=6)
        self.effects_scale.bind("<ButtonRelease-1>", lambda _event: self._set_effect_intensity(str(self.effects_var.get())))
        ttk.Label(tab, text="Subtle impact zoom (0 disables effects).", style="Muted.TLabel").grid(row=5, column=2, sticky="w", padx=8)
        ttk.Checkbutton(tab, text="I own or have permission to use the selected music.", variable=self.rights_var).grid(row=6, column=0, columnspan=3, sticky="w", pady=(14, 4))
        ttk.Checkbutton(tab, text="I reviewed the selected clips and confirm any owner=unknown highlights.", variable=self.owner_ack_var).grid(row=7, column=0, columnspan=3, sticky="w", pady=4)
        action_row = ttk.Frame(tab)
        action_row.grid(row=8, column=0, columnspan=3, sticky="ew", pady=(16, 12))
        self.render_button = ttk.Button(action_row, text="Export montage", style="Accent.TButton", command=self.start_render)
        self.render_button.pack(side="left", padx=(0, 8))
        self.cancel_button = ttk.Button(action_row, text="Cancel render", command=self.cancel_render, state="disabled")
        self.cancel_button.pack(side="left", padx=8)
        self.open_output_button = ttk.Button(action_row, text="Open output", command=self.open_output, state="disabled")
        self.open_output_button.pack(side="right")
        self.progress = ttk.Progressbar(tab, mode="determinate", maximum=100)
        self.progress.grid(row=9, column=0, columnspan=3, sticky="ew", pady=(2, 4))
        ttk.Label(tab, textvariable=self.render_status_var, style="Muted.TLabel", wraplength=920).grid(row=10, column=0, columnspan=3, sticky="w", pady=(6, 14))
        self.capabilities_text = tk.Text(tab, height=8, bg="#0c1016", fg=MUTED, relief="flat", wrap="word", font=("Consolas", 9), state="disabled")
        self.capabilities_text.grid(row=11, column=0, columnspan=3, sticky="ew", pady=(5, 0))
        tab.rowconfigure(11, weight=1)

    def _build_ai_tab(self) -> None:
        tab = self.ai_tab
        tab.columnconfigure(0, weight=1)
        ttk.Label(tab, text="AI Creative Director", style="Title.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(tab, text="Current build: rule-only director is active. Automatic VALORANT event detection and SIWC sign-in are not connected yet.",
                  style="Muted.TLabel", wraplength=860).grid(row=1, column=0, sticky="w", pady=(5, 18))
        card = ttk.Frame(tab, style="Panel.TFrame", padding=16)
        card.grid(row=2, column=0, sticky="ew")
        ttk.Label(card, text="ChatGPT Subscription", style="Panel.TLabel", font=("Segoe UI Semibold", 11)).grid(row=0, column=0, sticky="w")
        ttk.Label(card, text="SIWC: not connected / implementation pending. No API key is requested or used.",
                  style="Panel.TLabel", wraplength=800, justify="left").grid(row=1, column=0, sticky="w", pady=(8, 6))
        ttk.Label(card, text="The rule-only draft uses only manually annotated event IDs. It cannot invent detections, and every proposal remains editable.",
                  style="Panel.TLabel", wraplength=800, justify="left").grid(row=2, column=0, sticky="w", pady=(0, 8))
        ttk.Label(tab, text="Music analysis uses local FFmpeg decoding. Beat candidates are estimates and are not yet used to move cuts.",
                  style="Muted.TLabel", wraplength=860).grid(row=3, column=0, sticky="w", pady=(16, 4))
        ttk.Label(tab, text="No raw video, screenshots, or audio are sent to an online service in this build.",
                  style="Muted.TLabel", wraplength=860).grid(row=4, column=0, sticky="w")

    def _start_worker(self) -> None:
        log_dir = app_data_dir() / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "worker.log"
        self._worker_log = log_path.open("a", encoding="utf-8")
        env = os.environ.copy()
        env["PYTHONPATH"] = str(ROOT_DIR) + os.pathsep + env.get("PYTHONPATH", "")
        self.worker = subprocess.Popen([sys.executable, "-m", "services.worker"], cwd=ROOT_DIR,
                                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                       stderr=self._worker_log, text=True, encoding="utf-8", env=env)
        assert self.worker.stdout is not None
        line = self.worker.stdout.readline()
        if not line:
            raise RuntimeError(f"Worker berhenti saat startup. Periksa log lokal: {log_path}")
        ready = json.loads(line)
        if ready.get("type") != "ready" or not isinstance(ready.get("port"), int) or not ready.get("token"):
            raise RuntimeError("Worker mengirim pesan startup yang tidak valid.")
        self.worker_port = ready["port"]
        self.worker_token = ready["token"]
        health = self._api("GET", "/v1/health")
        if health.get("status") != "ok":
            raise RuntimeError("Health check worker gagal.")

    def _api(self, method: str, route: str, body: dict | None = None, timeout: int = 30) -> dict:
        if self.worker_port is None or self.worker_token is None:
            raise RuntimeError("Worker tidak sedang terhubung.")
        url = f"http://127.0.0.1:{self.worker_port}{route}"
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(url, data=data, method=method,
                                         headers={"Authorization": f"Bearer {self.worker_token}",
                                                  "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read(8 * 1024 * 1024 + 1)
                if len(payload) > 8 * 1024 * 1024:
                    raise RuntimeError("Respons worker melebihi batas ukuran.")
                return json.loads(payload.decode("utf-8")) if payload else {}
        except urllib.error.HTTPError as exc:
            try:
                message = json.loads(exc.read().decode("utf-8")).get("error", str(exc))
            except Exception:
                message = str(exc)
            raise RuntimeError(message) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Worker lokal tidak merespons: {exc.reason}") from exc

    def _load_capabilities(self) -> None:
        def work() -> None:
            try:
                value = self._api("GET", "/v1/capabilities")
                self.after(0, lambda: self._show_capabilities(value))
            except Exception as exc:
                self.after(0, lambda error=str(exc): self._set_status(f"Tidak dapat membaca kemampuan FFmpeg: {error}"))
        threading.Thread(target=work, daemon=True).start()

    def _show_capabilities(self, value: dict) -> None:
        media = value.get("media", {})
        if media.get("available"):
            text = f"{media.get('version', 'FFmpeg tersedia')}\nCPU encoder: {'libx264' if 'libx264' in media.get('encoders', []) else 'not found'}\nGPU encoders detected: {', '.join(e for e in media.get('encoders', []) if e != 'libx264') or 'none'}"
        else:
            text = f"Media capability unavailable\n{media.get('diagnostic', 'FFmpeg dan FFprobe tidak tersedia.')}\n\nInstall FFmpeg, add its bin folder to PATH, lalu restart aplikasi untuk impor/render media."
        self.capabilities_text.configure(state="normal")
        self.capabilities_text.delete("1.0", "end")
        self.capabilities_text.insert("1.0", text)
        self.capabilities_text.configure(state="disabled")

    def _set_status(self, value: str) -> None:
        self.status_var.set(value)

    def _snapshot(self) -> None:
        self.undo_stack.append(deepcopy(self.project))
        if len(self.undo_stack) > 50:
            self.undo_stack.pop(0)
        self.redo_stack.clear()

    def _changed(self, message: str) -> None:
        self.dirty = True
        self.status_var.set(message)
        self._refresh_all()
        self._autosave()

    def _autosave(self) -> None:
        try:
            folder = app_data_dir() / "autosave"
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / f"{self.project['project_id']}.vmsproj.json"
            save_project(self.project, path)
            if self._index_after is not None:
                self.after_cancel(self._index_after)
            snapshot = deepcopy(self.project)
            self._index_after = self.after(1000, lambda: self._index_snapshot(snapshot, path))
        except Exception as exc:
            self.status_var.set(f"Autosave gagal: {exc}")

    def _index_snapshot(self, project: dict, path: Path) -> None:
        self._index_after = None
        def work() -> None:
            try:
                self._api("POST", "/v1/library/index", {"project": project, "json_path": str(path)})
            except Exception as exc:
                self.after(0, lambda error=str(exc): self._set_status(f"SQLite index gagal diperbarui: {error}"))
        threading.Thread(target=work, daemon=True).start()

    def _periodic_autosave(self) -> None:
        if self.dirty:
            self._autosave()
        self.after(30_000, self._periodic_autosave)

    def new(self) -> None:
        if self.dirty and not messagebox.askyesno("New project", "Buang perubahan project yang belum disimpan?", parent=self):
            return
        self._snapshot()
        self.project = new_project()
        self.project_path = None
        self.output_var.set("")
        self.dirty = False
        self._refresh_all()
        self.status_var.set("Project baru siap.")

    def open_project(self) -> None:
        path = filedialog.askopenfilename(parent=self, title="Open montage project",
                                         filetypes=(("VMS project", "*.vmsproj.json"), ("JSON project", "*.json")))
        if not path:
            return
        try:
            project = load_project(path)
            self._snapshot()
            self.project = project
            self.project_path = Path(path)
            self.dirty = False
            self._refresh_all()
            missing = [Path(item["path"]).name for item in project["sources"] if not Path(item["path"]).is_file()]
            if project.get("music") and not Path(project["music"]["path"]).is_file():
                missing.append(Path(project["music"]["path"]).name)
            self.status_var.set(f"Project dibuka: {Path(path).name}" + (f"; {len(missing)} media hilang." if missing else ""))
        except Exception as exc:
            messagebox.showerror("Open project gagal", str(exc), parent=self)

    def save(self) -> None:
        path = self.project_path
        if path is None:
            chosen = filedialog.asksaveasfilename(parent=self, title="Save montage project",
                                                  defaultextension=".vmsproj.json",
                                                  filetypes=(("VMS project", "*.vmsproj.json"), ("JSON", "*.json")))
            if not chosen:
                return
            path = Path(chosen)
        try:
            save_project(self.project, path)
            self.project_path = path
            self.dirty = False
            self.status_var.set(f"Project disimpan: {path.name}")
            project_snapshot = deepcopy(self.project)
            threading.Thread(target=lambda: self._index_project_safely(project_snapshot, path), daemon=True).start()
        except Exception as exc:
            messagebox.showerror("Save project gagal", str(exc), parent=self)

    def _index_project_safely(self, project: dict, path: Path) -> None:
        try:
            self._api("POST", "/v1/library/index", {"project": project, "json_path": str(path)})
        except Exception as exc:
            self.after(0, lambda error=str(exc): self._set_status(f"Project tersimpan, tetapi SQLite index gagal: {error}"))

    def undo(self) -> None:
        if not self.undo_stack:
            return
        self.redo_stack.append(deepcopy(self.project))
        self.project = self.undo_stack.pop()
        self.dirty = True
        self._changed("Perubahan terakhir dibatalkan.")

    def redo(self) -> None:
        if not self.redo_stack:
            return
        self.undo_stack.append(deepcopy(self.project))
        self.project = self.redo_stack.pop()
        self.dirty = True
        self._changed("Perubahan dipulihkan.")

    def add_media(self) -> None:
        paths = filedialog.askopenfilenames(parent=self, title="Import gameplay recordings",
                                            filetypes=(("Video recordings", "*.mp4 *.mkv *.mov *.m4v *.webm *.avi *.ts *.mts"),
                                                       ("All files", "*.*")))
        if not paths:
            return
        self.status_var.set(f"Membaca metadata {len(paths)} file…")
        def work() -> None:
            results, errors = [], []
            for path in paths:
                if any(Path(item["path"]).resolve() == Path(path).resolve() for item in self.project["sources"]):
                    continue
                try:
                    results.append(self._api("POST", "/v1/media/import", {"path": path}, timeout=60 * 60))
                except Exception as exc:
                    errors.append(f"{Path(path).name}: {exc}")
            self.after(0, lambda: self._finish_media_import(results, errors))
        threading.Thread(target=work, daemon=True).start()

    def _finish_media_import(self, results: list[dict], errors: list[str]) -> None:
        if results:
            self._snapshot()
            self.project["sources"].extend(results)
            self._changed(f"{len(results)} recording berhasil diimpor. Metadata tersimpan dalam project.")
        if errors:
            messagebox.showwarning("Sebagian file gagal diimpor", "\n".join(errors[:12]), parent=self)
        if not results and not errors:
            self.status_var.set("Tidak ada source baru.")

    def add_music(self) -> None:
        path = filedialog.askopenfilename(parent=self, title="Import licensed music",
                                          filetypes=(("Audio", "*.mp3 *.wav *.m4a *.aac *.flac *.ogg *.opus *.wma"), ("All files", "*.*")))
        if not path:
            return
        self.status_var.set("Membaca musik dan membangun beat candidates secara lokal…")
        def work() -> None:
            try:
                metadata = self._api("POST", "/v1/music/probe", {"path": path})
                analysis = self._api("POST", "/v1/music/analyze", {"path": path}, timeout=60 * 60)
                result = {**metadata, **analysis, "rights_acknowledged": False, "offset_us": 0}
                self.after(0, lambda: self._finish_music_import(result))
            except Exception as exc:
                self.after(0, lambda error=str(exc): messagebox.showerror("Import musik gagal", error, parent=self))
        threading.Thread(target=work, daemon=True).start()

    def _finish_music_import(self, result: dict) -> None:
        self._snapshot()
        self.project["music"] = result
        self.rights_var.set(False)
        self._changed(f"Musik lokal dianalisis: {result.get('bpm_estimate', '?')} BPM perkiraan; {len(result.get('beat_grid', []))} marker kandidat.")

    def add_event(self) -> None:
        media_id = self._selected_media_id()
        if not media_id:
            messagebox.showwarning("Pilih recording", "Pilih recording terlebih dahulu.", parent=self)
            return
        source = self._source(media_id)
        try:
            start = seconds_to_us(self.in_entry.get())
            impact = seconds_to_us(self.impact_entry.get())
            end = seconds_to_us(self.out_entry.get())
            if not start < end or not start <= impact <= end:
                raise ValueError("Gunakan rentang start <= impact <= end dan durasi positif.")
            if end > source["duration_us"]:
                raise ValueError("End highlight melewati durasi rekaman.")
        except ValueError as exc:
            messagebox.showerror("Range highlight tidak valid", str(exc), parent=self)
            return
        source_fps = (source.get("video") or {}).get("avg_frame_rate") or (0, 1)
        fps_num, fps_den = source_fps
        source_frame = max(0, round(impact * fps_num / (1_000_000 * fps_den))) if fps_num else 0
        tags = sorted({tag.strip().lower() for tag in self.tags_entry.get().split(",") if tag.strip()})
        event = {"event_id": str(uuid.uuid4()), "source_media_id": media_id,
                 "source_time_us": impact, "source_frame": source_frame,
                 "in_us": start, "out_us": end,
                 "evidence": [{"type": "user_annotation", "method": "manual_baseline"}],
                 "owner": self.owner_var.get(), "confidence": 1.0, "tags": tags,
                 "cluster_id": None, "rating": None, "is_user_override": True}
        self._snapshot()
        self.project["events"].append(event)
        self._changed("Highlight manual tersimpan; tidak ada deteksi otomatis yang diklaim.")

    def remove_event(self) -> None:
        selected = self.event_tree.selection()
        if not selected:
            return
        event_id = selected[0]
        self._snapshot()
        self.project["events"] = [item for item in self.project["events"] if item["event_id"] != event_id]
        self.project["timeline"] = [clip for clip in self.project["timeline"] if clip["event_id"] != event_id]
        normalize_timeline(self.project)
        self._changed("Highlight dan clip yang menggunakannya dihapus.")

    def add_selected_event_to_timeline(self) -> None:
        selected = self.event_tree.selection()
        if not selected:
            messagebox.showinfo("Pilih highlight", "Pilih satu atau lebih highlight pada tabel.", parent=self)
            return
        self._snapshot()
        try:
            for event_id in selected:
                add_timeline_clip(self.project, event_id)
        except Exception:
            self.project = self.undo_stack.pop()
            raise
        self._changed(f"{len(selected)} highlight ditambahkan ke timeline.")
        self.notebook.select(self.timeline_tab)

    def generate_rule_draft(self) -> None:
        if not self.project["events"]:
            messagebox.showinfo("Belum ada highlight", "Tambahkan highlight manual sebelum membuat draft.", parent=self)
            return
        weights = self.project.get("preferences", {}).get("event_weights", {})
        # A low-to-high energy curve keeps stronger, explicitly tagged moments toward the later peaks.
        events = sorted(self.project["events"], key=lambda event: (score_event(event, weights), event["source_time_us"]))
        selected = [event for event in events if event["confidence"] >= 0.4]
        self._snapshot()
        try:
            self.project["timeline"] = []
            for event in selected:
                add_timeline_clip(self.project, event["event_id"])
            self.project["director"] = {"mode": "rule_only", "last_proposal": {
                "selected_event_ids": [event["event_id"] for event in selected],
                "scores": {event["event_id"]: score_event(event, weights) for event in selected},
                "rationale": ["Urutan menaik menurut skor tag manual untuk membangun energi.",
                              "Proposal rule-only memakai event yang dianotasi pengguna saja."],
                "status": "proposal_needs_user_review"}}
        except Exception:
            self.project = self.undo_stack.pop()
            raise
        self._changed(f"Rule-only draft dibuat dari {len(selected)} anotasi manual.")
        self.notebook.select(self.timeline_tab)

    def remove_clip(self) -> None:
        selected = self.timeline_tree.selection()
        if not selected:
            return
        self._snapshot()
        self.project["timeline"] = [clip for clip in self.project["timeline"] if clip["clip_id"] != selected[0]]
        normalize_timeline(self.project)
        self._changed("Clip dihapus dari timeline.")

    def move_clip(self, delta: int) -> None:
        selected = self.timeline_tree.selection()
        if not selected:
            return
        clip_id = selected[0]
        index = next((idx for idx, clip in enumerate(self.project["timeline"]) if clip["clip_id"] == clip_id), None)
        if index is None or not 0 <= index + delta < len(self.project["timeline"]):
            return
        self._snapshot()
        clips = self.project["timeline"]
        clips[index], clips[index + delta] = clips[index + delta], clips[index]
        normalize_timeline(self.project)
        self._changed("Urutan timeline diperbarui.")
        self.timeline_tree.selection_set(clip_id)

    def edit_trim(self) -> None:
        selected = self.timeline_tree.selection()
        if not selected:
            messagebox.showinfo("Pilih clip", "Pilih clip yang ingin dipangkas.", parent=self)
            return
        clip = next(item for item in self.project["timeline"] if item["clip_id"] == selected[0])
        event = next(item for item in self.project["events"] if item["event_id"] == clip["event_id"])
        start = simpledialog.askstring("Edit trim", f"Source start in seconds (event range {us_to_seconds(event['in_us'])}–{us_to_seconds(event['out_us'])})", initialvalue=us_to_seconds(clip["in_us"]), parent=self)
        if start is None:
            return
        end = simpledialog.askstring("Edit trim", "Source end in seconds", initialvalue=us_to_seconds(clip["out_us"]), parent=self)
        if end is None:
            return
        try:
            start_us, end_us = seconds_to_us(start), seconds_to_us(end)
            if not event["in_us"] <= start_us < end_us <= event["out_us"]:
                raise ValueError("Trim harus tetap di dalam range event.")
            self._snapshot()
            clip["in_us"], clip["out_us"] = start_us, end_us
            normalize_timeline(self.project)
            self._changed("Trim clip diperbarui.")
        except (ValueError, ProjectValidationError) as exc:
            messagebox.showerror("Trim tidak valid", str(exc), parent=self)

    def _set_effect_intensity(self, value: str) -> None:
        intensity = round(float(value), 2)
        if abs(intensity - self.project["settings"].get("effects_intensity", 0.45)) < 0.015:
            return
        self._snapshot()
        self.project["settings"]["effects_intensity"] = intensity
        for clip in self.project["timeline"]:
            clip["effects"] = ([{"type": "impact_zoom", "max_zoom": round(1 + 0.04 * intensity, 4),
                                  "duration_frames": 24, "anchor": "impact", "enabled": True}]
                                if intensity > 0 else [])
        self._changed(f"Impact zoom intensity diset ke {intensity:.2f}.")

    def _set_beat_priority(self, value: str) -> None:
        priority = round(float(value), 2)
        if abs(priority - self.project["settings"].get("beat_sync_priority", 0.75)) < 0.015:
            return
        self._snapshot()
        self.project["settings"]["beat_sync_priority"] = priority
        self._changed(f"Soft beat preference diset ke {priority:.0%}; belum diterapkan oleh baseline planner.")

    def _on_profile_changed(self, _event: object) -> None:
        profile = "master_144" if self.profile_var.get().startswith("MASTER") else "youtube_60"
        if profile == self.project["settings"]["output_profile"]:
            return
        self._snapshot()
        self.project["settings"]["output_profile"] = profile
        normalize_timeline(self.project)
        self._changed(f"Output profile: {PROFILES[profile]} FPS; timeline frame positions recalculated.")

    def choose_output(self) -> None:
        path = filedialog.asksaveasfilename(parent=self, title="Choose MP4 output", defaultextension=".mp4",
                                            filetypes=(("MP4 video", "*.mp4"),))
        if path:
            self.output_var.set(path)

    def start_render(self) -> None:
        if self.current_job:
            return
        if not self.output_var.get().strip():
            self.choose_output()
        if not self.output_var.get().strip():
            return
        self.render_button.configure(state="disabled")
        self.render_status_var.set("Menjalankan preflight timeline, media, hak musik, dan ruang disk…")
        body = {"project": deepcopy(self.project), "output_path": self.output_var.get().strip(),
                "rights_acknowledged": self.rights_var.get(),
                "ownership_acknowledged": self.owner_ack_var.get()}
        def work() -> None:
            try:
                preflight = self._api("POST", "/v1/render/preflight", body)
                if preflight["errors"]:
                    raise RuntimeError("\n".join(preflight["errors"]))
                job = self._api("POST", "/v1/render", body)
                self.after(0, lambda: self._render_started(job, preflight))
            except Exception as exc:
                self.after(0, lambda error=str(exc): self._render_failed(error))
        threading.Thread(target=work, daemon=True).start()

    def _render_started(self, job: dict, preflight: dict) -> None:
        self.current_job = job["job_id"]
        self.cancel_button.configure(state="normal")
        self.progress.configure(value=0)
        mins = preflight["duration_us"] / 60_000_000
        self.render_status_var.set(f"Render {preflight['total_frames']} frames pada {preflight['fps']} FPS ({mins:.2f} menit target).")
        self._poll_job()

    def _poll_job(self) -> None:
        if not self.current_job:
            return
        job_id = self.current_job
        def work() -> None:
            try:
                job = self._api("GET", f"/v1/jobs/{job_id}")
                self.after(0, lambda: self._render_job_updated(job))
            except Exception as exc:
                self.after(0, lambda error=str(exc): self._render_failed(error))
        threading.Thread(target=work, daemon=True).start()

    def _render_job_updated(self, job: dict) -> None:
        self.progress.configure(value=max(0, min(100, float(job.get("progress", 0)) * 100)))
        self.render_status_var.set(job.get("message", job["status"]))
        if job["status"] in {"queued", "running"}:
            self.after(900, self._poll_job)
            return
        self.current_job = None
        self.cancel_button.configure(state="disabled")
        self.render_button.configure(state="normal")
        if job["status"] in {"complete", "needs_review"}:
            result = job.get("result") or {}
            self.render_status_var.set(f"Export selesai dengan status QA {result.get('qa', {}).get('status', 'UNKNOWN')}.\nOutput: {result.get('output_path', '')}\nLaporan: {result.get('qa_html', '')}")
            self.open_output_button.configure(state="normal" if result.get("output_path") else "disabled")
            self.status_var.set(f"Export {job['status']}; periksa report sebelum membagikan output.")
            if job["status"] == "needs_review":
                messagebox.showwarning("QA perlu ditinjau", "Render tersimpan, tetapi laporan QC bukan PASS. Periksa HTML QA.", parent=self)
        elif job["status"] == "cancelled":
            self.render_status_var.set("Render dibatalkan; partial output dibersihkan.")
        else:
            self._render_failed(job.get("error") or "Render gagal.")

    def _render_failed(self, message: str) -> None:
        self.current_job = None
        self.cancel_button.configure(state="disabled")
        self.render_button.configure(state="normal")
        self.render_status_var.set(message)
        messagebox.showerror("Export gagal", message, parent=self)

    def cancel_render(self) -> None:
        if not self.current_job:
            return
        job_id = self.current_job
        self.cancel_button.configure(state="disabled")
        threading.Thread(target=lambda: self._api("DELETE", f"/v1/jobs/{job_id}"), daemon=True).start()
        self.render_status_var.set("Permintaan pembatalan dikirim ke FFmpeg…")

    def open_output(self) -> None:
        path = Path(self.output_var.get())
        if path.exists():
            self._open_local(path)

    def open_selected_preview(self) -> None:
        media_id = self._selected_media_id()
        if not media_id:
            return
        path = self._source(media_id).get("proxy_path")
        if path and Path(path).exists():
            self._open_local(Path(path))
        else:
            messagebox.showinfo("Proxy belum tersedia", "Proxy dibuat saat import jika FFmpeg tersedia. Periksa PATH dan impor ulang file.", parent=self)

    def open_timeline_proxy(self) -> None:
        selected = self.timeline_tree.selection()
        if not selected:
            return
        clip = next(item for item in self.project["timeline"] if item["clip_id"] == selected[0])
        source = self._source(clip["source_media_id"])
        path = source.get("proxy_path")
        if path and Path(path).exists():
            self._open_local(Path(path))
        else:
            messagebox.showinfo("Proxy belum tersedia", "Proxy preview tidak tersedia untuk source ini.", parent=self)

    def _open_local(self, path: Path) -> None:
        try:
            if sys.platform == "win32":
                os.startfile(str(path))
            else:
                subprocess.Popen(["xdg-open", str(path)], stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as exc:
            messagebox.showerror("Tidak dapat membuka file", str(exc), parent=self)

    def _on_media_selected(self, _event: object) -> None:
        selected = self.media_tree.selection()
        if not selected:
            return
        source = self._source(selected[0])
        self.source_var.set(source["filename"])
        video = source.get("video", {})
        rate = video.get("avg_frame_rate")
        fps_text = f"{rate[0] / rate[1]:.3f} FPS" if rate and rate[1] else "FPS unknown"
        details = f"{source['filename']}\n{video.get('width')}×{video.get('height')}  ·  {fps_text}\nDuration {us_to_seconds(source['duration_us'])} s  ·  audio {'yes' if source.get('has_audio') else 'no'}"
        if source.get("warning"):
            details += f"\n{source['warning']}"
        self.preview_status_var.set(details)
        image_path = source.get("thumbnail_path")
        try:
            self._poster = tk.PhotoImage(file=image_path) if image_path and Path(image_path).is_file() else None
            self.poster_label.configure(image=self._poster or "", text="" if self._poster else "No thumbnail available")
        except tk.TclError:
            self._poster = None
            self.poster_label.configure(image="", text="No thumbnail available")

    def _on_event_selected(self, _event: object) -> None:
        selected = self.event_tree.selection()
        if not selected:
            return
        event = next(item for item in self.project["events"] if item["event_id"] == selected[0])
        self.source_var.set(self._source(event["source_media_id"])["filename"])

    def _selected_media_id(self) -> str | None:
        selected = self.media_tree.selection()
        if selected:
            return selected[0]
        if self.source_var.get():
            source = next((item for item in self.project["sources"] if item["filename"] == self.source_var.get()), None)
            return source["media_id"] if source else None
        return None

    def _source(self, media_id: str) -> dict:
        return next(item for item in self.project["sources"] if item["media_id"] == media_id)

    def _refresh_all(self) -> None:
        source_names = []
        self.media_tree.delete(*self.media_tree.get_children())
        for source in self.project.get("sources", []):
            duration = source.get("duration_us", 0)
            filename = source.get("filename") or Path(source["path"]).name
            video = source.get("video", {})
            codec = video.get("codec", "?")
            self.media_tree.insert("", "end", iid=source["media_id"], text=filename,
                                   values=(f"{duration / 1_000_000:.1f}s", codec))
            source_names.append(filename)
        self.source_combo.configure(values=source_names)
        if self.source_var.get() not in source_names:
            self.source_var.set(source_names[0] if source_names else "")
        if self.source_var.get():
            item = next((s for s in self.project["sources"] if s.get("filename") == self.source_var.get()), None)
            if item and item["media_id"] in self.media_tree.get_children():
                self.media_tree.selection_set(item["media_id"])
        self.event_tree.delete(*self.event_tree.get_children())
        self._event_ids = []
        for event in self.project.get("events", []):
            source = next((s for s in self.project["sources"] if s["media_id"] == event["source_media_id"]), None)
            name = source.get("filename", "missing") if source else "missing"
            event_id = event["event_id"]
            self.event_tree.insert("", "end", iid=event_id,
                                   values=(name, f"{us_to_seconds(event['in_us'])}–{us_to_seconds(event['out_us'])}",
                                           us_to_seconds(event["source_time_us"]), event["owner"],
                                           ", ".join(event.get("tags", [])) or "—", score_event(event)))
            self._event_ids.append(event_id)
        self.timeline_tree.delete(*self.timeline_tree.get_children())
        self._clip_ids = []
        for index, clip in enumerate(self.project.get("timeline", []), 1):
            event = next((e for e in self.project["events"] if e["event_id"] == clip["event_id"]), {})
            source = next((s for s in self.project["sources"] if s["media_id"] == clip["source_media_id"]), {})
            effects = "Impact zoom" if clip.get("effects") else "Off"
            self.timeline_tree.insert("", "end", iid=clip["clip_id"],
                                      values=(f"{index:02d} · {', '.join(event.get('tags', [])) or 'manual'}",
                                              source.get("filename", "missing"),
                                              f"{us_to_seconds(clip['in_us'])}–{us_to_seconds(clip['out_us'])} s",
                                              clip["duration_frames"], effects))
            self._clip_ids.append(clip["clip_id"])
        fps = PROFILES[self.project["settings"]["output_profile"]]
        total_frames = sum(clip["duration_frames"] for clip in self.project["timeline"])
        self.timeline_summary.configure(text=f"{len(self.project['timeline'])} clips  ·  {total_frames} frames  ·  {total_frames / fps:.2f} s @ {fps} FPS")
        self.effects_var.set(float(self.project["settings"].get("effects_intensity", 0.45)))
        self.beat_var.set(float(self.project["settings"].get("beat_sync_priority", 0.75)))
        self.profile_var.set("MASTER 144 FPS" if self.project["settings"]["output_profile"] == "master_144" else "YouTube 60 FPS")
        music = self.project.get("music")
        if music:
            self.music_status_var.set(f"Music: {Path(music['path']).name}\nEstimated {music.get('bpm_estimate', '?')} BPM · {len(music.get('beat_grid', []))} beat candidates · local analysis")
        else:
            self.music_status_var.set("Belum ada musik.")

    def _on_close(self) -> None:
        if self.current_job and not messagebox.askyesno("Render berjalan", "Batalkan render dan tutup aplikasi?", parent=self):
            return
        if self.current_job:
            self.cancel_render()
        try:
            if self.worker and self.worker.poll() is None:
                self.worker.terminate()
                try:
                    self.worker.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    self.worker.kill()
        except Exception:
            pass
        try:
            if hasattr(self, "_worker_log"):
                self._worker_log.close()
        except Exception:
            pass
        self.destroy()
