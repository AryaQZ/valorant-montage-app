import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatGPTConnectionCard } from '@siwc/react';
import '@siwc/react/styles.css';
import type { AIState, KillCandidate, ReferenceDraft, RenderJob, WorkerState } from '../../shared/bridge.js';
import { applyProposal, createProject, FPS, makeAutomaticEffects, makeClip, makePostKillSpeedRamp, rebuildTimeline,
  toggleReverseImpactReplay, type DirectorProposal,
  type Effect, type HighlightEvent, type MediaSource, type Project } from '../../shared/project.js';
import { buildRuleProposal } from '../../shared/director.js';

type Notice = { kind: 'error' | 'success' | 'info'; text: string };
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

export default function App() {
  const [project, setProject] = useState<Project>(() => createProject());
  const projectRef = useRef(project);
  const undoStack = useRef<Project[]>([]);
  const redoStack = useRef<Project[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [saveState, setSaveState] = useState('Belum disimpan');
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [selectedClipId, setSelectedClipId] = useState('');
  const [activePanel, setActivePanel] = useState<'edit' | 'director'>('edit');
  const [workerState, setWorkerState] = useState<WorkerState | null>(null);
  const [aiState, setAIState] = useState<AIState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState('');
  const [eventIn, setEventIn] = useState('0');
  const [eventImpact, setEventImpact] = useState('2');
  const [eventOut, setEventOut] = useState('5');
  const [eventOwner, setEventOwner] = useState<'player' | 'unknown'>('player');
  const [eventTags, setEventTags] = useState<string[]>(['headshot']);
  const [proposal, setProposal] = useState<DirectorProposal | null>(null);
  const [reference, setReference] = useState<ReferenceDraft | null>(null);
  const [referenceError, setReferenceError] = useState('');
  const [reviewShot, setReviewShot] = useState<{ sourceId: string; timeUs: number } | null>(null);
  const [aiConsent, setAIConsent] = useState(false);
  const [aiUsageCount, setAIUsageCount] = useState(0);
  const [renderJobId, setRenderJobId] = useState('');
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null);
  const [previewRenderUrl, setPreviewRenderUrl] = useState('');
  const [renderMode, setRenderMode] = useState<'master' | 'rough_preview' | 'effects_preview'>('master');
  const [showExportReview, setShowExportReview] = useState(false);
  const [musicRights, setMusicRights] = useState(false);
  const [ownerRights, setOwnerRights] = useState(false);
  const [draggingClip, setDraggingClip] = useState('');
  const [killCandidates, setKillCandidates] = useState<KillCandidate[]>([]);

  useEffect(() => { projectRef.current = project; }, [project]);

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

  useEffect(() => {
    let active = true;
    const unsubscribe = window.vms.onAIState(setAIState);
    Promise.all([window.vms.getWorkerState(), window.vms.aiGetState()]).then(([worker, ai]) => {
      if (!active) return;
      setWorkerState(worker);
      setAIState(ai);
      setNotice({ kind: 'success', text: 'Studio siap. Rekaman tetap diproses lokal.' });
    }).catch(error => active && setNotice({ kind: 'error', text: getError(error) }));
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!project.sources.some(item => item.media_id === selectedSourceId)) setSelectedSourceId(project.sources[0]?.media_id ?? '');
  }, [project.sources, selectedSourceId]);

  useEffect(() => {
    if (!project.timeline.some(item => item.clip_id === selectedClipId)) setSelectedClipId(project.timeline[0]?.clip_id ?? '');
  }, [project.timeline, selectedClipId]);

  useEffect(() => { void window.vms.aiGetUsage(project.project_id).then(setAIUsageCount).catch(() => setAIUsageCount(0)); }, [project.project_id]);

  useEffect(() => {
    if (!project.sources.length) return;
    setSaveState('Menyimpan…');
    const timer = window.setTimeout(() => {
      window.vms.autosaveProject(project).then(() => setSaveState('Tersimpan otomatis')).catch(() => setSaveState('Autosave tertunda'));
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
            if (job.status === 'failed' || job.status === 'cancelled') setPreviewRenderUrl('');
          setNotice({ kind: job.status === 'complete' ? 'success' : job.status === 'failed' ? 'error' : 'info',
            text: job.status === 'complete'
              ? renderMode === 'master' ? 'Render selesai dan lulus pemeriksaan.' : 'Preview montage selesai; FFprobe dan QC memeriksa file hasil.'
              : job.status === 'needs_review' ? 'Render selesai; laporan QA meminta pemeriksaan.' : job.error || job.message });
          return;
        }
        timer = window.setTimeout(poll, 900);
      } catch (error) {
        if (!cancelled) { setBusy(''); setRenderJobId(''); setNotice({ kind: 'error', text: getError(error) }); }
      }
    };
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [renderJobId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
      else if (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)) { event.preventDefault(); redo(); }
      else if (event.key.toLowerCase() === 's') { event.preventDefault(); void saveProject(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selectedSource = project.sources.find(item => item.media_id === selectedSourceId) ?? null;
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
  const timelineSeconds = project.timeline.reduce((sum, clip) => sum + clip.duration_frames / selectedFPS, 0);
  const ownerUnknownCount = project.timeline.filter(clip => project.events.find(event => event.event_id === clip.event_id)?.owner === 'unknown').length;
  const previewAllowed = (!project.music || musicRights) && (ownerUnknownCount === 0 || ownerRights);
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
    projectRef.current = previous; setProject(previous); setNotice({ kind: 'info', text: 'Perubahan terakhir dibatalkan.' });
  }

  function redo() {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(structuredClone(projectRef.current));
    projectRef.current = next; setProject(next); setNotice({ kind: 'info', text: 'Perubahan diterapkan kembali.' });
  }

  async function importRecordings() {
    runTask('Mengimpor rekaman', async () => {
      const media = await window.vms.importRecordings();
      if (!media.length) return;
      commit(draft => { for (const item of media) if (!draft.sources.some(source => source.media_id === item.media_id)) draft.sources.push(item); });
      setSelectedSourceId(media[0].media_id);
      setNotice({ kind: 'success', text: `${media.length} rekaman masuk ke Media Library.` });
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
    if (![inUs, impactUs, outUs].every(Number.isSafeInteger) || inUs < 0 || inUs >= impactUs || impactUs > outUs || outUs > selectedSource.duration_us) {
      return setNotice({ kind: 'error', text: 'Range harus memenuhi 0 ≤ masuk < impact ≤ keluar ≤ durasi rekaman.' });
    }
    const event: HighlightEvent = {
      event_id: uuid(), source_media_id: selectedSource.media_id, source_time_us: impactUs,
      source_frame: Math.round((impactUs / 1_000_000) * fpsOf(selectedSource)), in_us: inUs, out_us: outUs,
      evidence: [{ type: 'manual_annotation', created_utc: new Date().toISOString() }], owner: eventOwner,
      confidence: 1, tags: eventTags, cluster_id: null, rating: null, is_user_override: true,
    };
    commit(draft => { draft.events.push(event); });
    setNotice({ kind: 'success', text: 'Highlight manual ditambahkan. Tidak ada kill yang dideteksi otomatis.' });
  }

  async function detectKillCandidates() {
    if (!selectedSource) return setNotice({ kind: 'error', text: 'Pilih rekaman sebelum mencari kandidat kill.' });
    setBusy('Menganalisis kandidat kill secara lokal'); setNotice(null);
    try {
      const result = await window.vms.detectKills(selectedSource);
      setKillCandidates(result.candidates);
      setNotice({ kind: 'success', text: result.candidates.length
        ? `${result.candidates.length} kandidat upstream siap ditinjau. Tidak ada yang ditambahkan otomatis ke timeline.`
        : 'Upstream tidak menemukan kandidat kill pada rekaman ini.' });
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
    finally { setBusy(''); }
  }

  function confirmKillCandidate(candidate: KillCandidate) {
    const event: HighlightEvent = {
      event_id: uuid(), source_media_id: candidate.source_media_id, source_time_us: candidate.source_time_us,
      source_frame: candidate.source_frame, in_us: candidate.in_us, out_us: candidate.out_us,
      evidence: [...candidate.evidence, { type: 'user_reviewed_upstream_candidate', created_utc: new Date().toISOString() }],
      owner: 'player', confidence: candidate.confidence, tags: [...candidate.suggested_tags], cluster_id: null, rating: null, is_user_override: true,
    };
    commit(draft => { if (!draft.events.some(item => item.source_media_id === event.source_media_id && item.source_time_us === event.source_time_us)) draft.events.push(event); });
    setKillCandidates(items => items.filter(item => item.candidate_id !== candidate.candidate_id));
    setNotice({ kind: 'success', text: 'Kandidat ditinjau dan ditambahkan sebagai anotasi. Periksa gambar kill sebelum menyusun cut.' });
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
    commit(draft => { const clip = makeClip(draft, event); clipId = clip.clip_id; draft.timeline.push(clip); rebuildTimeline(draft); });
    setSelectedClipId(clipId);
    setNotice({ kind: 'success', text: 'Highlight ditambahkan ke timeline.' });
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
    if (!window.confirm('Confirm the reviewed shots are yours or authorized. This replaces the current clip sequence.')) return;
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
      setNotice({ kind: 'success', text: `Draft ChatGPT tervalidasi secara lokal. ${result.usageCount}/5 request project telah dipakai.` });
    } catch (error) {
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
      setNotice({ kind: 'success', text: `Inference berhasil: “${result.text.slice(0, 120)}” · ${result.usageCount}/5 request project.` });
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
    finally { setBusy(''); }
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
      if (field === 'in_us') clip.in_us = Math.max(selectedEvent.in_us, Math.min(value, selectedEvent.source_time_us));
      else clip.out_us = Math.min(selectedEvent.out_us, Math.max(value, selectedEvent.source_time_us));
      clip.time_remap = [{ output_start_frame: 0, output_end_frame: 0, source_start_us: clip.in_us,
        source_end_us: clip.out_us, speed_num: 1, speed_den: 1, direction: 'forward' }];
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
    if (project.sources.length && !window.confirm('Mulai project baru? Project sekarang tetap tersimpan di autosave lokal.')) return;
    const next = createProject();
    projectRef.current = next; setProject(next); setProjectPath(null); setProposal(null); setRenderJob(null); setPreviewRenderUrl('');
    undoStack.current = []; redoStack.current = [];
    setSelectedSourceId(''); setSelectedClipId(''); setNotice({ kind: 'success', text: 'Project baru dibuat.' });
  }

  async function saveProject() {
    try {
      const result = await window.vms.saveProject(project, projectPath);
      if (result) { setProjectPath(result.path); setSaveState('Project tersimpan'); setNotice({ kind: 'success', text: 'Project JSON tersimpan.' }); }
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
  }

  async function openProject() {
    try {
      const loaded = await window.vms.loadProject();
      if (!loaded) return;
      projectRef.current = loaded.project; setProject(loaded.project); setProjectPath(loaded.path); setProposal(null);
      setPreviewRenderUrl('');
      undoStack.current = []; redoStack.current = [];
      setSelectedSourceId(loaded.project.sources[0]?.media_id ?? ''); setSelectedClipId(loaded.project.timeline[0]?.clip_id ?? '');
      setNotice({ kind: 'success', text: 'Project berhasil dibuka dan divalidasi.' });
    } catch (error) { setNotice({ kind: 'error', text: getError(error) }); }
  }

  async function exportProject() {
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
    setRenderMode(mode);
    setBusy('Preparing preview');
    try {
      setRenderJob(null);
      const result = await window.vms.renderPreview(project, mode, { rights: musicRights, ownership: ownerRights });
      setPreviewRenderUrl(result.preview_url);
      setRenderJobId(result.job_id);
      setBusy('Rendering');
      setRenderJob({ job_id: result.job_id, status: 'queued', progress: 0,
        message: `Membuat ${mode === 'rough_preview' ? 'rough preview 1280×720/30' : 'effects preview 2560×1440/60'}` });
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
  const previewKey = `${previewUrl}:${reviewShot?.timeUs ?? selectedClip?.in_us ?? 0}`;
  const completedRender = renderJob?.result;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark"><span>V</span></div><div><strong>VALORANT <i>///</i> MONTAGE STUDIO</strong><small>LOCAL CREATOR WORKSPACE</small></div></div>
        <div className="project-name"><span className="live-dot" />{project.name}<small>{saveState}</small></div>
        <div className="top-actions">
          <button className="icon-button" title="Undo (Ctrl+Z)" onClick={undo}>↶</button>
          <button className="icon-button" title="Redo (Ctrl+Y)" onClick={redo}>↷</button>
          <button className="button subtle" onClick={newProject}>New</button>
          <button className="button subtle" onClick={() => void openProject()}>Open</button>
          <button className="button subtle" onClick={() => void saveProject()}>Save project</button>
          <button className="button primary" onClick={() => setShowExportReview(true)} disabled={(!project.timeline.length && !project.reference_draft) || Boolean(busy) || Boolean(project.reference_draft && !reference)}>Export montage <span>↗</span></button>
        </div>
      </header>

      <div className="workspace">
        <aside className="library-column">
          <div className="section-head"><div><span className="eyebrow">PROJECT</span><h2>Media library</h2></div><span className="count-pill">{project.sources.length}</span></div>
          <button className="button import-button" onClick={() => void importRecordings()} disabled={Boolean(busy)}><span className="plus">＋</span> Import recordings</button>
          <div className="media-list">
            {project.sources.length ? project.sources.map(source => <button className={`media-card ${selectedSourceId === source.media_id ? 'selected' : ''}`} key={source.media_id} onClick={() => { setReviewShot(null); setSelectedSourceId(source.media_id); }}>
              <div className="media-thumb">{source.thumbnail_url ? <img src={source.thumbnail_url} /> : <span className="thumb-cross">V</span>}<span className="play-mark">▶</span></div>
              <div className="media-info"><strong title={source.filename}>{source.filename}</strong><small>{timecode(source.duration_us)} · {source.video.width}×{source.video.height}</small><small>{source.video.codec?.toUpperCase()} · {source.video.timestamp_behavior?.variable_frame_rate ? 'VFR' : 'CFR / unknown'}</small></div>
              <span className="media-size">{fmtBytes(source.size_bytes)}</span>
            </button>) : <div className="empty-card"><div className="empty-symbol">▧</div><strong>Belum ada rekaman</strong><span>Impor video gameplay untuk mulai memilih highlight.</span></div>}
          </div>

          <div className="section-head highlight-heading"><div><span className="eyebrow">ANNOTATION</span><h2>Highlight review</h2></div><button className="button subtle compact" onClick={() => void detectKillCandidates()} disabled={!selectedSource || Boolean(busy) || !workerState?.upstream?.kill_detection}>Find kills</button><span className="count-pill">{project.events.length}</span></div>
          {selectedSource ? <div className="annotation-card">
            <div className="annotation-source"><span className="record-dot" />{selectedSource.filename}</div>
            <div className="time-inputs">
              <label>IN <input type="number" step="0.1" min="0" max={seconds(selectedSource.duration_us)} value={eventIn} onChange={e => setEventIn(e.target.value)} /></label>
              <label>IMPACT <input type="number" step="0.1" min="0" max={seconds(selectedSource.duration_us)} value={eventImpact} onChange={e => setEventImpact(e.target.value)} /></label>
              <label>OUT <input type="number" step="0.1" min="0" max={seconds(selectedSource.duration_us)} value={eventOut} onChange={e => setEventOut(e.target.value)} /></label>
            </div>
            <div className="tag-row">{['headshot', 'multikill', 'clutch', 'round_win'].map(tag => <button key={tag} className={`tag ${eventTags.includes(tag) ? 'active' : ''}`} onClick={() => setEventTags(tags => tags.includes(tag) ? tags.filter(item => item !== tag) : [...tags, tag])}>{tag.replace('_', ' ')}</button>)}</div>
            <div className="annotation-bottom"><select value={eventOwner} onChange={e => setEventOwner(e.target.value as 'player' | 'unknown')}><option value="player">Player-owned</option><option value="unknown">Owner unknown</option></select><button className="button compact primary" onClick={addHighlight}>＋ Add highlight</button></div>
          </div> : <div className="empty-inline">Pilih rekaman untuk membuat anotasi manual.</div>}
          <div className="event-list">
            {project.events.map((event, index) => {
              const source = project.sources.find(item => item.media_id === event.source_media_id);
              const onTimeline = project.timeline.some(clip => clip.event_id === event.event_id);
              return <div className="event-card" key={event.event_id}>
                <span className="event-index">{String(index + 1).padStart(2, '0')}</span><div className="event-copy"><strong>{event.tags.length ? event.tags.map(tag => tag.replace('_', ' ')).join(' · ') : 'Manual highlight'}</strong><small>{source?.filename ?? 'Missing source'} · {timecode(event.source_time_us)}</small></div>
                {onTimeline ? <span className="on-timeline">IN CUT</span> : <button className="add-small" title="Add to timeline" onClick={() => addClip(event)}>＋</button>}
              </div>;
            })}
          </div>
          {killCandidates.length > 0 && <div className="candidate-panel"><div className="candidate-title"><strong>UPSTREAM CANDIDATES</strong><small>Review the shot frame and feed before adding.</small></div>{killCandidates.map(candidate => <div className="candidate-card" key={candidate.candidate_id}><div><strong>{candidate.confidence_label.toUpperCase()} · K {candidate.source_frame}</strong><small>{timecode(candidate.source_time_us)} · {candidate.method} · feed {candidate.feed_frame ?? '—'}</small><small>{candidate.requires_ownership_review ? 'Replay candidate · verify the killer in the feed before adding.' : candidate.verified_by_upstream ? 'Shot verified · review the feed.' : 'Unverified candidate: check ownership and the exact impact frame.'}</small>{candidate.suggested_tags.length > 0 && <small>Upstream context: {candidate.suggested_tags.map(tag => tag.replace('_', ' ')).join(' · ')}</small>}</div><button className="button subtle compact" onClick={() => { setPreviewRenderUrl(''); setReviewShot({ sourceId: candidate.source_media_id, timeUs: candidate.source_time_us }); }}>Preview shot</button><button className="add-small" title="Confirm after reviewing candidate" onClick={() => confirmKillCandidate(candidate)}>Review +</button></div>)}</div>}
          {workerState?.upstream && !workerState.upstream.kill_detection && <div className="empty-inline">Upstream kill detector is unavailable. Manual annotations remain the baseline.</div>}
        </aside>

        <main className="edit-column">
          <div className="editor-toolbar">
            <div className="tab-strip"><button className="active">EDITOR <span>01</span></button><button disabled>COLOR <span>02</span></button><button disabled>AUDIO <span>03</span></button></div>
            <div className="toolbar-right"><span className={`status-chip ${workerStatusClass}`}><i />{workerStatusLabel}</span><span className="output-chip">{project.reference_draft ? '1080P60 UPSTREAM' : project.settings.output_profile === 'master_144' ? '144 FPS MASTER' : '60 FPS YOUTUBE'}</span></div>
          </div>

          <section className="preview-stage">
            <div className="stage-topline"><span>{previewRenderUrl ? renderMode === 'rough_preview' ? 'ROUGH CUT · EFFECTS OFF · 720P30' : 'EFFECTS PREVIEW · VFX ON · 1440P60' : 'SOURCE CLIP REVIEW · EFFECTS OFF'} <b>·</b> {previewRenderUrl ? project.name : previewSource?.filename ?? 'NO SOURCE SELECTED'}</span><span>{previewRenderUrl ? `0:00 — ${timecode(timelineSeconds * 1_000_000)}` : `${timecode(selectedClip?.in_us ?? 0)} — ${timecode(selectedClip?.out_us ?? previewSource?.duration_us ?? 0)}`}</span></div>
            <div className="video-frame">
              {previewUrl ? <video key={previewKey} ref={videoRef} src={previewUrl} controls playsInline onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = previewRenderUrl ? 0 : (reviewShot ? Math.max(0, reviewShot.timeUs - 400_000) : selectedClip?.in_us ?? 0) / 1_000_000; }} onTimeUpdate={() => { if (!videoRef.current) return; if (previewRenderUrl && videoRef.current.currentTime >= timelineSeconds) videoRef.current.pause(); else if (!previewRenderUrl && !reviewShot && selectedClip && videoRef.current.currentTime >= selectedClip.out_us / 1_000_000) videoRef.current.pause(); }} /> : <div className="preview-placeholder"><div className="crosshair">＋</div><strong>{previewSource ? 'Preview proxy unavailable' : 'Your cut starts here'}</strong><span>{previewSource ? 'Periksa FFmpeg dan impor ulang media untuk membuat proxy.' : 'Pilih rekaman dan tambahkan highlight ke timeline.'}</span><div className="placeholder-meta"><span>2560 × 1440</span><span>·</span><span>{selectedFPS} FPS</span><span>·</span><span>SMOOTH / CLEAN</span></div></div>}
              <div className="safe-frame"><span>REC ●</span></div>
            </div>
            <div className="monitor-controls"><div className="play-controls">{!previewRenderUrl && <button title="Previous clip" onClick={() => { const i = project.timeline.findIndex(item => item.clip_id === selectedClipId); setSelectedClipId(project.timeline[Math.max(0, i - 1)]?.clip_id ?? ''); }}>|◀</button>}<button className="play-button" onClick={() => { const video = videoRef.current; if (!video) return; if (video.paused) void video.play(); else video.pause(); }}>▶</button>{!previewRenderUrl && <button title="Next clip" onClick={() => { const i = project.timeline.findIndex(item => item.clip_id === selectedClipId); setSelectedClipId(project.timeline[Math.min(project.timeline.length - 1, i + 1)]?.clip_id ?? ''); }}>▶|</button>}{previewRenderUrl && <button title="Return to source clip review" onClick={() => setPreviewRenderUrl('')}>SOURCE</button>}</div><span className="monitor-time">{previewRenderUrl ? '00:00.00' : selectedClip ? timecode(selectedClip.in_us) : '00:00.00'} <i>/</i> {previewRenderUrl ? timecode(timelineSeconds * 1_000_000) : selectedClip ? timecode(selectedClip.out_us) : '00:00.00'}</span><span className="monitor-quality">FIT&nbsp;&nbsp; 100%</span></div>
          </section>

          <section className="timeline-section">
            <div className="timeline-header"><div><span className="eyebrow">SEQUENCE</span><h2>Montage timeline <small>{project.timeline.length} clips · {timelineSeconds.toFixed(1)}s</small></h2></div><div className="timeline-actions"><button className="button subtle compact" onClick={() => void renderPreview('rough_preview')} disabled={!project.timeline.length || Boolean(busy) || !previewAllowed || Boolean(project.reference_draft)}>Quick rough · 720p30</button><button className="button subtle compact" onClick={() => void renderPreview('effects_preview')} disabled={!project.timeline.length || Boolean(busy) || !previewAllowed || Boolean(project.reference_draft)}>Effects preview · 1440p60</button><button className="button subtle compact" onClick={() => void generateReferenceDraft()} disabled={!project.sources.length || !project.music || Boolean(busy) || !workerState?.upstream?.rife_model_available} title="Import recordings and music. Requires the upstream runtime and RIFE.">Generate draft</button><button className="button compact primary" onClick={() => setActivePanel('director')}>Creative Director <span>✦</span></button></div></div>
            <div className="ruler"><span>00:00</span><span>00:10</span><span>00:20</span><span>00:30</span><span>{timecode(timelineSeconds * 1_000_000)}</span></div>
            <div className="track-row"><div className="track-label"><b>V1</b><span>GAMEPLAY</span></div><div className="track-content">
              {project.timeline.length ? project.timeline.map((clip, index) => {
                const event = project.events.find(item => item.event_id === clip.event_id);
                const source = project.sources.find(item => item.media_id === clip.source_media_id);
                const impactCount = clip.included_event_ids?.length ?? 1;
                const label = impactCount > 1 ? `MULTIKILL · ${impactCount} IMPACTS`
                  : event?.tags[0]?.replace('_', ' ') ?? `Highlight ${index + 1}`;
                return <div key={clip.clip_id} className={`timeline-clip ${clip.clip_id === selectedClipId ? 'selected' : ''}`} style={{ flexGrow: Math.max(0.6, clip.duration_frames / selectedFPS), flexBasis: 104 }} draggable onDragStart={() => setDraggingClip(clip.clip_id)} onDragEnd={() => setDraggingClip('')} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); reorderClip(draggingClip, clip.clip_id); }} onClick={() => { setReviewShot(null); setSelectedClipId(clip.clip_id); }}>
                  <span className="clip-number">{String(index + 1).padStart(2, '0')}</span><span className="clip-icon">◢</span><div><strong>{label}</strong><small>{source?.filename ?? 'Source missing'}</small></div><span className="clip-duration">{(clip.duration_frames / selectedFPS).toFixed(1)}s</span>
                </div>;
              }) : <div className="track-empty">Tambah highlight dari library atau buat draft untuk mengisi timeline.</div>}
              <div className="playhead" />
            </div></div>
            <div className="audio-track-row"><div className="track-label"><b>A1</b><span>MUSIC</span></div><div className="audio-track-content">{project.music ? <div className="audio-lane"><div className="audio-lane-wave">{(project.music.waveform ?? []).map((height, index) => <i key={index} style={{ height: `${Math.max(8, height * 88)}%` }} />)}</div>{project.music.beat_grid.filter(marker => marker.time_us >= project.music!.offset_us && marker.time_us - project.music!.offset_us < timelineSeconds * 1_000_000).map(marker => <b key={marker.marker_id} style={{ left: `${(marker.time_us - project.music!.offset_us) / Math.max(1, timelineSeconds * 1_000_000) * 100}%` }} />)}<span>{project.music.bpm_estimate ?? '—'} BPM</span></div> : <div className="audio-track-empty">Import a licensed music track to view waveform and beat candidates.</div>}</div></div>
            {selectedClip && selectedEvent && <div className="trim-row"><div className="track-label"><b>TRIM</b><span>SELECTED</span></div><div className="trim-controls"><label>IN <input type="number" step="0.01" min={seconds(selectedEvent.in_us)} max={seconds(earliestIncludedImpact)} value={seconds(selectedClip.in_us)} onChange={e => updateClip('in_us', Math.round(Number(e.target.value) * 1_000_000))} />s</label><span>→</span><label>OUT <input type="number" step="0.01" min={seconds(latestIncludedImpact)} max={seconds(selectedEvent.out_us)} value={seconds(selectedClip.out_us)} onChange={e => updateClip('out_us', Math.round(Number(e.target.value) * 1_000_000))} />s</label><span className="trim-hint">Semua impact sequence tetap berada dalam trim</span><button className="remove-clip" title="Remove selected clip" onClick={() => { commit(draft => { draft.timeline = draft.timeline.filter(item => item.clip_id !== selectedClip.clip_id); rebuildTimeline(draft); }); setNotice({ kind: 'info', text: 'Clip dilepas dari timeline; anotasi sumber tetap ada.' }); }}>Remove clip ×</button></div></div>}
          </section>
        </main>

        <aside className="inspector-column">
          <div className="inspector-tabs"><button className={activePanel === 'edit' ? 'active' : ''} onClick={() => setActivePanel('edit')}>INSPECTOR</button><button className={activePanel === 'director' ? 'active' : ''} onClick={() => setActivePanel('director')}>DIRECTOR <span>✦</span></button></div>
          {project.reference_draft && <div className="inspector-scroll reference-draft">
            <h2>Upstream draft · 1080p60</h2>
            {referenceError && <p role="alert">{referenceError}</p>}
            {reference && <>
              <p>{reference.takes.length} takes · {(reference.frames / reference.fps).toFixed(2)}s · song from {timecode(reference.music_offset_us)}</p>
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
              }}>Final kill setup · {timecode(reference.final_action.action_frame * 1e6 / reference.fps)}</button>}
              {reference.ending_confirmation && <button className="button subtle compact" onClick={() => {
                const ace = reference.ending_confirmation!;
                setPreviewRenderUrl('');
                setReviewShot({ sourceId: reference.source_ids[ace.source_alias], timeUs: ace.source_time_us });
              }}>ACE · {timecode(reference.ending_confirmation.output_frame * 1e6 / reference.fps)}</button>}
              {reference.planning_notices?.map(notice => <p key={notice}>{notice}</p>)}
              {reference.auto_selected && <p>Automatically selected shots. Review the sources before confirming ownership and export.</p>}
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
                    Setup {timecode(impact.setup_frame * 1e6 / reference.fps)} · Impact {timecode(impact.shot_frame * 1e6 / reference.fps)} · Konfirmasi {timecode(impact.confirmation_frame * 1e6 / reference.fps)}
                  </small>)}
              </li>)}</ol>
            </>}
            <p>Change highlight selection or order in the editor, then generate a new upstream draft. Upstream plans its own speed and effects.</p>
            <button className="button subtle" disabled={Boolean(busy) || !reference?.selection?.length} onClick={editReferenceSelection}>Edit highlight selection</button>
            <button className="button subtle" disabled={Boolean(busy)} onClick={() => commit(draft => { delete draft.reference_draft; })}>Clear upstream draft</button>
          </div>}
          {activePanel === 'edit' ? <div className="inspector-scroll">
            <div className="inspector-heading"><span className="eyebrow">OUTPUT PROFILE</span><h2>Project settings</h2></div>
            <div className="field-label">
              Referensi gaya
              {project.reference_video && <small>{project.reference_video.filename}</small>}
              <button className="button subtle compact" onClick={() => void selectStyleReference()} disabled={Boolean(busy)}>
                {project.reference_video ? 'Ganti video referensi' : 'Pilih video referensi'}
              </button>
              {project.reference_video && <button className="button subtle compact" disabled={Boolean(busy)}
                onClick={() => commit(draft => { delete draft.reference_video; delete draft.reference_draft; })}>
                Lepas referensi
              </button>}
            </div>
            <label className="field-label">Export preset<select disabled={Boolean(project.reference_draft)} value={project.settings.output_profile} onChange={e => commit(draft => { draft.settings.output_profile = e.target.value as Project['settings']['output_profile']; rebuildTimeline(draft); })}><option value="master_144">Master · 144 FPS</option><option value="youtube_60">YouTube · 60 FPS</option></select></label>
            <div className="resolution-box"><div><strong>2560 × 1440</strong><span>QHD · 16:9 · Progressive</span></div><b>{selectedFPS}<small> FPS</small></b></div>
            <div className="slider-control"><div><label>Beat sync priority</label><b>{Math.round(project.settings.beat_sync_priority * 100)}%</b></div><input type="range" min="0" max="1" step="0.01" value={project.settings.beat_sync_priority} onChange={e => commit(draft => { draft.settings.beat_sync_priority = Number(e.target.value); })}/><small>Soft preference; action timing stays intact.</small></div>
            <div className="slider-control"><div><label>Effects intensity</label><b>{Math.round(project.settings.effects_intensity * 100)}%</b></div><input type="range" min="0" max="1" step="0.01" value={project.settings.effects_intensity} onChange={e => commit(draft => { draft.settings.effects_intensity = Number(e.target.value); for (const clip of draft.timeline) { const ids = clip.included_event_ids ?? [clip.event_id]; const grouped = ids.map(id => draft.events.find(item => item.event_id === id)).filter((item): item is HighlightEvent => Boolean(item)); const event = grouped.find(item => item.event_id === clip.event_id); if (event) { const tags = [...new Set(grouped.flatMap(item => item.tags))]; if (grouped.length > 1 && !tags.includes('multikill')) tags.push('multikill'); const effective = { ...event, confidence: Math.max(...grouped.map(item => item.confidence)), tags }; clip.effects = makeAutomaticEffects(effective, Number(e.target.value)); } else clip.effects = []; } })}/><small>Context chooses zoom, flash, shake and blur by reviewed tags.</small></div>
            <div className="slider-control"><div><label>Gameplay audio</label><b>{Math.round(project.settings.gameplay_gain * 100)}%</b></div><input type="range" min="0" max="1.5" step="0.01" value={project.settings.gameplay_gain} onChange={e => commit(draft => { draft.settings.gameplay_gain = Number(e.target.value); for (const clip of draft.timeline) clip.audio_gain = Number(e.target.value); })}/></div>
            <div className="slider-control"><div><label>Music level</label><b>{Math.round(project.settings.music_gain * 100)}%</b></div><input type="range" min="0" max="0.75" step="0.01" value={project.settings.music_gain} onChange={e => commit(draft => { draft.settings.music_gain = Number(e.target.value); })}/></div>

            <div className="music-panel"><div className="music-title"><div className="music-art">♫</div><div><span className="eyebrow">SOUNDTRACK</span><strong>{project.music?.filename ?? 'No music selected'}</strong><small>{project.music ? `${project.music.bpm_estimate ?? '—'} BPM · ${project.music.beat_grid.length} beat candidates` : 'Import audio you are licensed to use'}</small></div><button className="plus-button" onClick={() => void importMusic()} disabled={Boolean(busy)} title="Import music">＋</button></div>
              {project.music && <><div className="waveform" aria-label="Music waveform">{(project.music.waveform?.length ? project.music.waveform : project.music.beat_grid.slice(0, 90).map(marker => marker.confidence)).map((height, i) => <i key={i} style={{ height: `${Math.max(8, height * 100)}%` }} />)}{project.music.beat_grid.slice(0, 18).map(marker => <b key={marker.marker_id} style={{ left: `${Math.min(99, marker.time_us / Math.max(1, project.music!.duration_us) * 100)}%` }} />)}</div><label className="field-label offset-field">Music offset <span className="suffix-input"><input type="number" step="0.01" min="0" value={seconds(project.music.offset_us)} onChange={e => commit(draft => { if (draft.music) draft.music.offset_us = Math.max(0, Math.round(Number(e.target.value) * 1_000_000)); })}/>sec</span></label><label className="check-row"><input type="checkbox" checked={musicRights} onChange={e => setMusicRights(e.target.checked)}/><span>I have rights to use this audio in my montage.</span></label></>}
            </div>

            {selectedClip && <div className="clip-inspector">
              <div className="inspector-heading"><span className="eyebrow">SELECTED CLIP</span><h2>{selectedEvent?.tags[0]?.replace('_', ' ') ?? 'Highlight'}</h2></div>
              <div className="detail-row"><span>Source</span><b>{project.sources.find(item => item.media_id === selectedClip.source_media_id)?.filename}</b></div>
              <div className="detail-row"><span>Duration</span><b>{(selectedClip.duration_frames / selectedFPS).toFixed(2)} sec · {selectedClip.time_remap.length} map sections</b></div>
              {selectedEvent && <div className="field-label">
                <button className="button subtle compact" onClick={() => { setPreviewRenderUrl(''); setReviewShot({ sourceId: selectedEvent.source_media_id, timeUs: selectedEvent.source_time_us }); }}>Review final action and ACE</button>
                <button className="button subtle compact" onClick={() => markEndingFrame('action')}>Mark final action start</button>
                <button className="button subtle compact" onClick={() => markEndingFrame('ace')}>Mark visible ACE</button>
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
                {([['impact_zoom', 'Impact zoom'], ['impact_flash', 'Impact flash'], ['screen_shake', 'Screen shake'], ['motion_blur', 'Motion blur']] as const).map(([type, label]) => {
                  const effect = selectedClip.effects.find(item => item.type === type);
                  return <label className="check-row effect-toggle" key={type}><input type="checkbox" checked={effect?.enabled ?? false} onChange={event => setClipEffect(type, event.target.checked)}/><span>{label}</span><small>{effect?.enabled ? 'ON' : 'OFF'}</small></label>;
                })}
                {zoomEffect?.enabled && <div className="slider-control keyframe-control"><div><label>Impact zoom peak keyframe</label><b>{zoomEffect.max_zoom.toFixed(3)}×</b></div><input aria-label="Impact zoom peak keyframe" type="range" min="1" max="1.08" step="0.001" value={zoomEffect.max_zoom} onChange={event => setZoomPeak(Number(event.target.value))}/><small>Editable scale key at impact frame 0; neighboring keys ease in and out.</small></div>}
              </div>
              <button className="button subtle full" onClick={applySpeedRamp}>Apply post-kill speed ramp</button>
              <label className="check-row reverse-toggle"><input type="checkbox" checked={selectedClip.time_remap.some(segment => segment.direction === 'reverse')} onChange={event => setReverseReplay(event.target.checked)}/><span>Reverse slow-motion replay accent</span></label>
              <label className="check-row reverse-toggle"><input type="checkbox" checked={selectedClip.transitions.some(transition => transition.enabled)} onChange={event => setClipTransition(event.target.checked)}/><span>8-frame dip transition at this cut</span></label>
              <small className="small-note">Reverse mode repeats a short post-impact section; no source frames are removed.</small>
              <button className="button subtle full" onClick={() => { const index = project.timeline.findIndex(item => item.clip_id === selectedClip.clip_id); if (index > 0) reorderClip(selectedClip.clip_id, project.timeline[index - 1].clip_id); }}>Move clip earlier ↑</button>
            </div>}

            {ownerUnknownCount > 0 && <label className="check-row ownership-check"><input type="checkbox" checked={ownerRights} onChange={e => setOwnerRights(e.target.checked)}/><span>Confirm that the {ownerUnknownCount} unknown-owner highlight(s) belong to or are authorized by me.</span></label>}
            <div className="worker-status"><span className={`status-chip ${workerStatusClass}`}><i />{!workerState ? 'CHECKING FFMPEG' : capabilitiesReady ? `FFMPEG ${workerState.media.version ?? 'AVAILABLE'}` : 'FFMPEG + FFPROBE NEEDED'}</span><small>{workerDiagnostic}</small><small>Upstream RIFE: {upstreamDiagnostic}</small></div>
          </div> : <DirectorPanel aiState={aiState} aiCanPlan={aiCanPlan} aiConsent={aiConsent} setAIConsent={setAIConsent} modelLabel={modelLabel} aiUsageCount={aiUsageCount} project={project} proposal={proposal} busy={busy} onGenerateRule={generateRuleDraft} onGenerateAI={() => void generateAIProposal()} onAccept={acceptProposal} onReject={rejectProposal} onAI={handleAI} onTest={() => void testAIConnection()} onCancel={() => void cancelAIRequest()} />}
        </aside>
      </div>

      {showExportReview && <div className="modal-backdrop"><section className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title"><div className="modal-kicker"><span className="live-dot" /> EXPORT PREFLIGHT</div><h2 id="export-title">Review before export</h2><p>{project.reference_draft ? 'The upstream draft renders at native 1920×1080, 60 FPS. Upstream gate checks the finished video and audio.' : 'The worker checks source ranges, media paths, audio and output integrity before and after rendering.'}</p>{project.music ? <label className="check-row modal-check"><input type="checkbox" checked={musicRights} onChange={e => setMusicRights(e.target.checked)}/><span>I own or have permission to use “{project.music.filename}” in this montage.</span></label> : <div className="modal-note">No soundtrack is attached; gameplay audio will be used where available.</div>}{(project.reference_draft || ownerUnknownCount > 0) && <label className="check-row modal-check"><input type="checkbox" checked={ownerRights} onChange={e => setOwnerRights(e.target.checked)}/><span>{project.reference_draft ? 'I reviewed the draft highlights and confirm they are mine or authorized for this montage.' : 'I confirm the selected highlights with unknown ownership are mine or authorized.'}</span></label>}<div className="modal-summary"><span>VIDEO</span><b>{project.reference_draft ? '1920 × 1080 · 60 FPS' : `2560 × 1440 · ${selectedFPS} FPS`} · H.264</b><span>QUALITY CHECK</span><b>{project.reference_draft ? 'Upstream gate + peak guard' : 'FFprobe + black/silence scan'}</b></div><div className="modal-actions"><button className="button subtle" onClick={() => setShowExportReview(false)}>Cancel</button><button className="button primary" disabled={Boolean(busy) || (Boolean(project.music) && !musicRights) || ((Boolean(project.reference_draft) || ownerUnknownCount > 0) && !ownerRights)} onClick={() => { setShowExportReview(false); void exportProject(); }}>Choose output and render <span>↗</span></button></div></section></div>}
      {notice && <div className={`toast ${notice.kind}`} role="status"><span>{notice.kind === 'error' ? '!' : notice.kind === 'success' ? '✓' : 'i'}</span><p>{notice.text}</p><button onClick={() => setNotice(null)}>×</button></div>}
      {busy === 'Planning upstream montage' && <div className="render-dock" role="status"><div className="render-copy"><span className="eyebrow">UPSTREAM DRAFT</span><strong>Detecting shots and planning against the selected song…</strong></div></div>}
      {busy === 'Rendering' && renderJob && <div className="render-dock"><div className="render-copy"><span className="eyebrow">{renderMode === 'master' ? 'EXPORTING MASTER' : renderMode === 'rough_preview' ? 'RENDERING ROUGH PREVIEW' : 'RENDERING EFFECTS PREVIEW'}</span><strong>{renderJob.message}</strong></div><div className="progress-track"><i style={{ width: `${Math.round(renderJob.progress * 100)}%` }} /></div><b>{Math.round(renderJob.progress * 100)}%</b><button className="button subtle compact" onClick={() => void cancelRender()}>Cancel</button></div>}
      {completedRender && <div className="qa-dock"><div><span className={`qa-status ${completedRender.qa.status.toLowerCase()}`}>{completedRender.qa.status}</span><strong>{renderMode === 'master' ? 'Export QA' : 'Preview QA'} {completedRender.state === 'needs_review' ? 'needs review' : 'passed'}</strong><small>{completedRender.qa.checks.filter(item => item.status !== 'PASS').length} notes · {completedRender.output_path}</small></div><button className="button subtle compact" onClick={() => void window.vms.revealLocalFile(completedRender.qa_html)}>Open QA report</button><button className="button compact primary" onClick={() => void window.vms.revealLocalFile(completedRender.output_path)}>Open video</button><button className="close-dock" onClick={() => setRenderJob(null)}>×</button></div>}

      <footer className="statusbar"><span><i className="status-led" />LOCAL PROJECT · MEDIA STAYS ON THIS DEVICE</span><span>{project.sources.length} SOURCE{project.sources.length === 1 ? '' : 'S'} <b>·</b> {project.events.length} EVENTS <b>·</b> {project.timeline.length} CLIPS</span><span>SMOOTH / CLEAN <b>·</b> {project.reference_draft ? "60 FPS · 1920 × 1080" : `${selectedFPS} FPS · 2560 × 1440`}</span></footer>
    </div>
  );
}

function DirectorPanel(props: { aiState: AIState | null; aiCanPlan: boolean; aiConsent: boolean; setAIConsent: (value: boolean) => void;
  modelLabel: string; aiUsageCount: number; project: Project; proposal: DirectorProposal | null; busy: string;
  onGenerateRule: () => void; onGenerateAI: () => void; onAccept: () => void; onReject: () => void;
  onAI: (action: () => Promise<AIState>) => Promise<void>; onTest: () => void; onCancel: () => void }) {
  const { aiState, aiCanPlan, aiConsent, setAIConsent, modelLabel, aiUsageCount, project, proposal, busy } = props;
  const count = project.timeline.length ? project.timeline.length : project.events.length;
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
      <div className="detail-row"><span>Project request cap</span><b>{aiUsageCount}/5 requests</b></div>
      <p className="small-note">ChatGPT plan usage follows account eligibility and per-app limits. This app never switches to API-key billing.</p>
    </div>
    {aiState?.aiBusy && <div className="ai-progress"><span className="spinner" /> <div><strong>{aiState.aiActivity || 'Waiting for ChatGPT'}</strong><small>Structured metadata only · response validated locally</small></div><button className="button subtle compact" onClick={props.onCancel}>Cancel</button></div>}
    {aiState?.modelCatalog.status === 'error' && <div className="ai-model-error">{aiState.modelCatalog.message ?? 'Model list is temporarily unavailable.'}</div>}
    <div className="data-consent"><label className="check-row"><input type="checkbox" checked={aiConsent} onChange={e => setAIConsent(e.target.checked)}/><span>I agree to send only structured event ranges, tags, beat candidates and render settings to ChatGPT. Video, audio, screenshots, filenames and file paths stay local.</span></label></div>
    <div className="director-actions"><button className="button rule-button" onClick={props.onGenerateRule} disabled={!project.events.length || Boolean(busy)}>◈ Generate rule-only draft <small>OFFLINE · LOCAL</small></button><button className="button primary full" onClick={props.onGenerateAI} disabled={!aiCanPlan || !aiConsent || !project.events.length || Boolean(busy)}>✦ Generate with ChatGPT</button><button className="button subtle full" onClick={props.onTest} disabled={!aiCanPlan || Boolean(busy)}>Test subscription connection</button><small className="disclosure">Requests start only when you click. Review and accept drafts before they change the timeline.</small></div>
    {proposal && <div className="proposal-card"><div className="proposal-head"><span className={`proposal-source ${proposal.source}`}>{proposal.source === 'chatgpt' ? 'CHATGPT DRAFT' : 'RULE-ONLY DRAFT'}</span><span>{Math.round(proposal.confidence * 100)}% confidence</span></div><h3>{proposal.selected_event_ids.length} impacts · {proposal.clip_plans.length} sequences · {proposal.beat_targets.length} beat targets</h3><div className="proposal-list">{[...proposal.clip_plans].sort((a, b) => a.slot - b.slot).slice(0, 7).map((plan, index) => <div key={plan.event_id}><span>{String(index + 1).padStart(2, '0')}</span><strong>{(plan.included_event_ids?.length ?? 1) > 1 ? `Multikill · ${plan.included_event_ids!.length} impacts` : project.events.find(event => event.event_id === plan.event_id)?.tags.join(' · ') || 'Manual highlight'}</strong><small>{((plan.out_us - plan.in_us) / 1_000_000).toFixed(1)}s</small></div>)}</div><ul>{proposal.rationale.slice(0, 3).map((line, index) => <li key={index}>{line}</li>)}{proposal.warnings.map((line, index) => <li className="warning-copy" key={`w${index}`}>{line}</li>)}</ul><div className="proposal-buttons"><button className="button subtle compact" onClick={props.onReject}>Reject</button><button className="button primary compact" onClick={props.onAccept}>Accept draft</button></div></div>}
    <div className="director-footnote"><span className="shield">◈</span><p>Metadata-only planning. No automatic background requests. Local rules remain available if ChatGPT is offline or its usage allowance is unavailable.</p></div>
  </div>;
}

function getError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
