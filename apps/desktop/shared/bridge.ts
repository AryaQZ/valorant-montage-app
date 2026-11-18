import type { ChatGPTModel, LoginProfile, SessionState } from '@siwc/local';
import type { MediaSource, Project, DirectorProposal, HighlightEvent, MusicTrack } from './project.js';

export interface MediaToolsState {
  available: boolean;
  diagnostic?: string;
  version?: string;
  encoders: string[];
}

export interface WorkerState {
  worker_version: string;
  media: MediaToolsState;
  platform: string;
  upstream?: {
    repository: string;
    commit: string;
    license: string;
    available: boolean;
    kill_detection: boolean;
    measured_music_attacks: boolean;
    rife_model_available: boolean;
    rife_model?: string | null;
  };
}

export interface KillCandidate {
  candidate_id: string;
  source_media_id: string;
  source_time_us: number;
  source_frame: number;
  in_us: number;
  out_us: number;
  confidence: number;
  confidence_label: string;
  method: string;
  feed_frame: number | null;
  verified_by_upstream: boolean;
  suggested_tags: string[];
  requires_user_review: true;
  requires_ownership_review?: boolean;
  evidence: Array<Record<string, unknown>>;
}

export interface AIState {
  session: SessionState;
  profiles: LoginProfile[];
  modelCatalog: { status: 'idle' | 'loading' | 'ready' | 'error'; models: ChatGPTModel[]; message?: string };
  selectedModel: string;
  accountBusy: boolean;
  aiBusy: boolean;
  aiActivity: string;
}

export interface RenderJob {
  job_id: string;
  status: 'queued' | 'running' | 'complete' | 'needs_review' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  error?: string;
  result?: {
    output_path: string;
    project_sidecar: string;
    qa_json: string;
    qa_html: string;
    state: 'complete' | 'needs_review';
    qa: { status: 'PASS' | 'WARN' | 'FAIL'; checks: Array<{ status: string; message: string }> };
  };
}

export interface SaveResult { path: string; }
export interface AIDraftResult { proposal: DirectorProposal; usageCount: number; }
export interface ReferenceDraft {
  id: string;
  frames: number;
  fps: number;
  music_offset_us: number;
  sources: Record<string, string>;
  source_ids: Record<string, string>;
  auto_selected: boolean;
  rhythm?: {
    mode: 'regular_drums' | 'measured_attacks';
    drum?: 'snare' | 'kick';
    beat_spacing?: number;
    reason?: 'continuous_engagement' | 'no_audible_regular_run';
    selected_count: number;
    measured_count: number;
  };
  final_action?: { source_alias: string; source_time_us: number; start_frame: number; action_frame: number; shot_frame: number };
  ending_confirmation?: { kind: 'ace'; source_alias: string; source_time_us: number; output_frame: number; frames_before_fade: number };
  planning_notices?: string[];
  visual_reference?: { filename: string; duration_s: number } | null;
  selection: HighlightEvent[];
  takes: Array<{
    source_alias: string;
    start_frame: number;
    end_frame: number;
    transition: string;
    impacts: Array<{
      shot_frame: number;
      beat_time_us: number;
      source_time_us: number;
      setup_frame?: number;
      confirmation_frame?: number;
      beat_number?: number;
      attack?: { kind: 'snare' | 'kick' | 'hat'; strength: number; song_time_us: number } | null;
    }>;
    anchors: Array<{ output_frame: number; source_us: number }>;
  }>;
}

export interface VMSBridge {
  getWorkerState(): Promise<WorkerState>;
  importRecordings(): Promise<MediaSource[]>;
  detectKills(source: MediaSource): Promise<{ candidates: KillCandidate[]; upstream_commit: string; status: string }>;
  generateReferenceDraft(project: Project): Promise<ReferenceDraft>;
  readReferenceDraft(project: Project): Promise<ReferenceDraft>;
  importMusic(): Promise<MusicTrack | null>;
  selectStyleReference(): Promise<NonNullable<Project['reference_video']> | null>;
  saveProject(project: Project, currentPath?: string | null): Promise<SaveResult | null>;
  loadProject(): Promise<{ project: Project; path: string } | null>;
  autosaveProject(project: Project): Promise<{ path: string }>;
  render(project: Project, acknowledgements: { rights: boolean; ownership: boolean }): Promise<{ job_id: string; output_path: string } | null>;
  renderPreview(project: Project, mode: 'rough_preview' | 'effects_preview', acknowledgements: { rights: boolean; ownership: boolean }): Promise<{ job_id: string; output_path: string; preview_url: string }>;
  getRenderJob(jobId: string): Promise<RenderJob>;
  cancelRender(jobId: string): Promise<void>;
  revealLocalFile(path: string): Promise<void>;
  aiGetState(): Promise<AIState>;
  aiConnect(): Promise<AIState>;
  aiReconnectSharing(): Promise<AIState>;
  aiAddAccount(): Promise<AIState>;
  aiResumeSignIn(profileId: string): Promise<AIState>;
  aiSelectProfile(profileId: string): Promise<AIState>;
  aiRefreshModels(): Promise<AIState>;
  aiSetModel(slug: string): Promise<AIState>;
  aiCancelSignIn(): Promise<void>;
  aiDisconnect(): Promise<AIState>;
  aiOpenUsage(): Promise<void>;
  aiTestInference(projectId: string, model: string): Promise<{ text: string; usageCount: number }>;
  aiGenerateProposal(project: Project, model: string): Promise<AIDraftResult>;
  aiGetUsage(projectId: string): Promise<number>;
  aiCancelRequest(): Promise<void>;
  onAIState(callback: (state: AIState) => void): () => void;
}

declare global {
  interface Window { vms: VMSBridge; }
}
