import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { version } from '../../package.json';
import appIcon from './assets/app-icon.png';
import { ChatGPTConnectionCard } from '@siwc/react';
import '@siwc/react/styles.css';
import { AI_EFFORTS, MAX_AI_REQUESTS_PER_PROJECT, supportsAIEffort, type AIEffort, type AIKillReview,
  type AIState, type KillCandidate, type ReferenceDraft, type RenderJob, type WorkerState } from '../../shared/bridge.js';
import { applyProposal, autoKillClipBounds, createProject, FPS, isAutoKill, isolatedKillWindow, makeAutomaticEffects, makeClip, makePostKillSpeedRamp, rebuildTimeline, removeReviewedHighlight, resizeClipRange, trimOverlappingAutoKillClips,
  toggleReverseImpactReplay, type DirectorProposal,
  type Effect, type HighlightEvent, type MediaSource, type Project } from '../../shared/project.js';
import { buildRuleProposal } from '../../shared/director.js';
import { isEditableShortcutTarget, resolveGlobalShortcut } from '../../shared/shortcuts.js';

type Notice = { kind: 'error' | 'success' | 'info'; text: string };
const AI_EFFORT_LABELS: Record<AIEffort, string> = {
  auto: 'Otomatis (bawaan model)', low: 'Ringan (Low)', medium: 'Sedang (Medium)',
  high: 'Tinggi (High)', xhigh: 'Sangat tinggi (Extra High)', max: 'Maksimum (Max)',
};
const uuid = () => crypto.randomUUID();
const seconds = (value: number) => (value / 1_000_000).toFixed(2);
const timecode = (value: number) => {
  const sec = Math.max(0, value / 1_000_000);
  const mins = Math.floor(sec / 60);
  return `${String(mins).padStart(2, '0')}:${(sec - mins * 60).toFixed(2).padStart(5, '0')}`;
};
const fpsOf = (source: MediaSource) => {
  const rate = source.video.avg_frame_rate;
  return rate && rate[1] ? rate[0] / rate[1] : 60;
};
const fmtBytes = (bytes: number) => bytes < 1_000_000_000 ? `${(bytes / 1_000_000).toFixed(0)} MB` : `${(bytes / 1_000_000_000).toFixed(2)} GB`;
const matchesCandidate = (event: Pick<HighlightEvent, 'source_media_id' | 'source_time_us' | 'source_frame'>, candidate: KillCandidate) =>
  event.source_media_id === candidate.source_media_id && (event.source_time_us === candidate.source_time_us || event.source_frame === candidate.source_frame);
const isDismissedCandidate = (project: Project, candidate: KillCandidate) =>
  project.dismissed_kill_candidates?.some(event => matchesCandidate(event, candidate)) ?? false;
const highlightLabel = (event: HighlightEvent) => isAutoKill(event)
  ? event.tags.includes('headshot') ? 'Single kill · Headshot' : 'Single kill'
  : event.tags.length ? event.tags.map(tag => tag.replace('_', ' ')).join(' · ') : 'Highlight manual';

type SettingsSliderProps = {
  label: string;
  value: number;
  max: number;
  min?: number;
  step?: number;
  unit?: 'percent' | 'multiplier';
  help?: string;
  onValue: (value: number) => void;
};

function SettingsSlider({ label, value, max, min = 0, step = 0.01, unit = 'percent', help, onValue }: SettingsSliderProps) {
  const id = useId();
  const progress = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const readout = unit === 'percent' ? Math.round(value * 100) + '%' : value.toFixed(3) + '×';
  return <div className="slider-control">
    <div><label htmlFor={id}>{label}</label><output htmlFor={id} aria-hidden="true">{readout}</output></div>
    <input id={id} type="range" min={min} max={max} step={step} value={value}
      style={{ '--range-progress': progress } as CSSProperties} aria-valuetext={readout}
      aria-describedby={help ? id + '-help' : undefined}
      onChange={event => onValue(event.currentTarget.valueAsNumber)} />
    {help && <small id={id + '-help'}>{help}</small>}
  </div>;
}

export default function App() {
  const [project, setProject] = useState<Project>(() => createProject());
  const projectRef = useRef(project);
  const openedSnapshot = useRef(project);
  const undoStack = useRef<Project[]>([]);
  const redoStack = useRef<Project[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewStageRef = useRef<HTMLElement>(null);
  const exportDialogRef = useRef<HTMLDialogElement>(null);
  const [monitorTime, setMonitorTime] = useState(0);
  const [monitorDuration, setMonitorDuration] = useState(0);
  const [monitorPlaying, setMonitorPlaying] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [missingMediaPaths, setMissingMediaPaths] = useState<string[]>([]);
  const [saveState, setSaveState] = useState('Belum disimpan');
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [selectedClipId, setSelectedClipId] = useState('');
  const [activePanel, setActivePanel] = useState<'edit' | 'director'>('edit');
  const [workerState, setWorkerState] = useState<WorkerState | null>(null);
  const [aiState, setAIState] = useState<AIState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState('');
  const [busyElapsedSec, setBusyElapsedSec] = useState(0);
  const [manualMarking, setManualMarking] = useState(false);
  const [eventIn, setEventIn] = useState('');
  const [eventImpact, setEventImpact] = useState('');
  const [eventOut, setEventOut] = useState('');
  const [eventOwner, setEventOwner] = useState<'player' | 'unknown'>('player');
  const [eventTags, setEventTags] = useState<string[]>([]);
  const [proposal, setProposal] = useState<DirectorProposal | null>(null);
  const [reference, setReference] = useState<ReferenceDraft | null>(null);
  const [referenceError, setReferenceError] = useState('');
  const [reviewShot, setReviewShot] = useState<{ sourceId: string; timeUs: number; candidateId?: string } | null>(null);
  const [aiConsent, setAIConsent] = useState(false);
  const [aiUsageCount, setAIUsageCount] = useState(0);
  const [renderJobId, setRenderJobId] = useState('');
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null);
  const [previewRenderUrl, setPreviewRenderUrl] = useState('');
  const pendingPreview = useRef<{ url: string; project: Project } | null>(null);
  const [renderMode, setRenderMode] = useState<'master' | 'rough_preview' | 'effects_preview'>('master');
  const [renderReview, setRenderReview] = useState<'export' | 'preview' | null>(null);
  const [musicRights, setMusicRights] = useState(false);
  const [ownerRights, setOwnerRights] = useState(false);
  const [draggingClip, setDraggingClip] = useState('');
  const [candidatesBySource, setCandidatesBySource] = useState<Record<string, KillCandidate[]>>({});
  const [candidateFilter, setCandidateFilter] = useState<'all' | 'selected'>('all');
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number; filename: string } | null>(null);
  const cancelScanRef = useRef(false);
  const [aiKillReviews, setAIKillReviews] = useState<AIKillReview[]>([]);

  useEffect(() => { document.title = `VALORANT Montage Studio · Versi ${version}`; }, []);
  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => {
    if (!busy) { setBusyElapsedSec(0); return; }
    setBusyElapsedSec(0);
    const started = Date.now();
    const timer = window.setInterval(() => {
      setBusyElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    let active = true;
    setReferenceError('');
    setReviewShot(null);
    if (!project.reference_draft) {
      setReference(null);
      return;
    }
    window.vms.readReferenceDraft(project).then(result => {
      if (active) setReference(result);
    }).catch(error => {
      if (active) { setReference(null); setReferenceError(getError(error)); }
    });
    return () => { active = false; };
  }, [project]);

  useEffect(() => { setOwnerRights(false); }, [project.reference_draft, project.project_id]);
  useEffect(() => { setMusicRights(false); }, [project.project_id, project.music?.path, project.music?.duration_us]);

  useEffect(() => {
    setCandidatesBySource({});
    setAIKillReviews([]);
    setCandidateFilter('all');
    setScanProgress(null);
    cancelScanRef.current = false;
  }, [project.project_id]);

  useEffect(() => {
    setManualMarking(false);
    setEventIn('');
    setEventImpact('');
    setEventOut('');
    setEventTags([]);
    setEventOwner('player');
  }, [selectedSourceId, project.project_id]);

  useEffect(() => {
    if (!renderReview) return;
    const opener = document.activeElement;
    const dialog = exportDialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [renderReview]);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.vms.onAIState(setAIState);
    Promise.all([window.vms.getWorkerState(), window.vms.aiGetState()]).then(([worker, ai]) => {
      if (!active) return;
      setWorkerState(worker);
      setAIState(ai);
      setNotice(current => current ?? { kind: 'success', text: 'Studio siap. Rekaman tetap diproses lokal.' });
    }).catch(error => active && setNotice({ kind: 'error', text: getError(error) }));
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!project.sources.some(item => item.media_id === selectedSourceId)) setSelectedSourceId(project.sources[0]?.media_id ?? '');
  }, [project.sources, selectedSourceId]);

  useEffect(() => {
    if (!project.timeline.some(item => item.clip_id === selectedClipId)) setSelectedClipId(project.timeline[0]?.clip_id ?? '');
  }, [project.timeline, selectedClipId]);

  useEffect(() => {
    setAIUsageCount(0);
    void refreshAIRequestCount(project.project_id);
  }, [project.project_id]);

  useEffect(() => {
    if (project === openedSnapshot.current || (!project.sources.length && !project.music && !project.reference_video)) return;
    setSaveState('Menyimpan…');
    const timer = window.setTimeout(() => {
      window.vms.autosaveProject(project).then(() => {
        if (projectRef.current === project) setSaveState('Tersimpan otomatis');
      }).catch(() => {
        if (projectRef.current === project) setSaveState('Autosave tertunda');
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    if (!renderJobId) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const job = await window.vms.getRenderJob(renderJobId);
        if (cancelled) return;
        setRenderJob(job);
        if (['complete', 'needs_review', 'failed', 'cancelled'].includes(job.status)) {
          setRenderJobId('');
          setBusy('');
          const preview = pendingPreview.current;
          pendingPreview.current = null;
          if (renderMode !== 'master' && preview?.project === projectRef.current
            && (job.status === 'complete' || job.status === 'needs_review')) setPreviewRenderUrl(preview.url);
          setNotice({ kind: job.status === 'complete' ? 'success' : job.status === 'failed' ? 'error' : 'info',
            text: job.status === 'complete'
              ? renderMode === 'master' ? 'Render selesai dan lulus pemeriksaan.' : 'Preview montage selesai; FFprobe dan QC memeriksa file hasil.'
              : job.status === 'needs_review' ? 'Render selesai; laporan QA meminta pemeriksaan.' : job.error || job.message });
          return;
        }
        timer = window.setTimeout(poll, 900);
      } catch (error) {
        if (!cancelled) {
          pendingPreview.current = null; setBusy(''); setRenderJobId(''); setRenderJob(null);
          setNotice({ kind: 'error', text: `Status render terputus. Cek folder hasil sebelum memulai render lagi. ${getError(error)}` });
        }
      }
    };
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [renderJobId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = resolveGlobalShortcut(event, {
        busy: Boolean(busy),
        modalOpen: Boolean(renderReview || document.querySelector('dialog[open]')),
        editableTarget: isEditableShortcutTarget(event.target) || isEditableShortcutTarget(document.activeElement),
      });
      if (!action) return;
      event.preventDefault();
      if (action === 'undo') undo();
      else if (action === 'redo') redo();
      else if (action === 'save') void saveProject();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selectedSource = project.sources.find(item => item.media_id === selectedSourceId) ?? null;
  const availableSources = project.sources.filter(source => !missingMediaPaths.includes(source.path));
  const musicMissing = !!project.music && missingMediaPaths.includes(project.music.path);
  const referenceMissing = !!project.reference_video && missingMediaPaths.includes(project.reference_video.path);
  const aiReviewOrder = new Map(aiKillReviews.map((review, index) => [review.candidateId, { ...review, index }]));
  const allCandidates = project.sources.flatMap(source => candidatesBySource[source.media_id] ?? []);
  const allActiveCandidates = allCandidates.filter(candidate => !isDismissedCandidate(project, candidate));
  const selectedActiveCandidates = (candidatesBySource[selectedSourceId] ?? []).filter(candidate => !isDismissedCandidate(project, candidate));
  const activeCandidates = project.sources.length > 1 && candidateFilter === 'all' ? allActiveCandidates : selectedActiveCandidates;
  const dismissedCount = project.dismissed_kill_candidates?.filter(candidate =>
    project.sources.length > 1 && candidateFilter === 'all'
      ? project.sources.some(source => source.media_id === candidate.source_media_id)
      : candidate.source_media_id === selectedSourceId,
  ).length ?? 0;
  const sortCandidates = (list: KillCandidate[]) => list
    .filter(candidate => !project.events.some(event => matchesCandidate(event, candidate)))
    .sort((a, b) => (aiReviewOrder.get(a.candidate_id)?.index ?? aiKillReviews.length) - (aiReviewOrder.get(b.candidate_id)?.index ?? aiKillReviews.length));
  const allUnsavedCount = allActiveCandidates.filter(candidate => !project.events.some(event => matchesCandidate(event, candidate))).length;
  const selectedUnsavedCount = selectedActiveCandidates.filter(candidate => !project.events.some(event => matchesCandidate(event, candidate))).length;
  const unsavedCandidates = sortCandidates(activeCandidates);
  const candidateToReview = allActiveCandidates.find(candidate => candidate.candidate_id === reviewShot?.candidateId);
  const observedKills = [...project.events, ...allActiveCandidates];
  const reviewBounds = candidateToReview ? isolatedKillWindow(candidateToReview, observedKills) : null;
  const reviewCandidate = candidateToReview && reviewBounds
    ? { ...candidateToReview, in_us: reviewBounds.inUs, out_us: reviewBounds.outUs } : null;
  const hasAutoKillClips = project.timeline.some(clip => autoKillClipBounds(project, clip) !== null);
  const repairableClips = project.timeline.some(clip => {
    const bounds = autoKillClipBounds(project, clip, allActiveCandidates);
    return bounds && (clip.in_us < bounds.inUs || clip.out_us > bounds.outUs);
  });
  const selectedClip = project.timeline.find(item => item.clip_id === selectedClipId) ?? null;
  const selectedEvent = selectedClip ? project.events.find(item => item.event_id === selectedClip.event_id) : null;
  const selectedClipEventIds = selectedClip?.included_event_ids ?? (selectedClip ? [selectedClip.event_id] : []);
  const selectedClipEvents = selectedClipEventIds.map(id => project.events.find(item => item.event_id === id))
    .filter((event): event is HighlightEvent => Boolean(event));
  const earliestIncludedImpact = Math.min(...selectedClipEvents.map(event => event.source_time_us));
  const latestIncludedImpact = Math.max(...selectedClipEvents.map(event => event.source_time_us));
  const zoomEffect = selectedClip?.effects.find((effect): effect is Extract<Effect, { type: 'impact_zoom' }> => effect.type === 'impact_zoom');
  const previewSource = reviewShot ? project.sources.find(item => item.media_id === reviewShot.sourceId) ?? null : selectedClip ? project.sources.find(item => item.media_id === selectedClip.source_media_id) ?? null : selectedSource;
  const selectedFPS = FPS[project.settings.output_profile];
  const timelineSeconds = reference
    ? reference.frames / reference.fps
    : project.timeline.reduce((sum, clip) => sum + clip.duration_frames / selectedFPS, 0);
  const clipCount = reference?.takes.length ?? project.timeline.length;
  const beatSyncNeedsMusic = !project.reference_draft && !project.music && project.settings.beat_sync_priority > 0;
  const ownerUnknownCount = project.timeline.filter(clip => project.events.find(event => event.event_id === clip.event_id)?.owner === 'unknown').length;
  const previewAllowed = !beatSyncNeedsMusic && (!project.music || musicRights) && (ownerUnknownCount === 0 || ownerRights);
  const capabilitiesReady = workerState?.media.available ?? false;
  const workerStatusClass = workerState ? (capabilitiesReady ? 'ok' : 'warn') : 'pending';
  const workerStatusLabel = !workerState ? 'CHECKING FFMPEG' : capabilitiesReady ? 'FFMPEG READY' : 'FFMPEG REQUIRED';
  const workerDiagnostic = workerState?.media.diagnostic ?? (workerState ? 'CPU H.264 render via libx264 when installed' : 'Checking local render tools…');
  const upstreamDiagnostic = !workerState ? 'checking runtime' : `${workerState.upstream?.rife_model_available ? 'v4.25 detected' : 'not configured'} · kill review: ${workerState.upstream?.kill_detection ? 'available' : 'manual baseline'}`;
  const aiConnected = aiState?.session.status === 'connected';
  const aiCanPlan = Boolean(aiConnected && aiState?.session.sharing && aiState?.modelCatalog.status === 'ready' && aiState.selectedModel);
  const modelLabel = useMemo(() => aiState?.modelCatalog.models.find(model => model.slug === aiState.selectedModel)?.displayName ?? aiState?.selectedModel ?? 'Pilih model', [aiState]);

  function commit(change: (draft: Project) => void) {
    const current = projectRef.current;
    const next = structuredClone(current);
    change(next);
    undoStack.current = [...undoStack.current.slice(-39), structuredClone(current)];
    redoStack.current = [];
    projectRef.current = next;
    setProject(next);
    setPreviewRenderUrl('');
  }

  function replaceProject(next: Project) {
    undoStack.current = [...undoStack.current.slice(-39), structuredClone(projectRef.current)];
    redoStack.current = [];
    projectRef.current = next;
    setProject(next);
    setPreviewRenderUrl('');
  }

  function undo() {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(structuredClone(projectRef.current));
    projectRef.current = previous; setProject(previous); setPreviewRenderUrl(''); setNotice({ kind: 'info', text: 'Perubahan terakhir dibatalkan.' });
  }

  function redo() {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(structuredClone(projectRef.current));
    projectRef.current = next; setProject(next); setPreviewRenderUrl(''); setNotice({ kind: 'info', text: 'Perubahan diterapkan kembali.' });
  }

  async function importRecordings() {
    runTask('Mengimpor rekaman', async () => {
      const media = await window.vms.importRecordings();
      if (!media.length) return;
      const pathKey = (path: string) => path.replaceAll('\\', '/').toLowerCase();
      const sourcesByPath = new Map(projectRef.current.sources.map(source => [pathKey(source.path), source]));
      const added: typeof media = [];
      for (const item of media) {
        const key = pathKey(item.path);
        if (sourcesByPath.has(key)) continue;
        sourcesByPath.set(key, item);
        added.push(item);
      }
      if (added.length) commit(draft => { draft.sources.push(...added); });
      setSelectedSourceId(sourcesByPath.get(pathKey(media[0].path))!.media_id);
      setNotice({ kind: 'success', text: added.length ? `${added.length} rekaman masuk ke Media Library.` : 'Rekaman sudah ada di Media Library.' });
    });
  }

  async function importMusic() {
    runTask('Menganalisis musik', async () => {
      const music = await window.vms.importMusic();
      if (!music) return;
      commit(draft => { draft.music = music; });
      setMusicRights(false);
      setNotice({ kind: 'success', text: `Beat candidates dibuat secara lokal${music.bpm_estimate ? ` • ${music.bpm_estimate} BPM` : ''}. Tinjau sebelum render.` });
    });
  }

  async function selectStyleReference() {
    await runTask('Memilih referensi gaya', async () => {
      const video = await window.vms.selectStyleReference();
      if (!video) return;
      commit(draft => {
        draft.reference_video = video;
        delete draft.reference_draft;
      });
      setNotice({ kind: 'success', text: 'Video rujukan siap dianalisis secara lokal saat Generate draft.' });
    });
  }

  async function runTask(label: string, action: () => Promise<void>) {
    setBusy(label); setNotice(null);
    try { await action(); } catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
    finally { setBusy(''); }
  }

  function addHighlight() {
    if (!selectedSource) return setNotice({ kind: 'error', text: 'Pilih rekaman sebelum menambah highlight.' });
    const inUs = Math.round(Number(eventIn) * 1_000_000);
    const impactUs = Math.round(Number(eventImpact) * 1_000_000);
    const outUs = Math.round(Number(eventOut) * 1_000_000);
    if (![eventIn, eventImpact, eventOut].every(value => value.trim()) || ![inUs, impactUs, outUs].every(Number.isSafeInteger) || inUs < 0 || inUs >= impactUs || impactUs > outUs || outUs > selectedSource.duration_us) {
      return setNotice({ kind: 'error', text: 'Isi ketiga waktu. Mulai klip harus sebelum kill dan akhir klip harus pada atau setelah kill, dalam durasi rekaman.' });
    }
    const event: HighlightEvent = {
      event_id: uuid(), source_media_id: selectedSource.media_id, source_time_us: impactUs,
      source_frame: Math.round((impactUs / 1_000_000) * fpsOf(selectedSource)), in_us: inUs, out_us: outUs,
      evidence: [{ type: 'manual_annotation', created_utc: new Date().toISOString() }], owner: eventOwner,
      confidence: 1, tags: eventTags, cluster_id: null, rating: null, is_user_override: true,
    };
    commit(draft => { draft.events.push(event); });
    setManualMarking(false);
    setEventIn('');
    setEventImpact('');
    setEventOut('');
    setEventTags([]);
    setEventOwner('player');
    setNotice({ kind: 'success', text: 'Highlight disimpan. Pilih “Masukkan ke montage” untuk menambahkannya ke urutan video.' });
  }

  function readManualKillTime() {
    if (!selectedSource || previewSource?.media_id !== selectedSource.media_id || previewRenderUrl || !videoRef.current?.readyState) return;
    const killUs = Math.min(selectedSource.duration_us, Math.round(videoRef.current.currentTime * 1_000_000));
    const asInput = (timeUs: number) => (timeUs / 1_000_000).toString();
    setEventIn(asInput(Math.max(0, killUs - 1_500_000)));
    setEventImpact(asInput(killUs));
    setEventOut(asInput(Math.min(selectedSource.duration_us, killUs + 1_500_000)));
  }

  async function detectKillCandidates(useAI = false, scope: 'all' | 'selected' = 'selected') {
    const targets = scope === 'all'
      ? projectRef.current.sources.filter(source => !missingMediaPaths.includes(source.path))
      : selectedSource && !missingMediaPaths.includes(selectedSource.path) ? [selectedSource] : [];
    if (!targets.length) return setNotice({ kind: 'error', text: 'Pilih rekaman sebelum mencari kandidat kill.' });
    if (useAI && (!aiCanPlan || !aiState || aiUsageCount >= MAX_AI_REQUESTS_PER_PROJECT)) return;
    if (useAI && !window.confirm(`Pindai ${targets.length} rekaman secara lokal lalu urutkan kandidat memakai ${modelLabel}? Studio hanya mengirim timestamp, skor, dan jenis sinyal deteksi. Video dan audio tetap lokal. Tinjauan memakai satu jatah AI proyek jika ada kandidat baru.`)) return;
    const projectId = project.project_id;
    const model = aiState?.selectedModel;
    cancelScanRef.current = false;
    setAIKillReviews([]);
    setNotice(null);
    if (targets.length > 1) setCandidateFilter('all');
    const collectedBySource: Record<string, KillCandidate[]> = { ...candidatesBySource };
    let scannedCount = 0;
    let clipsWithKills = 0;
    let failedClips = 0;
    let lastError = '';
    try {
      for (let index = 0; index < targets.length; index++) {
        if (cancelScanRef.current || projectRef.current.project_id !== projectId) break;
        const source = targets[index];
        setScanProgress({ current: index + 1, total: targets.length, filename: source.filename });
        setBusy(targets.length > 1 ? `Memindai rekaman ${index + 1}/${targets.length}` : 'Menganalisis kandidat kill secara lokal');
        try {
          const result = await window.vms.detectKills(source);
          if (projectRef.current.project_id !== projectId) return;
          if (!projectRef.current.sources.some(item => item.media_id === source.media_id)) continue;
          collectedBySource[source.media_id] = result.candidates;
          setCandidatesBySource(prev => ({ ...prev, [source.media_id]: result.candidates }));
          scannedCount += 1;
          if (result.candidates.length > 0) clipsWithKills += 1;
        } catch (error) {
          failedClips += 1;
          lastError = getError(error);
          if (targets.length === 1) throw error;
        }
      }
      setScanProgress(null);
      const scannedCandidates = targets.flatMap(source => collectedBySource[source.media_id] ?? []);
      const pending = scannedCandidates.filter(candidate => !isDismissedCandidate(projectRef.current, candidate)
        && !projectRef.current.events.some(event => matchesCandidate(event, candidate)));
      if (useAI && model && pending.length && !cancelScanRef.current) {
        setBusy('AI sedang meninjau metadata kandidat');
        try {
          const batch = pending.slice(0, 250);
          const review = await window.vms.aiReviewKills(projectId, model, batch);
          setAIKillReviews(review.reviews);
          setAIUsageCount(review.usageCount);
          setNotice({
            kind: 'success',
            text: `AI memprioritaskan ${batch.length} kandidat dari ${clipsWithKills}/${scannedCount} rekaman (Jatah AI proyek: ${review.usageCount}/${MAX_AI_REQUESTS_PER_PROJECT}). Video tetap lokal; hanya metadata singkat yang dikirim ke ChatGPT.`,
          });
        } catch (error) {
          await refreshAIRequestCount(projectId);
          setNotice({ kind: 'info', text: `Tinjauan AI gagal (${getError(error)}). ${pending.length} kandidat dari pemindaian lokal tetap tersedia.` });
        }
        return;
      }
      if (cancelScanRef.current) {
        setNotice({ kind: 'info', text: `Pemindaian dihentikan setelah ${scannedCount}/${targets.length} rekaman. ${pending.length} kandidat tersimpan untuk ditinjau.` });
      } else if (pending.length) {
        setNotice({
          kind: 'success',
          text: targets.length > 1
            ? `${pending.length} kandidat siap ditinjau dari ${clipsWithKills}/${scannedCount} rekaman${failedClips ? ` (${failedClips} gagal)` : ''}.`
            : `${pending.length} kandidat siap ditinjau.`,
        });
      } else if (failedClips && scannedCount === 0) {
        setNotice({ kind: 'error', text: lastError || 'Pemindaian gagal untuk semua rekaman.' });
      } else {
        setNotice({
          kind: 'info',
          text: targets.length > 1
            ? `Pemindaian ${scannedCount} rekaman selesai. Tidak ada kandidat baru ditemukan${failedClips ? ` (${failedClips} gagal)` : ''}.`
            : 'Pemindaian selesai. Tidak ada kandidat baru untuk ditinjau.',
        });
      }
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
    finally { setScanProgress(null); setBusy(''); }
  }

  function confirmKillCandidate(candidate: KillCandidate) {
    if (isDismissedCandidate(projectRef.current, candidate) || projectRef.current.events.some(event => matchesCandidate(event, candidate))) return;
    const { inUs, outUs } = isolatedKillWindow(candidate, [...projectRef.current.events, ...allActiveCandidates]);
    const event: HighlightEvent = {
      event_id: uuid(), source_media_id: candidate.source_media_id, source_time_us: candidate.source_time_us,
      source_frame: candidate.source_frame, in_us: inUs, out_us: outUs,
      evidence: [...candidate.evidence, { type: 'user_reviewed_upstream_candidate', created_utc: new Date().toISOString() }],
      owner: 'player', confidence: candidate.confidence, tags: candidate.suggested_tags.filter(tag => tag !== 'multikill'), cluster_id: null, rating: null, is_user_override: true,
    };
    commit(draft => { draft.events.push(event); delete draft.reference_draft; });
    setNotice({ kind: 'success', text: 'Highlight disimpan. Pilih “Masukkan ke montage” untuk menambahkannya ke urutan video.' });
  }

  function dismissKillCandidate(candidate: KillCandidate) {
    if (isDismissedCandidate(projectRef.current, candidate)) return;
    const { source_media_id, source_time_us, source_frame } = candidate;
    commit(draft => (draft.dismissed_kill_candidates ??= []).push({ source_media_id, source_time_us, source_frame }));
    if (reviewShot?.candidateId === candidate.candidate_id) setReviewShot(null);
    setNotice({ kind: 'info', text: 'Kandidat diabaikan untuk proyek ini. Kamu bisa menampilkannya lagi dari panel Review kill.' });
  }

  function showKillCandidate(candidate: KillCandidate) {
    setPreviewRenderUrl('');
    setSelectedSourceId(candidate.source_media_id);
    setReviewShot({
      sourceId: candidate.source_media_id,
      timeUs: candidate.source_time_us,
      candidateId: candidate.candidate_id,
    });
    previewStageRef.current?.scrollIntoView({ block: 'nearest' });
    previewStageRef.current?.focus({ preventScroll: true });
  }

  function markEndingFrame(kind: 'action' | 'ace') {
    const video = videoRef.current;
    if (!selectedEvent || !video || previewRenderUrl || previewSource?.media_id !== selectedEvent.source_media_id) {
      setNotice({ kind: 'error', text: 'Tampilkan rekaman sumber clip ini dan jeda pada frame yang ingin ditandai.' });
      return;
    }
    const sourceTime = Math.round(video.currentTime * 1_000_000);
    const beforeImpact = kind === 'action';
    if (sourceTime < 0 || sourceTime >= previewSource.duration_us
      || (beforeImpact ? sourceTime >= selectedEvent.source_time_us : sourceTime <= selectedEvent.source_time_us)) {
      setNotice({ kind: 'error', text: beforeImpact
        ? 'Pilih awal ancang-ancang sebelum impact.' : 'Pilih frame setelah impact yang menampilkan banner ACE.' });
      return;
    }
    const type = beforeImpact ? 'reviewed_final_action' : 'reviewed_ace_banner';
    video.pause();
    commit(draft => {
      const event = draft.events.find(item => item.event_id === selectedEvent.event_id)!;
      event.evidence = event.evidence.filter(item => item.type !== type);
      event.evidence.push({ type, source_time_us: sourceTime });
      delete draft.reference_draft;
    });
    setNotice({ kind: 'success', text: beforeImpact ? 'Awal aksi disimpan. Jadikan kill ini penutup, lalu Generate draft.' : 'Frame ACE disimpan. Jadikan kill ini penutup, lalu Generate draft.' });
  }

  function addClip(event: HighlightEvent) {
    let clipId = '';
    commit(draft => {
      const clip = makeClip(draft, event);
      clipId = clip.clip_id;
      draft.timeline.push(clip);
      trimOverlappingAutoKillClips(draft, event.source_media_id, allActiveCandidates);
      delete draft.reference_draft;
    });
    setSelectedClipId(clipId);
    setNotice({ kind: 'success', text: 'Highlight ditambahkan ke timeline.' });
  }

  function removeHighlight(eventId: string) {
    commit(draft => removeReviewedHighlight(draft, eventId));
    setProposal(null);
    setNotice({ kind: 'info', text: 'Highlight dihapus. Ctrl+Z untuk membatalkan.' });
  }

  function generateRuleDraft() {
    try { setProposal(buildRuleProposal(project)); setActivePanel('director'); setNotice({ kind: 'success', text: 'Draft rule-only siap ditinjau; timeline belum diubah.' }); }
    catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
  }

  async function generateReferenceDraft() {
    const source = projectRef.current;
    await runTask('Planning upstream montage', async () => {
      const result = await window.vms.generateReferenceDraft(source);
      if (source !== projectRef.current) {
        throw new Error('Project berubah saat draft dibuat. Jalankan Generate draft lagi.');
      }
      commit(draft => { draft.reference_draft = result.id; });
      setReference(result);
      setActivePanel('director');
      setNotice({ kind: 'success', text: 'Draft upstream 1080p60 siap ditinjau di Director.' });
    });
  }

  function editReferenceSelection() {
    if (!reference?.selection?.length) return;
    if (!window.confirm('Gunakan pilihan kill dari draft ini untuk mengganti urutan klip yang dapat diedit? Pastikan kamu punya izin memakai cuplikannya.')) return;
    commit(draft => {
      for (const event of reference.selection) {
        const existing = draft.events.findIndex(item => item.event_id === event.event_id);
        if (existing === -1) draft.events.push(event);
        else draft.events[existing] = event;
      }
      draft.timeline = reference.selection.map(event => makeClip(draft, event));
      rebuildTimeline(draft);
      delete draft.reference_draft;
    });
    setActivePanel('edit');
    setNotice({ kind: 'info', text: 'Atur pilihan dan urutan highlight, lalu Generate draft untuk merencanakan ulang pada beat.' });
  }

  async function generateAIProposal() {
    if (!aiConsent) return setNotice({ kind: 'error', text: 'Setujui pengiriman metadata event dan analisis musik sebelum memakai ChatGPT.' });
    if (!aiCanPlan || !aiState) return setNotice({ kind: 'error', text: 'Hubungkan ChatGPT dan aktifkan izin penggunaan plan untuk memuat model akun.' });
    setBusy('Membuat draft ChatGPT'); setActivePanel('director'); setNotice(null);
    try {
      const result = await window.vms.aiGenerateProposal(project, aiState.selectedModel);
      setProposal(result.proposal); setAIUsageCount(result.usageCount);
      setNotice({ kind: 'success', text: 'Draft ChatGPT siap ditinjau.' });
    } catch (error) {
      await refreshAIRequestCount(project.project_id);
      try {
        const fallback = buildRuleProposal(project);
        setProposal(fallback);
        setNotice({ kind: 'info', text: `ChatGPT tidak menyelesaikan draft (${getError(error)}). Draft rule-only lokal disiapkan untuk ditinjau.` });
      } catch { setNotice({ kind: 'error', text: `${getError(error)} Tambahkan highlight manual untuk memakai fallback rule-only.` }); }
    } finally { setBusy(''); }
  }

  async function testAIConnection() {
    if (!aiCanPlan || !aiState) return setNotice({ kind: 'error', text: 'Hubungkan ChatGPT, aktifkan penggunaan plan, lalu muat model akun.' });
    setBusy('Memeriksa koneksi ChatGPT');
    try {
      const result = await window.vms.aiTestInference(project.project_id, aiState.selectedModel);
      setAIUsageCount(result.usageCount);
      setNotice({ kind: 'success', text: 'Tes koneksi ChatGPT berhasil.' });
    } catch (error) {
      await refreshAIRequestCount(project.project_id);
      setNotice({ kind: 'error', text: getError(error) });
    }
    finally { setBusy(''); }
  }

  async function refreshAIRequestCount(projectId: string) {
    try {
      const used = await window.vms.aiGetUsage(projectId);
      if (projectRef.current.project_id === projectId) setAIUsageCount(used);
    } catch { /* Keep the last known count when IPC fails. */ }
  }

  async function cancelAIRequest() {
    try { await window.vms.aiCancelRequest(); setNotice({ kind: 'info', text: 'Pembatalan request ChatGPT diminta.' }); }
    catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
  }

  function acceptProposal() {
    if (!proposal) return;
    const accepted = structuredClone(proposal);
    const next = applyProposal(structuredClone(project), accepted);
    replaceProject(next); setSelectedClipId(next.timeline[0]?.clip_id ?? '');
    setNotice({ kind: 'success', text: `Draft ${accepted.source === 'chatgpt' ? 'ChatGPT' : 'rule-only'} diterapkan ke timeline.` });
    setProposal(null);
  }

  function rejectProposal() {
    setProposal(null);
    setNotice({ kind: 'info', text: 'Draft ditolak; timeline project tetap seperti sebelumnya.' });
  }

  function reorderClip(sourceId: string, targetId: string) {
    if (!sourceId || sourceId === targetId) return;
    commit(draft => {
      const from = draft.timeline.findIndex(item => item.clip_id === sourceId);
      const to = draft.timeline.findIndex(item => item.clip_id === targetId);
      if (from < 0 || to < 0) return;
      const [item] = draft.timeline.splice(from, 1);
      draft.timeline.splice(to, 0, item);
      rebuildTimeline(draft);
    });
  }

  function updateClip(field: 'in_us' | 'out_us', value: number) {
    if (!selectedClip || !selectedEvent || !Number.isFinite(value)) return;
    commit(draft => {
      const clip = draft.timeline.find(item => item.clip_id === selectedClip.clip_id);
      if (!clip) return;
      const bounds = autoKillClipBounds(draft, clip, allActiveCandidates);
      const inUs = field === 'in_us' ? Math.max(bounds?.inUs ?? selectedEvent.in_us, Math.min(value, earliestIncludedImpact)) : clip.in_us;
      const outUs = field === 'out_us' ? Math.min(bounds?.outUs ?? selectedEvent.out_us, Math.max(value, latestIncludedImpact)) : clip.out_us;
      if (inUs >= outUs) return;
      resizeClipRange(clip, inUs, outUs);
      rebuildTimeline(draft);
    });
  }

  function applySpeedRamp() {
    if (!selectedClip || !selectedEvent) return;
    commit(draft => {
      const clip = draft.timeline.find(item => item.clip_id === selectedClip.clip_id);
      if (!clip) return;
      clip.time_remap = makePostKillSpeedRamp(selectedEvent, clip.in_us, clip.out_us, FPS[draft.settings.output_profile]);
      rebuildTimeline(draft);
    });
  }

  function setReverseReplay(enabled: boolean) {
    if (!selectedClip || !selectedEvent) return;
    commit(draft => {
      const clip = draft.timeline.find(item => item.clip_id === selectedClip.clip_id);
      if (!clip) return;
      toggleReverseImpactReplay(clip, selectedEvent, enabled, FPS[draft.settings.output_profile]);
      rebuildTimeline(draft);
    });
  }

  function setClipTransition(enabled: boolean) {
    if (!selectedClip) return;
    commit(draft => {
      const clip = draft.timeline.find(item => item.clip_id === selectedClip.clip_id);
      if (!clip) return;
      clip.transitions = enabled ? [{ type: 'dip_to_black', duration_frames: 8, enabled: true }] : [];
    });
  }

  function setClipEffect(type: Effect['type'], enabled: boolean) {
    if (!selectedClip || !selectedEvent) return;
    commit(draft => {
      const clip = draft.timeline.find(item => item.clip_id === selectedClip.clip_id);
      if (!clip) return;
      const existing = clip.effects.find(effect => effect.type === type);
      if (existing) { existing.enabled = enabled; return; }
      if (!enabled) return;
      const automatic = makeAutomaticEffects(selectedEvent, draft.settings.effects_intensity).find(effect => effect.type === type);
      if (automatic) { clip.effects.push(automatic); return; }
      const intensity = Math.max(0.1, draft.settings.effects_intensity);
      if (type === 'impact_zoom') clip.effects.push({ type, max_zoom: 1 + 0.04 * intensity, duration_frames: 24,
        anchor: 'impact', enabled: true, keyframes: [{ frame_offset: -12, scale: 1 },
          { frame_offset: 0, scale: 1 + 0.04 * intensity }, { frame_offset: 12, scale: 1 }] });
      else if (type === 'impact_flash') clip.effects.push({ type, intensity: 0.12 * intensity, duration_frames: 3, enabled: true });
      else if (type === 'screen_shake') clip.effects.push({ type, amplitude_px: 4 * intensity, duration_frames: 10, enabled: true });
      else clip.effects.push({ type, strength: 0.16 * intensity, window_frames: 3, enabled: true });
    });
  }

  function setZoomPeak(scale: number) {
    if (!selectedClip || !Number.isFinite(scale)) return;
    commit(draft => {
      const clip = draft.timeline.find(item => item.clip_id === selectedClip.clip_id);
      const effect = clip?.effects.find(item => item.type === 'impact_zoom');
      if (!effect || effect.type !== 'impact_zoom') return;
      effect.max_zoom = Math.max(1, Math.min(1.08, scale));
      const peak = effect.max_zoom;
      effect.keyframes = effect.keyframes?.length ? effect.keyframes.map(keyframe => ({
        ...keyframe, scale: keyframe.frame_offset === 0 ? peak : keyframe.scale,
      })) : [{ frame_offset: -12, scale: 1 }, { frame_offset: 0, scale: peak }, { frame_offset: 12, scale: 1 }];
    });
  }

  function newProject() {
    if (busy) return;
    if (project.sources.length && !window.confirm('Mulai project baru? Project sekarang tetap tersimpan di autosave lokal.')) return;
    const next = createProject();
    setMissingMediaPaths([]);
    openedSnapshot.current = next;
    projectRef.current = next; setProject(next); setProjectPath(null); setProposal(null); setRenderJob(null); setPreviewRenderUrl('');
    setReference(null); setReviewShot(null); setMusicRights(false); setOwnerRights(false); setSaveState('Belum disimpan');
    undoStack.current = []; redoStack.current = [];
    setSelectedSourceId(''); setSelectedClipId(''); setNotice({ kind: 'success', text: 'Project baru dibuat.' });
  }

  async function saveProject(saveAs = false) {
    try {
      const result = await window.vms.saveProject(project, saveAs ? null : projectPath);
      if (result) { setProjectPath(result.path); setSaveState('Project tersimpan'); setNotice({ kind: 'success', text: 'Project JSON tersimpan.' }); }
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
  }

  async function openProject(recover = false) {
    if (busy) return;
    try {
      const loaded = await window.vms.loadProject(recover);
      if (!loaded) return;
      if (!loaded.project.reference_draft) {
        for (const event of loaded.project.events) {
          if (isAutoKill(event)) event.tags = event.tags.filter(tag => tag !== 'multikill');
        }
      }
      openedSnapshot.current = loaded.project;
      projectRef.current = loaded.project; setProject(loaded.project); setProjectPath(loaded.path); setProposal(null);
      setMissingMediaPaths(loaded.missingMediaPaths);
      setPreviewRenderUrl(''); setRenderJob(null); setReviewShot(null); setReference(null);
      setMusicRights(false); setOwnerRights(false); setSaveState(recover ? 'Dipulihkan dari autosave' : 'Project tersimpan');
      undoStack.current = []; redoStack.current = [];
      setSelectedSourceId(loaded.project.sources[0]?.media_id ?? ''); setSelectedClipId(loaded.project.timeline[0]?.clip_id ?? '');
      setNotice({ kind: 'success', text: recover
        ? 'Autosave dipulihkan. Gunakan Simpan proyek untuk menyimpan salinan.'
        : 'Project berhasil dibuka dan divalidasi.' });
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
  }

  async function relinkRecording(source: Project['sources'][number]) {
    await runTask('Mencari rekaman asli', async () => {
      const replacement = await window.vms.relinkRecording(source);
      if (!replacement) return;
      const hadDraft = Boolean(projectRef.current.reference_draft);
      commit(draft => {
        draft.sources = draft.sources.map(item => item.media_id === source.media_id ? replacement : item);
        delete draft.reference_draft;
      });
      setNotice({ kind: 'success', text: hadDraft
        ? 'Rekaman terhubung kembali. Buat ulang draft otomatis untuk memakai lokasi baru.'
        : 'Rekaman terhubung kembali. Highlight dan waktu klip dipertahankan.' });
    });
  }

  async function relinkMissingMusic() {
    const track = projectRef.current.music;
    if (!track) return;
    await runTask('Mencari lagu asli', async () => {
      const file = await window.vms.relinkMusic(track);
      if (!file) return;
      commit(draft => {
        if (draft.music) Object.assign(draft.music, file);
        delete draft.reference_draft;
      });
      setNotice({ kind: 'success', text: 'Musik terhubung kembali. Penanda beat dan offset dipertahankan.' });
    });
  }

  async function relinkMissingReference() {
    await runTask('Mencari video referensi', async () => {
      const video = await window.vms.relinkReference();
      if (!video) return;
      commit(draft => {
        draft.reference_video = video;
        delete draft.reference_draft;
      });
      setNotice({ kind: 'success', text: 'Video referensi terhubung kembali.' });
    });
  }

  async function exportProject() {
    if (beatSyncNeedsMusic) return;
    setRenderMode('master');
    setBusy('Preparing export');
    try {
      setRenderJob(null);
      const pathResult = await window.vms.render(project, { rights: musicRights, ownership: ownerRights });
      if (!pathResult) return;
      setBusy('Rendering'); setRenderJobId(pathResult.job_id);
      setRenderJob({ job_id: pathResult.job_id, status: 'queued', progress: 0, message: `Menyiapkan ${pathResult.output_path}` });
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
    finally { setBusy(current => current === 'Preparing export' ? '' : current); }
  }

  async function renderPreview(mode: 'rough_preview' | 'effects_preview') {
    const requestedProject = project;
    setRenderMode(mode);
    setBusy('Preparing preview');
    setPreviewRenderUrl('');
    try {
      setRenderJob(null);
      const result = await window.vms.renderPreview(requestedProject, mode, { rights: musicRights, ownership: ownerRights });
      pendingPreview.current = { url: result.preview_url, project: requestedProject };
      setRenderJobId(result.job_id);
      setBusy('Rendering');
      setRenderJob({ job_id: result.job_id, status: 'queued', progress: 0,
        message: `Membuat preview ${requestedProject.reference_draft ? 'draft 1920×1080/60' : mode === 'rough_preview' ? '1280×720/30 tanpa efek' : '2560×1440/60 dengan efek'}` });
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
    finally { setBusy(current => current === 'Preparing preview' ? '' : current); }
  }

  async function cancelRender() {
    if (!renderJobId) return;
    try { await window.vms.cancelRender(renderJobId); setNotice({ kind: 'info', text: 'Pembatalan render diminta.' }); }
    catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
  }

  async function handleAI(action: () => Promise<AIState>) {
    try { setAIState(await action()); }
    catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
  }

  const previewUrl = previewRenderUrl || previewSource?.preview_url || '';
  const candidatePreview = previewRenderUrl ? undefined : reviewCandidate;
  const rangePreview = candidatePreview ?? (!previewRenderUrl && !reviewShot ? selectedClip : null);
  const previewKey = `${previewUrl}:${candidatePreview ? `candidate:${candidatePreview.candidate_id}:${candidatePreview.in_us}:${candidatePreview.out_us}` : reviewShot ? `source:${reviewShot.timeUs}` : selectedClip ? `clip:${selectedClip.clip_id}:${selectedClip.in_us}:${selectedClip.out_us}` : 'source'}`;
  const completedRender = renderJob?.result;
  const manualVideoReady = Boolean(selectedSource && previewSource?.media_id === selectedSource.media_id && !previewRenderUrl && monitorDuration > 0);
  const outputDescription = project.reference_draft ? '1920 × 1080 · 60 FPS' : `2560 × 1440 · ${selectedFPS} FPS`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><img className="brand-logo" src={appIcon} alt="VALORANT Montage Studio" width={38} height={38} /><div><strong>VALORANT <i>///</i> MONTAGE STUDIO</strong><small className="version-label">Versi {version}</small></div></div>
        <div className="project-name"><span className="live-dot" />{project.name}<small>{saveState}</small></div>
        <div className="top-actions">
          <button className="icon-button" title="Undo (Ctrl+Z)" onClick={undo}>↶</button>
          <button className="icon-button" title="Redo (Ctrl+Y)" onClick={redo}>↷</button>
          <button className="button subtle" disabled={Boolean(busy)} onClick={newProject}>Proyek baru</button>
          <button className="button subtle" disabled={Boolean(busy)} onClick={() => void openProject()}>Buka proyek</button>
          <button className="button subtle" disabled={Boolean(busy)} onClick={() => void openProject(true)}>Pulihkan autosave</button>
          <button className="button subtle" onClick={() => void saveProject()}>Simpan proyek</button>
          <button className="button subtle" disabled={!projectPath || Boolean(busy)} onClick={() => void saveProject(true)}>Simpan sebagai</button>
          <button className="button primary" onClick={() => setRenderReview('export')} disabled={(!project.timeline.length && !project.reference_draft) || Boolean(busy) || Boolean(project.reference_draft && !reference)}>Ekspor video <span>↗</span></button>
        </div>
      </header>

      {workerState && !capabilitiesReady && <div className="prereq-banner" role="alert">
        <div>
          <strong>FFmpeg &amp; FFprobe diperlukan untuk impor dan ekspor video.</strong>
          <span>Runtime Python sudah terpasang otomatis di Studio. Pasang FFmpeg lewat PowerShell: <code>winget install -e --id Gyan.FFmpeg</code> (atau jalankan <code>Install-FFmpeg.bat</code>), lalu mulai ulang Studio.</span>
        </div>
        <div className="prereq-actions">
          <button className="button subtle compact" onClick={() => {
            void navigator.clipboard?.writeText('winget install -e --id Gyan.FFmpeg').then(
              () => setNotice({ kind: 'info', text: 'Perintah winget FFmpeg disalin. Jalankan di PowerShell lalu mulai ulang Studio.' }),
              () => setNotice({ kind: 'info', text: 'Jalankan di PowerShell: winget install -e --id Gyan.FFmpeg' }),
            );
          }}>Salin perintah</button>
          <button className="button subtle compact" onClick={() => {
            void window.vms.getWorkerState().then(state => {
              setWorkerState(state);
              setNotice({ kind: state.media.available ? 'success' : 'info',
                text: state.media.available ? 'FFmpeg terdeteksi dan siap digunakan.' : (state.media.diagnostic || 'FFmpeg belum ditemukan di PATH. Mulai ulang Studio setelah pemasangan.') });
            }).catch(error => setNotice({ kind: 'error', text: getError(error) }));
          }}>Periksa ulang</button>
        </div>
      </div>}

      <div className="workspace">
        <aside className="library-column">
          <div className="section-head"><h2>Rekaman gameplay</h2><span className="count-pill">{project.sources.length}</span></div>
          <button className="button import-button" onClick={() => void importRecordings()} disabled={Boolean(busy)}><span className="plus" aria-hidden="true">＋</span> Impor rekaman</button>
          <div className="media-list">
            {project.sources.length ? project.sources.map(source => missingMediaPaths.includes(source.path)
              ? <div className="missing-recording" key={source.media_id}>
                <strong title={source.path}>{source.filename}</strong>
                <small>File rekaman tidak ditemukan.</small>
                <button className="button subtle" disabled={Boolean(busy)} onClick={() => void relinkRecording(source)}>Temukan file asli</button>
              </div>
              : <button className={`media-card ${selectedSourceId === source.media_id ? 'selected' : ''}`} key={source.media_id} disabled={Boolean(busy)} aria-pressed={selectedSourceId === source.media_id} onClick={() => { setPreviewRenderUrl(''); setReviewShot({ sourceId: source.media_id, timeUs: 0 }); setSelectedSourceId(source.media_id); }}>
              <div className="media-thumb">{source.thumbnail_url ? <img src={source.thumbnail_url} /> : <span className="thumb-cross">V</span>}<span className="play-mark">▶</span></div>
              <div className="media-info"><strong title={source.filename}>{source.filename}</strong><small>{timecode(source.duration_us)} · {source.video.width}×{source.video.height}</small><small>{source.video.codec?.toUpperCase()} · {source.video.timestamp_behavior?.variable_frame_rate ? 'VFR' : 'CFR / unknown'}</small></div>
              <span className="media-size">{fmtBytes(source.size_bytes)}</span>
            </button>) : <div className="empty-card"><div className="empty-symbol">▧</div><strong>Belum ada rekaman</strong><span>Impor video gameplay untuk mulai memilih highlight.</span></div>}
          </div>

          <div className="section-head highlight-heading"><h2>Review kill</h2><span className="count-pill">{project.events.length}</span></div>
          {availableSources.length > 0 && selectedSource ? <>
            <p className="workflow-help">{workerState?.upstream?.kill_detection ? 'Cari kandidat kill, lalu putar cuplikannya dan cek kill feed sebelum mengonfirmasi.' : 'Putar rekaman, lalu tandai kill yang ingin kamu masukkan ke montage.'}</p>
            <div className="highlight-actions">
              {workerState?.upstream?.kill_detection && (availableSources.length > 1
                ? <>
                  <button className="button primary" onClick={() => void detectKillCandidates(false, 'all')} disabled={Boolean(busy)}>Cari kill di semua rekaman ({availableSources.length})</button>
                  <button className="button subtle" onClick={() => void detectKillCandidates(true, 'all')}
                    disabled={Boolean(busy) || !aiCanPlan || Boolean(aiState?.aiBusy) || aiUsageCount >= MAX_AI_REQUESTS_PER_PROJECT}>
                    Pindai semua + urutkan via AI (metadata)
                  </button>
                  {!missingMediaPaths.includes(selectedSource.path) && <button className="button subtle" onClick={() => void detectKillCandidates(false, 'selected')} disabled={Boolean(busy)}>Pindai rekaman dipilih saja</button>}
                </>
                : <>
                  <button className="button primary" onClick={() => void detectKillCandidates(false, 'selected')} disabled={Boolean(busy)}>Cari kill otomatis</button>
                  <button className="button subtle" onClick={() => void detectKillCandidates(true, 'selected')}
                    disabled={Boolean(busy) || !aiCanPlan || Boolean(aiState?.aiBusy) || aiUsageCount >= MAX_AI_REQUESTS_PER_PROJECT}>
                    Pindai lokal + urutkan via AI (metadata)
                  </button>
                </>)}
              {!aiCanPlan && <p className="workflow-help">Opsional: hubungkan ChatGPT di Director untuk mengurutkan metadata kandidat lokal (video &amp; audio tetap di perangkat).</p>}
              {aiCanPlan && aiUsageCount < MAX_AI_REQUESTS_PER_PROJECT && <p className="workflow-help">Deteksi video 100% lokal; AI hanya mengurutkan skor metadata (pemakaian kuota ChatGPT sangat kecil). Jatah AI proyek: {aiUsageCount}/{MAX_AI_REQUESTS_PER_PROJECT}.</p>}
              {aiCanPlan && aiUsageCount >= MAX_AI_REQUESTS_PER_PROJECT && <p className="workflow-help">Jatah AI proyek habis ({aiUsageCount}/{MAX_AI_REQUESTS_PER_PROJECT}). Pencarian lokal tetap tersedia.</p>}
              {scanProgress && <div className="inline-activity" role="status">
                <span className="spinner" aria-hidden="true" />
                <span>{scanProgress.total > 1 ? `Memindai ${scanProgress.current}/${scanProgress.total}: ${scanProgress.filename}` : `Memindai ${scanProgress.filename}…`} ({String(Math.floor(busyElapsedSec / 60)).padStart(2, '0')}:{String(busyElapsedSec % 60).padStart(2, '0')})</span>
              </div>}
              {scanProgress && scanProgress.total > 1 && <button className="button subtle" onClick={() => { cancelScanRef.current = true; setNotice({ kind: 'info', text: 'Menghentikan pemindaian setelah rekaman saat ini selesai…' }); }}>Hentikan pemindaian</button>}
              {busy === 'AI sedang meninjau metadata kandidat' && <div className="inline-activity" role="status"><span className="spinner" aria-hidden="true" /><span>AI sedang mengurutkan metadata kandidat…</span></div>}
              {busy === 'AI sedang meninjau metadata kandidat' && aiState?.aiBusy && <button className="button subtle" onClick={() => void cancelAIRequest()}>Batalkan tinjauan AI</button>}
              <button className="button subtle" aria-expanded={manualMarking} aria-controls={manualMarking ? 'manual-highlight' : undefined} disabled={missingMediaPaths.includes(selectedSource.path)} onClick={() => {
                if (!manualMarking) {
                  setPreviewRenderUrl('');
                  if (previewSource?.media_id !== selectedSource.media_id || (selectedClip && !reviewShot)) {
                    setSelectedClipId('');
                    setReviewShot({ sourceId: selectedSource.media_id, timeUs: 0 });
                  }
                }
                setManualMarking(!manualMarking);
              }}>{manualMarking ? 'Tutup penandaan manual' : 'Tandai kill manual'}</button>
            </div>
            {manualMarking && <div className="annotation-card" id="manual-highlight">
              <div className="annotation-source" title={selectedSource.filename}>{selectedSource.filename}</div>
              <p className="workflow-help">Jeda video tepat saat kill, lalu ambil waktunya. Studio menyiapkan awal dan akhir klip yang bisa kamu sesuaikan.</p>
              <button className="button subtle full" disabled={!manualVideoReady} onClick={readManualKillTime}>Ambil waktu dari video</button>
              <div className="time-inputs">
                <label>Mulai klip (d)<input type="number" step="any" min="0" max={selectedSource.duration_us / 1e6} value={eventIn} onChange={e => setEventIn(e.target.value)} /></label>
                <label>Momen kill (d)<input type="number" step="any" min="0" max={selectedSource.duration_us / 1e6} value={eventImpact} onChange={e => setEventImpact(e.target.value)} /></label>
                <label>Akhir klip (d)<input type="number" step="any" min="0" max={selectedSource.duration_us / 1e6} value={eventOut} onChange={e => setEventOut(e.target.value)} /></label>
              </div>
              <p className="workflow-help">Jenis highlight (opsional)</p>
              <div className="tag-row">{Object.entries({ headshot: 'Headshot', multikill: 'Multikill', clutch: 'Clutch', round_win: 'Menang ronde' }).map(([tag, label]) => <button key={tag} aria-pressed={eventTags.includes(tag)} className={`tag ${eventTags.includes(tag) ? 'active' : ''}`} onClick={() => setEventTags(tags => tags.includes(tag) ? tags.filter(item => item !== tag) : [...tags, tag])}>{label}</button>)}</div>
              <label className="field-label">Siapa yang mendapat kill?<select value={eventOwner} onChange={e => setEventOwner(e.target.value as 'player' | 'unknown')}><option value="player">Saya</option><option value="unknown">Belum yakin</option></select></label>
              <button className="button primary full" disabled={!eventIn || !eventImpact || !eventOut} onClick={addHighlight}>Simpan highlight</button>
            </div>}
          </> : <div className="empty-inline">Impor rekaman untuk menemukan dan memilih kill.</div>}
          <div className="event-list">
            {project.events.map((event, index) => {
              const source = project.sources.find(item => item.media_id === event.source_media_id);
              const onTimeline = project.timeline.some(clip => clip.event_id === event.event_id || clip.included_event_ids?.includes(event.event_id));
              return <div className="event-card" key={event.event_id}>
                <span className="event-index">{String(index + 1).padStart(2, '0')}</span><div className="event-copy"><strong>{timecode(event.source_time_us)} · {highlightLabel(event)}</strong><small title={source?.filename}>{source?.filename ?? 'Rekaman hilang'}</small></div>
                <div className="saved-highlight-actions">
                  {onTimeline ? <span className="on-timeline">Di montage</span> : <button className="button subtle compact" disabled={Boolean(busy)} onClick={() => addClip(event)}>Masukkan ke montage</button>}
                  <button className="button subtle compact" disabled={Boolean(busy)} aria-label={`Hapus highlight ${timecode(event.source_time_us)}`} onClick={() => removeHighlight(event.event_id)}>Hapus highlight</button>
                </div>
              </div>;
            })}
          </div>
          {dismissedCount > 0 && <button className="button subtle compact" disabled={Boolean(busy)} onClick={() => {
            commit(draft => {
              draft.dismissed_kill_candidates = project.sources.length > 1 && candidateFilter === 'all'
                ? []
                : draft.dismissed_kill_candidates?.filter(candidate => candidate.source_media_id !== selectedSourceId);
            });
            setNotice({ kind: 'info', text: allCandidates.length ? 'Kandidat ditampilkan kembali.' : 'Jalankan pencarian kill untuk meninjau kandidat lagi.' });
          }}>Tampilkan kembali kandidat ({dismissedCount})</button>}
          {(allUnsavedCount > 0 || unsavedCandidates.length > 0) && <section className="candidate-panel" aria-labelledby="candidate-heading">
            <div className="candidate-title">
              <h3 id="candidate-heading">Kandidat kill ({unsavedCandidates.length})</h3>
              {project.sources.length > 1 && <div className="candidate-filter" role="tablist" aria-label="Filter kandidat rekaman">
                <button className={`filter-pill ${candidateFilter === 'all' ? 'active' : ''}`} role="tab" aria-selected={candidateFilter === 'all'} onClick={() => setCandidateFilter('all')}>Semua ({allUnsavedCount})</button>
                <button className={`filter-pill ${candidateFilter === 'selected' ? 'active' : ''}`} role="tab" aria-selected={candidateFilter === 'selected'} onClick={() => setCandidateFilter('selected')}>Rekaman ini ({selectedUnsavedCount})</button>
              </div>}
              {aiKillReviews.length > 0 && <p>Urutan saran AI berdasarkan metadata. Cek cuplikan untuk memastikan kill.</p>}
              <p>Putar cuplikan dan cek nama pemain di kill feed sebelum menyimpan highlight.</p>
            </div>
            {unsavedCandidates.length === 0 && <p className="candidate-empty">Tidak ada kandidat belum disimpan untuk rekaman yang dipilih. Klik “Semua ({allUnsavedCount})” untuk melihat hasil dari rekaman lain.</p>}
            {unsavedCandidates.map(candidate => {
              const time = timecode(candidate.source_time_us);
              const active = reviewShot?.candidateId === candidate.candidate_id;
              const review = aiReviewOrder.get(candidate.candidate_id);
              const candidateSource = project.sources.find(item => item.media_id === candidate.source_media_id);
              return <article className={`candidate-card ${active ? 'reviewing' : ''}`} key={candidate.candidate_id}>
                <h4>Kill sekitar {time}</h4>
                {project.sources.length > 1 && candidateSource && <small className="candidate-source" title={candidateSource.filename}>{candidateSource.filename}</small>}
                {review && <p>{review.priority === 'prioritize' ? 'Prioritas AI' : 'Perlu cek ulang'}</p>}
                <p>{candidate.requires_ownership_review
                  ? 'Kandidat dari replay. Pastikan itu kill milikmu.'
                  : candidate.verified_by_upstream
                    ? 'Tembakan terdeteksi. Cek nama pemain di kill feed.'
                    : 'Cek apakah tembakan ini menghasilkan kill dan siapa yang mendapatkannya.'}</p>
                <details>
                  <summary>Detail deteksi</summary>
                  <p>Keyakinan deteksi {Math.round(candidate.confidence * 100)}% · Frame {candidate.source_frame} · Kill feed {candidate.feed_frame ?? '—'}</p>
                  <p>{candidate.method}{candidate.suggested_tags.length > 0 && ` · ${candidate.suggested_tags.map(tag => tag.replace('_', ' ')).join(' · ')}`}</p>
                </details>
                <div className="candidate-actions">
                  <button id={`review-${candidate.candidate_id}`} className="button subtle compact" aria-pressed={active} aria-label={`Lihat cuplikan kill sekitar ${time}`} onClick={() => showKillCandidate(candidate)}>Lihat cuplikan</button>
                  <button className="button subtle compact" aria-label={`Konfirmasi kill sekitar ${time}`} title="Simpan setelah memastikan ini kill milikmu" onClick={() => confirmKillCandidate(candidate)}>Konfirmasi</button>
                  <button className="button subtle compact" disabled={Boolean(busy)} aria-label={`Abaikan kandidat sekitar ${time}`} onClick={() => dismissKillCandidate(candidate)}>Abaikan</button>
                </div>
              </article>;
            })}
          </section>}
        </aside>

        <main className="edit-column">
          <div className="editor-toolbar">
            <strong className="editor-label">Pemutar video</strong>
            <div className="toolbar-right"><span className={`status-chip ${workerStatusClass}`}><i />{workerStatusLabel}</span><span className="output-chip">{project.reference_draft ? '1080P60 UPSTREAM' : project.settings.output_profile === 'master_144' ? '144 FPS MASTER' : '60 FPS YOUTUBE'}</span></div>
          </div>

          <section className="preview-stage" ref={previewStageRef} tabIndex={-1} aria-label="Pemutar video">
            <div className="stage-topline"><span>{previewRenderUrl ? (renderMode === 'rough_preview' ? 'Preview tanpa efek' : 'Preview dengan efek') : candidatePreview ? 'Cuplikan kandidat' : rangePreview ? 'Cuplikan klip timeline · tanpa efek' : previewSource ? 'Rekaman sumber · tanpa efek montage' : 'Rekaman sumber'} · {previewRenderUrl ? project.name : previewSource?.filename ?? 'Belum ada rekaman'}</span></div>
            <div className="video-frame">
              {previewUrl ? <video key={previewKey} ref={videoRef} src={previewUrl} controls={!rangePreview} playsInline aria-label={candidatePreview ? 'Cuplikan kandidat' : rangePreview ? 'Cuplikan klip timeline' : previewRenderUrl ? 'Preview montage' : 'Rekaman sumber'}
                onEmptied={() => { setMonitorTime(0); setMonitorDuration(0); }}
                onPlay={() => setMonitorPlaying(true)}
                onPause={() => setMonitorPlaying(false)}
                onEnded={() => setMonitorPlaying(false)}
                onLoadedMetadata={event => {
                  const video = event.currentTarget;
                  video.currentTime = previewRenderUrl ? 0 : (rangePreview?.in_us ?? (reviewShot ? Math.max(0, reviewShot.timeUs - 400_000) : 0)) / 1e6;
                  setMonitorPlaying(false);
                  setMonitorTime(video.currentTime);
                  setMonitorDuration(Number.isFinite(video.duration) ? video.duration : 0);
                }}
                onSeeked={event => setMonitorTime(event.currentTarget.currentTime)}
                onTimeUpdate={event => {
                  const video = event.currentTarget;
                  setMonitorTime(video.currentTime);
                  if (rangePreview && video.currentTime >= rangePreview.out_us / 1e6) {
                    video.pause();
                    if (Math.round(video.currentTime * 1e6) > rangePreview.out_us) video.currentTime = rangePreview.out_us / 1e6;
                  }
                }} /> : <div className="preview-placeholder"><strong>{previewSource ? 'Pratinjau rekaman belum tersedia' : 'Impor rekaman untuk mulai'}</strong><span>{previewSource ? 'Periksa FFmpeg, lalu impor ulang rekaman.' : 'Setelah impor, kamu bisa mencari kill otomatis atau menandai kill dari pemutar ini.'}</span></div>}

            </div>
            {previewUrl && <div className="monitor-controls">
              <span className="monitor-time">{rangePreview
                ? `Sumber ${timecode(rangePreview.in_us)}–${timecode(rangePreview.out_us)}${candidatePreview ? ` · Kill ${timecode(candidatePreview.source_time_us)}` : ''}`
                : <>{timecode(monitorTime * 1e6)} <i>/</i> {timecode(monitorDuration * 1e6)}{reviewShot && !previewRenderUrl ? ' · Penanda ' + timecode(reviewShot.timeUs) : ''}</>}</span>
              {rangePreview && <div className="candidate-playback">
                <button className="button subtle compact" onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  if (!video.paused) { video.pause(); return; }
                  if (video.currentTime >= rangePreview.out_us / 1e6 || video.currentTime < rangePreview.in_us / 1e6) video.currentTime = rangePreview.in_us / 1e6;
                  void video.play().catch(error => setNotice({ kind: 'error', text: getError(error) }));
                }}>{monitorPlaying ? 'Jeda' : 'Putar cuplikan'}</button>
                <input type="range" aria-label="Posisi cuplikan" aria-valuetext={timecode(monitorTime * 1e6)}
                  min={rangePreview.in_us / 1e6} max={rangePreview.out_us / 1e6} step="any"
                  value={Math.max(rangePreview.in_us / 1e6, Math.min(monitorTime, rangePreview.out_us / 1e6))}
                  onChange={event => { if (videoRef.current) videoRef.current.currentTime = Number(event.currentTarget.value); }} />
                <button className="button subtle compact" onClick={() => setReviewShot({ sourceId: rangePreview.source_media_id, timeUs: 0 })}>Buka rekaman penuh</button>
              </div>}
              {reviewShot?.candidateId && !previewRenderUrl && <button className="button subtle compact" onClick={() => document.getElementById(`review-${reviewShot.candidateId}`)?.focus()}>Kembali ke kandidat</button>}
              {previewRenderUrl && <button className="button subtle compact" onClick={() => setPreviewRenderUrl('')}>Kembali ke rekaman</button>}
            </div>}
          </section>

          <section className="timeline-section">
            <div className="timeline-header">
              <div><h2>Urutan montage</h2><p className="workflow-help">{clipCount} klip · {timelineSeconds.toFixed(1)} dtk</p></div>
              <div className="timeline-actions">
                {project.reference_draft ? <button className="button subtle compact" disabled={!reference || Boolean(busy)}
                  onClick={() => setRenderReview('preview')}>Preview draft dengan efek</button> : <>
                  <button className="button subtle compact" onClick={() => void renderPreview('rough_preview')} disabled={!clipCount || Boolean(busy) || !previewAllowed}>Preview tanpa efek</button>
                  <button className="button subtle compact" onClick={() => void renderPreview('effects_preview')} disabled={!clipCount || Boolean(busy) || !previewAllowed}>Preview dengan efek</button>
                </>}
                <button className="button subtle compact" onClick={() => void generateReferenceDraft()} disabled={!project.sources.length || !project.music || Boolean(busy) || !workerState?.upstream?.rife_model_available}>Buat draft otomatis</button>
                <button className="button compact subtle" onClick={() => setActivePanel('director')}>Buka Director</button>
                {!project.reference_draft && hasAutoKillClips && <button className="button subtle compact" disabled={Boolean(busy)} onClick={() => {
                  if (!repairableClips) {
                    setNotice({ kind: 'info', text: 'Batas klip kill otomatis sudah rapi. Pilih klip untuk meninjau cuplikannya.' });
                    return;
                  }
                  commit(draft => trimOverlappingAutoKillClips(draft, undefined, allActiveCandidates));
                  setNotice({ kind: 'success', text: 'Batas klip dirapikan supaya kill tetangga tidak terulang. Ctrl+Z untuk membatalkan.' });
                }}>Rapikan kill berulang</button>}
              </div>
            </div>
            {reference ? <p className="workflow-help">Pilih klip untuk melihat rekaman sumber, atau buat preview untuk memeriksa draft lengkap dengan musik dan efek.</p>
              : clipCount && !previewAllowed ? <p className="workflow-help">{beatSyncNeedsMusic ? 'Tambahkan musik atau setel Sinkronisasi ke beat ke 0% untuk membuat preview.' : 'Konfirmasi izin penggunaan musik dan highlight melalui pengaturan atau dialog ekspor.'}</p>
              : !project.music ? <p className="workflow-help">Tambahkan musik untuk membuat draft otomatis, atau masukkan highlight pilihanmu ke urutan.</p> : null}
            <div className="ruler">{[0, 1, 2, 3, 4].map(tick => <span key={tick}>{timecode(timelineSeconds * tick * 250_000)}</span>)}</div>
            <div className="track-row"><div className="track-label"><b>V1</b><span>GAMEPLAY</span></div><div className="track-content">
              {reference ? reference.takes.map((take, index) => <button key={index} className="timeline-clip draft-clip" style={{ flexGrow: take.end_frame - take.start_frame }}
                disabled={!reference.source_ids?.[take.source_alias] || !take.anchors.length}
                onClick={() => {
                  setPreviewRenderUrl('');
                  setReviewShot({ sourceId: reference.source_ids[take.source_alias], timeUs: take.anchors[0].source_us });
                }}>
                <span className="clip-number">{String(index + 1).padStart(2, '0')}</span><span className="draft-clip-label">Klip {index + 1}<small>{take.impacts.length} kill · {timecode(take.start_frame * 1e6 / reference.fps)}</small></span>
              </button>) : project.timeline.length ? project.timeline.map((clip, index) => {
                const event = project.events.find(item => item.event_id === clip.event_id);
                const source = project.sources.find(item => item.media_id === clip.source_media_id);
                const impactCount = clip.included_event_ids?.length ?? 1;
                const label = impactCount > 1 ? `MULTIKILL · ${impactCount} IMPACTS`
                  : event ? highlightLabel(event) : `Highlight ${index + 1}`;
                return <div key={clip.clip_id} className={`timeline-clip ${clip.clip_id === selectedClipId ? 'selected' : ''}`} style={{ flexGrow: Math.max(0.6, clip.duration_frames / selectedFPS), flexBasis: 104 }} role="button" tabIndex={0} aria-pressed={clip.clip_id === selectedClipId} aria-label={label} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.currentTarget.click(); } }} draggable onDragStart={() => setDraggingClip(clip.clip_id)} onDragEnd={() => setDraggingClip('')} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); reorderClip(draggingClip, clip.clip_id); }} onClick={() => { setReviewShot(null); setSelectedClipId(clip.clip_id); }}>
                  <span className="clip-number">{String(index + 1).padStart(2, '0')}</span><span className="clip-icon">◢</span><div><strong>{label}</strong><small>{source?.filename ?? 'Source missing'}</small></div><span className="clip-duration">{(clip.duration_frames / selectedFPS).toFixed(1)}s</span>
                </div>;
              }) : <div className="track-empty">Tambah highlight dari library atau buat draft untuk mengisi timeline.</div>}
              <div className="playhead" />
            </div></div>
            <div className="audio-track-row"><div className="track-label"><b>A1</b><span>MUSIC</span></div><div className="audio-track-content">{project.music ? <div className="audio-lane"><div className="audio-lane-wave">{(project.music.waveform ?? []).map((height, index) => <i key={index} style={{ height: `${Math.max(8, height * 88)}%` }} />)}</div>{project.music.beat_grid.filter(marker => marker.time_us >= project.music!.offset_us && marker.time_us - project.music!.offset_us < timelineSeconds * 1_000_000).map(marker => <b key={marker.marker_id} style={{ left: `${(marker.time_us - project.music!.offset_us) / Math.max(1, timelineSeconds * 1_000_000) * 100}%` }} />)}<span>{project.music.bpm_estimate ?? '—'} BPM</span></div> : <div className="audio-track-empty">Tambahkan musik untuk melihat gelombang audio dan penanda beat.</div>}</div></div>
            {selectedClip && selectedEvent && <div className="trim-row"><div className="track-label"><b>TRIM</b><span>SELECTED</span></div><div className="trim-controls"><label>IN <input type="number" step="0.01" min={seconds(selectedEvent.in_us)} max={seconds(earliestIncludedImpact)} value={seconds(selectedClip.in_us)} onChange={e => updateClip('in_us', Math.round(Number(e.target.value) * 1_000_000))} />s</label><span>→</span><label>OUT <input type="number" step="0.01" min={seconds(latestIncludedImpact)} max={seconds(selectedEvent.out_us)} value={seconds(selectedClip.out_us)} onChange={e => updateClip('out_us', Math.round(Number(e.target.value) * 1_000_000))} />s</label><span className="trim-hint">Semua impact sequence tetap berada dalam trim</span><button className="remove-clip" title="Remove selected clip" onClick={() => { commit(draft => { draft.timeline = draft.timeline.filter(item => item.clip_id !== selectedClip.clip_id); rebuildTimeline(draft); }); setNotice({ kind: 'info', text: 'Clip dilepas dari timeline; anotasi sumber tetap ada.' }); }}>Remove clip ×</button></div></div>}
          </section>
        </main>

        <aside className="inspector-column">
          <div className="inspector-tabs"><button className={activePanel === 'edit' ? 'active' : ''} onClick={() => setActivePanel('edit')}>PENGATURAN</button><button className={activePanel === 'director' ? 'active' : ''} onClick={() => setActivePanel('director')}>DIRECTOR <span>✦</span></button></div>
          {project.reference_draft && <div className="inspector-scroll reference-draft">
            <h2>Review draft otomatis</h2>
            {referenceError && <p role="alert">{referenceError}</p>}
            {reference && <>
              <p>{reference.takes.length} klip · {(reference.frames / reference.fps).toFixed(2)}s · lagu mulai di {timecode(reference.music_offset_us)}</p>
              {reference.rhythm && <p>
                {reference.rhythm.measured_count}/{reference.rhythm.selected_count} impact dicocokkan ke aksen musik.
                {reference.rhythm.mode === 'regular_drums'
                  ? ` Satu ${reference.rhythm.drum} per kill, setiap ${reference.rhythm.beat_spacing} beat.`
                  : reference.rhythm.reason === 'continuous_engagement'
                    ? ' Jarak beat menyesuaikan rangkaian aksi.'
                    : ' Draft memakai aksen terukur dengan jarak yang menyesuaikan musik.'}
              </p>}
              {reference.visual_reference && <p>Rujukan transisi dan fade · {reference.visual_reference.filename}</p>}
              {reference.final_action && <button className="button subtle compact" onClick={() => {
                const action = reference.final_action!;
                setPreviewRenderUrl('');
                setReviewShot({ sourceId: reference.source_ids[action.source_alias], timeUs: action.source_time_us });
              }}>Awal aksi kill terakhir · {timecode(reference.final_action.action_frame * 1e6 / reference.fps)}</button>}
              {reference.ending_confirmation && <button className="button subtle compact" onClick={() => {
                const ace = reference.ending_confirmation!;
                setPreviewRenderUrl('');
                setReviewShot({ sourceId: reference.source_ids[ace.source_alias], timeUs: ace.source_time_us });
              }}>ACE · {timecode(reference.ending_confirmation.output_frame * 1e6 / reference.fps)}</button>}
              {reference.planning_notices?.map(notice => <p key={notice}>{notice}</p>)}
              {reference.auto_selected && <p>Studio memilih kandidat kill secara otomatis. Cek rekamannya sebelum mengonfirmasi dan mengekspor.</p>}
              <ol>{reference.takes.map((take, index) => <li key={index}>
                <strong>{reference.sources[take.source_alias]}</strong>
                <div>{timecode(take.start_frame * 1e6 / reference.fps)} – {timecode(take.end_frame * 1e6 / reference.fps)} · {take.transition}</div>
                {take.impacts.map(impact => <button key={impact.shot_frame} className="button subtle compact"
                  disabled={!reference.source_ids?.[take.source_alias] || !Number.isFinite(impact.source_time_us)}
                  onClick={() => { setPreviewRenderUrl(''); setReviewShot({ sourceId: reference.source_ids[take.source_alias], timeUs: impact.source_time_us }); }}>
                  {impact.beat_number ? `Kill ${impact.beat_number}` : 'Review shot'} {timecode(impact.shot_frame * 1e6 / reference.fps)}
                  {' · '}{impact.attack?.kind ?? 'beat'} {timecode(impact.beat_time_us)}
                </button>)}
                {take.impacts.map(impact => impact.setup_frame === undefined || impact.confirmation_frame === undefined ? null :
                  <small key={impact.shot_frame}>
                    Awal aksi {timecode((reference.final_action?.shot_frame === impact.shot_frame ? reference.final_action.action_frame : impact.setup_frame) * 1e6 / reference.fps)} · Impact {timecode(impact.shot_frame * 1e6 / reference.fps)} · Konfirmasi {timecode(impact.confirmation_frame * 1e6 / reference.fps)}
                  </small>)}
              </li>)}</ol>
            </>}
            <p>Untuk mengubah pilihan kill atau urutannya, edit pilihan highlight lalu buat draft otomatis lagi.</p>
            <button className="button subtle" disabled={Boolean(busy) || !reference?.selection?.length} onClick={editReferenceSelection}>Edit pilihan highlight</button>
            <button className="button subtle" disabled={Boolean(busy)} onClick={() => commit(draft => { delete draft.reference_draft; })}>Lepas draft otomatis</button>
          </div>}
          {activePanel === 'edit' ? <div className="inspector-scroll">
            <div className="inspector-heading"><span className="eyebrow">OUTPUT PROFILE</span><h2>Pengaturan montage</h2></div>
            <div className="field-label">
              Referensi gaya
              {project.reference_video && <small>{project.reference_video.filename}</small>}
              {referenceMissing && <>
                <small role="status">File video referensi tidak ditemukan.</small>
                <button className="button subtle compact" onClick={() => void relinkMissingReference()} disabled={Boolean(busy)}>Temukan video referensi</button>
              </>}
              <button className="button subtle compact" onClick={() => void selectStyleReference()} disabled={Boolean(busy)}>
                {project.reference_video ? 'Ganti video referensi' : 'Pilih video referensi'}
              </button>
              {project.reference_video && <button className="button subtle compact" disabled={Boolean(busy)}
                onClick={() => commit(draft => { delete draft.reference_video; delete draft.reference_draft; })}>
                Lepas referensi
              </button>}
            </div>
            {!project.reference_draft && <label className="field-label">Format ekspor<select value={project.settings.output_profile} onChange={e => commit(draft => { draft.settings.output_profile = e.target.value as Project['settings']['output_profile']; rebuildTimeline(draft); })}><option value="master_144">Master · 144 FPS</option><option value="youtube_60">YouTube · 60 FPS</option></select></label>}
            <div className="resolution-box"><div><strong>{project.reference_draft ? "1920 × 1080" : "2560 × 1440"}</strong><span>{project.reference_draft ? "Format draft otomatis" : "QHD · 16:9"}</span></div><b>{project.reference_draft ? 60 : selectedFPS}<small> FPS</small></b></div>
            <SettingsSlider label="Sinkronisasi ke beat" max={1} value={project.settings.beat_sync_priority}
              help={project.music ? 'Prioritas sinkronisasi dengan musik.' : 'Sinkronisasi beat memerlukan musik. Untuk export tanpa musik, atur ke 0%.'}
              onValue={value => commit(draft => { draft.settings.beat_sync_priority = value; })} />
            <SettingsSlider label="Intensitas efek" max={1} value={project.settings.effects_intensity}
              help="Mengatur zoom saat kill, flash, shake, dan blur pada preview dengan efek dan hasil ekspor."
              onValue={value => commit(draft => {
                draft.settings.effects_intensity = value;
                for (const clip of draft.timeline) {
                  const ids = clip.included_event_ids ?? [clip.event_id];
                  const grouped = ids.map(id => draft.events.find(item => item.event_id === id))
                    .filter((item): item is HighlightEvent => Boolean(item));
                  const event = grouped.find(item => item.event_id === clip.event_id);
                  if (event) {
                    const tags = [...new Set(grouped.flatMap(item => item.tags))];
                    if (grouped.length > 1 && !tags.includes('multikill')) tags.push('multikill');
                    const effective = { ...event, confidence: Math.max(...grouped.map(item => item.confidence)), tags };
                    clip.effects = makeAutomaticEffects(effective, value);
                  } else {
                    clip.effects = [];
                  }
                }
              })} />
            <SettingsSlider label="Volume gameplay" max={1.5} value={project.settings.gameplay_gain} help="Rentang 0–150%."
              onValue={value => commit(draft => {
                draft.settings.gameplay_gain = value;
                for (const clip of draft.timeline) clip.audio_gain = value;
              })} />
            <SettingsSlider label="Volume musik" max={0.75} value={project.settings.music_gain} help="Rentang 0–75%."
              onValue={value => commit(draft => { draft.settings.music_gain = value; })} />

            <div className="music-panel"><div className="music-title"><div className="music-art">♫</div><div><span className="eyebrow">LAGU MONTAGE</span><strong>{project.music?.filename ?? 'Belum ada musik'}</strong><small>{project.music ? `${project.music.bpm_estimate ?? '—'} BPM · ${project.music.beat_grid.length} beat candidates` : 'Pilih lagu yang boleh kamu gunakan'}</small></div><button className="button subtle compact" onClick={() => void importMusic()} disabled={Boolean(busy)}>{project.music ? "Ganti musik" : "Tambah musik"}</button></div>
            {musicMissing && <div className="missing-recording"><small role="status">File musik tidak ditemukan.</small><button className="button subtle compact" onClick={() => void relinkMissingMusic()} disabled={Boolean(busy)}>Temukan lagu asli</button></div>}
              {project.music && <><div className="waveform" aria-label="Music waveform">{(project.music.waveform?.length ? project.music.waveform : project.music.beat_grid.slice(0, 90).map(marker => marker.confidence)).map((height, i) => <i key={i} style={{ height: `${Math.max(8, height * 100)}%` }} />)}{project.music.beat_grid.slice(0, 18).map(marker => <b key={marker.marker_id} style={{ left: `${Math.min(99, marker.time_us / Math.max(1, project.music!.duration_us) * 100)}%` }} />)}</div><label className="field-label offset-field">Music offset <span className="suffix-input"><input type="number" step="0.01" min="0" value={seconds(project.music.offset_us)} onChange={e => commit(draft => { if (draft.music) draft.music.offset_us = Math.max(0, Math.round(Number(e.target.value) * 1_000_000)); })}/>sec</span></label><label className="check-row"><input type="checkbox" checked={musicRights} onChange={e => setMusicRights(e.target.checked)}/><span>I have rights to use this audio in my montage.</span></label></>}
            </div>

            {selectedClip && <div className="clip-inspector">
              <div className="inspector-heading"><span className="eyebrow">SELECTED CLIP</span><h2>{selectedClipEventIds.length > 1 ? `Multikill · ${selectedClipEventIds.length} kill` : selectedEvent ? highlightLabel(selectedEvent) : 'Highlight'}</h2></div>
              <div className="detail-row"><span>Source</span><b>{project.sources.find(item => item.media_id === selectedClip.source_media_id)?.filename}</b></div>
              <div className="detail-row"><span>Duration</span><b>{(selectedClip.duration_frames / selectedFPS).toFixed(2)} sec · {selectedClip.time_remap.length} map sections</b></div>
              {selectedEvent && <div className="field-label">
                <button className="button subtle compact" onClick={() => { setPreviewRenderUrl(''); setReviewShot({ sourceId: selectedEvent.source_media_id, timeUs: selectedEvent.source_time_us }); }}>Lihat cuplikan untuk menandai aksi dan ACE</button>
                <button className="button subtle compact" onClick={() => markEndingFrame('action')}>Tandai awal aksi dari pemutar</button>
                <button className="button subtle compact" onClick={() => markEndingFrame('ace')}>Tandai saat tulisan ACE terlihat</button>
                {selectedEvent.evidence.some(item => item.type === 'reviewed_final_action') && <button className="button subtle compact" onClick={() => commit(draft => {
                  const event = draft.events.find(item => item.event_id === selectedEvent.event_id)!;
                  event.evidence = event.evidence.filter(item => item.type !== 'reviewed_final_action');
                  delete draft.reference_draft;
                })}>Clear action mark</button>}
                {selectedEvent.evidence.some(item => item.type === 'reviewed_ace_banner') && <button className="button subtle compact" onClick={() => commit(draft => {
                  const event = draft.events.find(item => item.event_id === selectedEvent.event_id)!;
                  event.evidence = event.evidence.filter(item => item.type !== 'reviewed_ace_banner');
                  delete draft.reference_draft;
                })}>Clear ACE mark</button>}
              </div>}
              <div className="detail-row"><span>Ownership</span><b>{selectedEvent?.owner === 'player' ? 'Player confirmed' : 'Unknown'}</b></div>
              <div className="effect-controls"><span className="eyebrow">RENDERED EFFECTS</span>
                {([['impact_zoom', 'Zoom saat kill'], ['impact_flash', 'Impact flash'], ['screen_shake', 'Screen shake'], ['motion_blur', 'Motion blur']] as const).map(([type, label]) => {
                  const effect = selectedClip.effects.find(item => item.type === type);
                  return <label className="check-row effect-toggle" key={type}><input type="checkbox" checked={effect?.enabled ?? false} onChange={event => setClipEffect(type, event.target.checked)}/><span>{label}</span><small>{effect?.enabled ? 'ON' : 'OFF'}</small></label>;
                })}
                {zoomEffect?.enabled && <SettingsSlider label="Impact zoom peak keyframe" min={1} max={1.08} step={0.001}
                  value={zoomEffect.max_zoom} unit="multiplier" help="Puncak zoom pada frame impact."
                  onValue={setZoomPeak} />}
              </div>
              <button className="button subtle full" onClick={applySpeedRamp}>Apply post-kill speed ramp</button>
              <label className="check-row reverse-toggle"><input type="checkbox" checked={selectedClip.time_remap.some(segment => segment.direction === 'reverse')} onChange={event => setReverseReplay(event.target.checked)}/><span>Reverse slow-motion replay accent</span></label>
              <label className="check-row reverse-toggle"><input type="checkbox" checked={selectedClip.transitions.some(transition => transition.enabled)} onChange={event => setClipTransition(event.target.checked)}/><span>8-frame dip transition at this cut</span></label>
              <small className="small-note">Reverse mode repeats a short post-impact section; no source frames are removed.</small>
              <button className="button subtle full" onClick={() => { const index = project.timeline.findIndex(item => item.clip_id === selectedClip.clip_id); if (index > 0) reorderClip(selectedClip.clip_id, project.timeline[index - 1].clip_id); }}>Geser klip lebih awal ↑</button>
            </div>}

            {ownerUnknownCount > 0 && <label className="check-row ownership-check"><input type="checkbox" checked={ownerRights} onChange={e => setOwnerRights(e.target.checked)}/><span>Confirm that the {ownerUnknownCount} unknown-owner highlight(s) belong to or are authorized by me.</span></label>}
            <div className="worker-status"><span className={`status-chip ${workerStatusClass}`} title={workerState?.media.version}><i />{!workerState ? 'CHECKING FFMPEG' : capabilitiesReady ? 'FFMPEG READY' : 'FFMPEG + FFPROBE NEEDED'}</span><small>{workerDiagnostic}</small><small>Upstream RIFE: {upstreamDiagnostic}</small></div>
          </div> : <DirectorPanel aiState={aiState} aiCanPlan={aiCanPlan} aiConsent={aiConsent} setAIConsent={setAIConsent} modelLabel={modelLabel} aiUsageCount={aiUsageCount} project={project} proposal={proposal} busy={busy} onGenerateRule={generateRuleDraft} onGenerateAI={() => void generateAIProposal()} onAccept={acceptProposal} onReject={rejectProposal} onAI={handleAI} onTest={() => void testAIConnection()} onCancel={() => void cancelAIRequest()} />}
        </aside>
      </div>

      {renderReview && <dialog ref={exportDialogRef} className="export-modal" aria-labelledby="export-title" onCancel={event => { event.preventDefault(); setRenderReview(null); }}>
        <h2 id="export-title">{renderReview === 'preview' ? 'Periksa sebelum preview' : 'Periksa sebelum ekspor'}</h2>
        <p>Studio akan merender file MP4 lalu memeriksa hasil video dan audio.</p>
        {project.music ? <label className="check-row modal-check"><input type="checkbox" checked={musicRights} onChange={e => setMusicRights(e.target.checked)}/><span>Saya punya izin memakai “{project.music.filename}”.</span></label>
          : beatSyncNeedsMusic ? <div className="modal-note" role="status">
            <p>Sinkronisasi beat aktif. Tambahkan musik, atau lanjutkan dengan suara gameplay dan matikan sinkronisasi beat.</p>
            <div className="modal-actions">
              <button className="button subtle" disabled={Boolean(busy)} onClick={() => void importMusic()}>Tambah musik</button>
              <button className="button subtle" onClick={() => commit(draft => { draft.settings.beat_sync_priority = 0; })}>Matikan sinkronisasi beat</button>
            </div>
          </div> : <div className="modal-note">Montage memakai suara gameplay jika rekaman memiliki audio.</div>}
        {(project.reference_draft || ownerUnknownCount > 0) && <label className="check-row modal-check"><input type="checkbox" checked={ownerRights} onChange={e => setOwnerRights(e.target.checked)}/><span>Saya sudah mengecek highlight dan memiliki izin untuk menggunakannya.</span></label>}
        <div className="modal-summary"><span>Format video</span><b>{outputDescription} · H.264</b></div>
        <div className="modal-actions"><button className="button subtle" autoFocus onClick={() => setRenderReview(null)}>Batal</button><button className="button primary" disabled={Boolean(busy) || beatSyncNeedsMusic || (Boolean(project.music) && !musicRights) || ((Boolean(project.reference_draft) || ownerUnknownCount > 0) && !ownerRights)} onClick={() => {
          setRenderReview(null);
          if (renderReview === 'preview') void renderPreview('effects_preview');
          else void exportProject();
        }}>{renderReview === 'preview' ? 'Buat preview draft' : 'Pilih lokasi dan ekspor'}</button></div>
      </dialog>}
      {notice && <div className={`toast ${notice.kind}`} role="status"><span>{notice.kind === 'error' ? '!' : notice.kind === 'success' ? '✓' : 'i'}</span><p>{notice.text}</p><button onClick={() => setNotice(null)}>×</button></div>}
      {busy && !(busy === 'Rendering' && renderJob) && <div className="render-dock activity-dock" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <div className="render-copy">
          <span className="eyebrow">{busy === 'Planning upstream montage' ? 'UPSTREAM DRAFT' : scanProgress ? 'PEMINDAIAN LOKAL' : busy === 'AI sedang meninjau metadata kandidat' || busy === 'Membuat draft ChatGPT' || busy === 'Memeriksa koneksi ChatGPT' ? 'TINJAUAN AI' : 'MEMPROSES'}</span>
          <strong>{busy === 'Planning upstream montage' ? 'Mendeteksi shot dan menyusun draft pada beat lagu…' : scanProgress ? (scanProgress.total > 1 ? `Memindai rekaman ${scanProgress.current}/${scanProgress.total}: ${scanProgress.filename}` : `Memindai rekaman: ${scanProgress.filename}`) : `${busy}…`}</strong>
          {scanProgress && <small className="activity-sub">Proses video 100% lokal (~30–60 dtk per rekaman 1080p VFR). Hasil langsung muncul di panel Review kill saat tiap rekaman selesai.</small>}
        </div>
        {scanProgress && scanProgress.total > 1
          ? <div className="progress-track" aria-hidden="true"><i style={{ width: `${Math.max(8, Math.round((scanProgress.current / scanProgress.total) * 100))}%` }} /></div>
          : <div className="progress-track indeterminate" aria-hidden="true"><i /></div>}
        <b className="activity-timer">{String(Math.floor(busyElapsedSec / 60)).padStart(2, '0')}:{String(busyElapsedSec % 60).padStart(2, '0')}</b>
        {scanProgress && scanProgress.total > 1 && <button className="button subtle compact" onClick={() => { cancelScanRef.current = true; setNotice({ kind: 'info', text: 'Menghentikan pemindaian setelah rekaman saat ini selesai…' }); }}>Hentikan</button>}
        {aiState?.aiBusy && <button className="button subtle compact" onClick={() => void cancelAIRequest()}>Batalkan</button>}
      </div>}
      {busy === 'Rendering' && renderJob && <div className="render-dock"><div className="render-copy"><span className="eyebrow">{renderMode === 'master' ? 'EXPORTING MASTER' : renderMode === 'rough_preview' ? 'RENDERING ROUGH PREVIEW' : 'RENDERING EFFECTS PREVIEW'}</span><strong>{renderJob.message}</strong></div><div className="progress-track"><i style={{ width: `${Math.round(renderJob.progress * 100)}%` }} /></div><b>{Math.round(renderJob.progress * 100)}%</b><button className="button subtle compact" onClick={() => void cancelRender()}>Cancel</button></div>}
      {completedRender && <div className="qa-dock"><div><span className={`qa-status ${completedRender.qa.status.toLowerCase()}`}>{completedRender.qa.status}</span><strong>{renderMode === 'master' ? 'Export QA' : 'Preview QA'} {completedRender.state === 'needs_review' ? 'needs review' : 'passed'}</strong><small>{completedRender.qa.checks.filter(item => item.status !== 'PASS').length} notes · {completedRender.output_path}</small></div><button className="button subtle compact" onClick={() => void window.vms.revealLocalFile(completedRender.qa_html)}>Open QA report</button><button className="button compact primary" onClick={() => void window.vms.revealLocalFile(completedRender.output_path)}>Open video</button><button className="close-dock" onClick={() => setRenderJob(null)}>×</button></div>}

      <footer className="statusbar"><span><i className="status-led" />Media diproses di perangkat ini</span><span>{project.sources.length} rekaman <b>·</b> {reference ? reference.takes.reduce((sum, take) => sum + take.impacts.length, 0) : project.events.length} highlight <b>·</b> {clipCount} klip</span><span>{outputDescription}</span></footer>
    </div>
  );
}

function DirectorPanel(props: { aiState: AIState | null; aiCanPlan: boolean; aiConsent: boolean; setAIConsent: (value: boolean) => void;
  modelLabel: string; aiUsageCount: number; project: Project; proposal: DirectorProposal | null; busy: string;
  onGenerateRule: () => void; onGenerateAI: () => void; onAccept: () => void; onReject: () => void;
  onAI: (action: () => Promise<AIState>) => Promise<void>; onTest: () => void; onCancel: () => void }) {
  const { aiState, aiCanPlan, aiConsent, setAIConsent, modelLabel, aiUsageCount, project, proposal, busy } = props;
  const count = project.timeline.length ? project.timeline.length : project.events.length;
  const effortAvailable = supportsAIEffort(aiState?.selectedModel ?? '') && aiState?.modelCatalog.status === 'ready';
  const atRequestLimit = aiUsageCount >= MAX_AI_REQUESTS_PER_PROJECT;
  const aiStatus = aiState?.session.status === 'connected' ? (aiState.session.sharing ? 'PLAN USAGE ENABLED' : 'CONSENT REQUIRED') : aiState?.session.status === 'reauth_required' ? 'RECONNECT REQUIRED' : 'NOT CONNECTED';
  return <div className="inspector-scroll director-scroll">
    <div className="director-hero"><span className="eyebrow">CREATIVE SYSTEM / 01</span><h2>Creative Director<span>✦</span></h2><p>Build an editable cut from reviewed highlights. Every suggestion remains yours to approve.</p></div>
    <div className="mode-toggle"><div><strong>Director mode</strong><small>AI can be switched off at any time.</small></div><span className="mode-pill">CHATGPT + RULES</span></div>
    <div className="connection-wrap">
      <ChatGPTConnectionCard status={aiState?.session.status ?? 'disconnected'} sharing={Boolean(aiState?.session.sharing)} identity={aiState?.session.identity} appName="VALORANT Montage Studio"
        onConnect={() => void props.onAI(() => aiState?.session.status === 'connected' ? window.vms.aiReconnectSharing() : window.vms.aiConnect())}
        onDisconnect={() => void props.onAI(() => window.vms.aiDisconnect())} onManageUsage={() => void window.vms.aiOpenUsage()} />
      <div className="ai-status-line"><span className={`status-chip ${aiCanPlan ? 'ok' : 'warn'}`}><i />{aiStatus}</span>{aiState?.session.error && <small>{aiState.session.error.message}</small>}</div>
      {aiState?.profiles && aiState.profiles.length > 0 && <div className="account-row"><label className="field-label">Saved account<select value={aiState.session.profileId ?? ''} onChange={e => void props.onAI(() => window.vms.aiSelectProfile(e.target.value))}>{aiState.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.identity?.email ?? profile.label}{profile.sharing ? ' · plan usage' : ''}</option>)}</select></label><button className="button subtle compact" onClick={() => void props.onAI(() => window.vms.aiAddAccount())}>Add account</button></div>}
      {aiState?.session.status === 'connecting' && <button className="button subtle full" onClick={() => void window.vms.aiCancelSignIn()}>Cancel sign-in</button>}
    </div>
    <div className="model-card"><div className="model-head"><div><span className="eyebrow">MODEL AVAILABILITY</span><strong>{modelLabel}</strong></div><button className="refresh-button" title="Refresh models from connected account" onClick={() => void props.onAI(() => window.vms.aiRefreshModels())} disabled={!aiState?.session.sharing}>↻</button></div>
      <label className="field-label">Account models<select value={aiState?.selectedModel ?? ''} onChange={e => void props.onAI(() => window.vms.aiSetModel(e.target.value))} disabled={!aiState?.modelCatalog.models.length}>{aiState?.modelCatalog.models.length ? aiState.modelCatalog.models.map(model => <option key={model.slug} value={model.slug}>{model.displayName} · {model.slug}</option>) : <option value="">Connect ChatGPT to discover models</option>}</select></label>
      <label className="field-label">Effort AI<select aria-describedby="ai-effort-help"
        value={effortAvailable ? aiState.selectedEffort : 'auto'} disabled={!effortAvailable || Boolean(busy) || aiState.aiBusy}
        onChange={event => {
          const effort = AI_EFFORTS.find(value => value === event.currentTarget.value);
          if (effort) void props.onAI(() => window.vms.aiSetEffort(effort));
        }}>{AI_EFFORTS.map(effort => <option key={effort} value={effort}>{AI_EFFORT_LABELS[effort]}</option>)}</select>
      </label>
      <p className="small-note" id="ai-effort-help">{effortAvailable ? 'Effort lebih tinggi memberi AI lebih banyak waktu untuk menyusun draft.' : aiState?.selectedModel ? 'Studio memakai effort bawaan model ini.' : 'Hubungkan ChatGPT dan pilih model untuk mengatur effort.'}</p>
      <div className="detail-row ai-request-count" role="status"><span>Jatah AI proyek</span><b>{aiUsageCount} dari {MAX_AI_REQUESTS_PER_PROJECT} terpakai</b></div>
      <p className="small-note">{atRequestLimit ? 'Jatah AI proyek sudah habis. Draft lokal tetap tersedia.' : 'Draft ChatGPT, tes koneksi, dan percobaan ulang dihitung. Kuota akun ChatGPT dihitung terpisah.'}</p>
    </div>
    {aiState?.aiBusy && <div className="ai-progress"><span className="spinner" /> <div><strong>{aiState.aiActivity || 'Waiting for ChatGPT'}</strong><small>Structured metadata only · response validated locally</small></div><button className="button subtle compact" onClick={props.onCancel}>Cancel</button></div>}
    {aiState?.modelCatalog.status === 'error' && <div className="ai-model-error">{aiState.modelCatalog.message ?? 'Model list is temporarily unavailable.'}</div>}
    <div className="data-consent"><label className="check-row"><input type="checkbox" checked={aiConsent} onChange={e => setAIConsent(e.target.checked)}/><span>I agree to send only structured event ranges, tags, beat candidates and render settings to ChatGPT. Video, audio, screenshots, filenames and file paths stay local.</span></label></div>
    <div className="director-actions"><button className="button rule-button" onClick={props.onGenerateRule} disabled={!project.events.length || Boolean(busy)}>◈ Generate rule-only draft <small>OFFLINE · LOCAL</small></button><button className="button primary full" onClick={props.onGenerateAI} disabled={!aiCanPlan || !aiConsent || !project.events.length || Boolean(busy) || atRequestLimit}>✦ Generate with ChatGPT</button><button className="button subtle full" onClick={props.onTest} disabled={!aiCanPlan || Boolean(busy) || atRequestLimit}>Test subscription connection</button><small className="disclosure">Requests start only when you click. Review and accept drafts before they change the timeline.</small></div>
    {proposal && <div className="proposal-card"><div className="proposal-head"><span className={`proposal-source ${proposal.source}`}>{proposal.source === 'chatgpt' ? 'CHATGPT DRAFT' : 'RULE-ONLY DRAFT'}</span><span>{Math.round(proposal.confidence * 100)}% confidence</span></div><h3>{proposal.selected_event_ids.length} impacts · {proposal.clip_plans.length} sequences · {proposal.beat_targets.length} beat targets</h3><div className="proposal-list">{[...proposal.clip_plans].sort((a, b) => a.slot - b.slot).slice(0, 7).map((plan, index) => <div key={plan.event_id}><span>{String(index + 1).padStart(2, '0')}</span><strong>{(plan.included_event_ids?.length ?? 1) > 1 ? `Multikill · ${plan.included_event_ids!.length} impacts` : project.events.find(event => event.event_id === plan.event_id)?.tags.join(' · ') || 'Highlight manual'}</strong><small>{((plan.out_us - plan.in_us) / 1_000_000).toFixed(1)}s</small></div>)}</div><ul>{proposal.rationale.slice(0, 3).map((line, index) => <li key={index}>{line}</li>)}{proposal.warnings.map((line, index) => <li className="warning-copy" key={`w${index}`}>{line}</li>)}</ul><div className="proposal-buttons"><button className="button subtle compact" onClick={props.onReject}>Reject</button><button className="button primary compact" onClick={props.onAccept}>Accept draft</button></div></div>}
    <div className="director-footnote"><span className="shield">◈</span><p>Metadata-only planning. No automatic background requests. Local rules remain available if ChatGPT is offline or its usage allowance is unavailable.</p></div>
  </div>;
}

function getError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
