import type { ChatGPTModel, LoginProfile, SessionState } from '@siwc/local';
import type { MediaSource, Project, DirectorProposal, MusicTrack } from './project.js';

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

export interface VMSBridge {
  getWorkerState(): Promise<WorkerState>;
  importRecordings(): Promise<MediaSource[]>;
  importMusic(): Promise<MusicTrack | null>;
  saveProject(project: Project, currentPath?: string | null): Promise<SaveResult | null>;
  loadProject(): Promise<{ project: Project; path: string } | null>;
  autosaveProject(project: Project): Promise<{ path: string }>;
  render(project: Project, acknowledgements: { rights: boolean; ownership: boolean }): Promise<{ job_id: string; output_path: string } | null>;
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
