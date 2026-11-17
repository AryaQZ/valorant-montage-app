export type OutputProfile = 'master_144' | 'youtube_60';
export type EventOwner = 'player' | 'unknown';

export interface MediaSource {
  media_id: string;
  path: string;
  filename: string;
  size_bytes: number;
  duration_us: number;
  container: string;
  video: {
    codec: string;
    width: number;
    height: number;
    avg_frame_rate: [number, number] | null;
    r_frame_rate: [number, number] | null;
    rotation_degrees: number;
    timestamp_behavior?: { variable_frame_rate: boolean | null; sampled_frames: number };
  };
  audio: Array<{ codec: string; sample_rate: string; channels: number }>;
  has_audio: boolean;
  thumbnail_path?: string | null;
  thumbnail_url?: string | null;
  proxy_path?: string | null;
  preview_url?: string | null;
  warning?: string | null;
}

export interface MusicTrack {
  path: string;
  filename: string;
  duration_us: number;
  bpm_estimate: number | null;
  confidence: number;
  sample_rate: number;
  beat_grid: BeatMarker[];
  waveform?: number[];
  method: string;
  rights_acknowledged: boolean;
  offset_us: number;
}

export interface BeatMarker {
  marker_id: string;
  time_us: number;
  confidence: number;
  kind: 'beat_candidate' | 'downbeat' | 'user_beat';
}

export interface HighlightEvent {
  event_id: string;
  source_media_id: string;
  source_time_us: number;
  source_frame: number;
  in_us: number;
  out_us: number;
  evidence: Array<Record<string, unknown>>;
  owner: EventOwner;
  confidence: number;
  tags: string[];
  cluster_id: string | null;
  rating: number | null;
  is_user_override: boolean;
}

export interface Effect {
  type: 'impact_zoom';
  max_zoom: number;
  duration_frames: number;
  anchor: 'center';
  enabled: boolean;
}

export interface TimelineClip {
  clip_id: string;
  event_id: string;
  source_media_id: string;
  in_us: number;
  out_us: number;
  output_start_frame: number;
  duration_frames: number;
  time_remap: Array<{
    output_start_frame: number;
    output_end_frame: number;
    source_start_us: number;
    source_end_us: number;
    speed_num: number;
    speed_den: number;
  }>;
  effects: Effect[];
  transitions: unknown[];
  audio_gain: number;
}

export interface Project {
  schema_version: 1;
  project_id: string;
  name: string;
  created_utc: string;
  settings: {
    style: 'smooth_clean';
    beat_sync_priority: number;
    effects_intensity: number;
    output_profile: OutputProfile;
    music_gain: number;
    gameplay_gain: number;
  };
  sources: MediaSource[];
  events: HighlightEvent[];
  timeline: TimelineClip[];
  music: MusicTrack | null;
  director: { mode: 'rule_only' | 'chatgpt'; last_proposal: DirectorProposal | null };
  preferences: { event_weights: Record<string, number>; ratings: unknown[]; ai_director_requests: number };
}

export interface DirectorProposal {
  schema_version: 1;
  proposal_id: string;
  source: 'rule_only' | 'chatgpt';
  selected_event_ids: string[];
  clip_plans: Array<{ event_id: string; in_us: number; out_us: number; slot: number }>;
  beat_targets: Array<{ marker_id: string; impact_event_id: string; intended_time_us: number }>;
  effects: Array<{ event_id: string; type: 'impact_zoom'; max_zoom: number }>;
  rationale: string[];
  confidence: number;
  warnings: string[];
  status: 'proposal_needs_user_review' | 'accepted' | 'rejected';
}

export const FPS: Record<OutputProfile, number> = { master_144: 144, youtube_60: 60 };

export function createProject(name = 'Untitled Montage'): Project {
  return {
    schema_version: 1,
    project_id: crypto.randomUUID(),
    name: name.trim() || 'Untitled Montage',
    created_utc: new Date().toISOString(),
    settings: { style: 'smooth_clean', beat_sync_priority: 0.75, effects_intensity: 0.45,
      output_profile: 'master_144', music_gain: 0.18, gameplay_gain: 1 },
    sources: [], events: [], timeline: [], music: null,
    director: { mode: 'rule_only', last_proposal: null },
    preferences: { event_weights: {}, ratings: [], ai_director_requests: 0 },
  };
}

export function durationToFrames(durationUs: number, fps: number): number {
  if (!Number.isSafeInteger(durationUs) || durationUs <= 0 || fps <= 0) throw new Error('Duration must be a positive integer number of microseconds.');
  return Math.max(1, Math.floor((durationUs * fps + 500_000) / 1_000_000));
}

export function rebuildTimeline(project: Project): void {
  const fps = FPS[project.settings.output_profile];
  let outputFrame = 0;
  for (const clip of project.timeline) {
    const durationFrames = durationToFrames(clip.out_us - clip.in_us, fps);
    clip.output_start_frame = outputFrame;
    clip.duration_frames = durationFrames;
    clip.time_remap = [{ output_start_frame: 0, output_end_frame: durationFrames,
      source_start_us: clip.in_us, source_end_us: clip.out_us, speed_num: 1, speed_den: 1 }];
    outputFrame += durationFrames;
  }
}

export function eventScore(event: HighlightEvent, weights: Record<string, number> = {}): number {
  const defaults: Record<string, number> = { headshot: 1, multikill: 1.8, clutch: 1.3, round_win: 0.7, clean_audio: 0.3 };
  const score = event.confidence + event.tags.reduce((sum, tag) => sum + (weights[tag] ?? defaults[tag] ?? 0), 0)
    + (event.owner === 'unknown' ? -1 : 0) + (event.is_user_override ? 0.25 : 0);
  return Math.round(score * 1000) / 1000;
}

export function makeClip(project: Project, event: HighlightEvent, inUs = event.in_us, outUs = event.out_us): TimelineClip {
  if (inUs < event.in_us || outUs > event.out_us || inUs >= outUs) throw new Error('Clip trim must remain inside the selected event range.');
  const intensity = project.settings.effects_intensity;
  const clip: TimelineClip = {
    clip_id: crypto.randomUUID(), event_id: event.event_id, source_media_id: event.source_media_id,
    in_us: inUs, out_us: outUs, output_start_frame: 0,
    duration_frames: durationToFrames(outUs - inUs, FPS[project.settings.output_profile]),
    time_remap: [], effects: intensity > 0 ? [{ type: 'impact_zoom', max_zoom: Math.round((1 + 0.04 * intensity) * 10000) / 10000,
      duration_frames: 24, anchor: 'center', enabled: true }] : [], transitions: [], audio_gain: project.settings.gameplay_gain,
  };
  return clip;
}

export function applyProposal(project: Project, proposal: DirectorProposal): Project {
  const events = new Map(project.events.map(event => [event.event_id, event]));
  if (proposal.selected_event_ids.length !== proposal.clip_plans.length) throw new Error('Proposal event/clip counts do not match.');
  const clips = [...proposal.clip_plans].sort((a, b) => a.slot - b.slot).map(plan => {
    const event = events.get(plan.event_id);
    if (!event || !proposal.selected_event_ids.includes(plan.event_id)) throw new Error('Proposal references an unknown event.');
    return makeClip(project, event, plan.in_us, plan.out_us);
  });
  const next = structuredClone(project);
  next.timeline = clips;
  for (const clip of next.timeline) {
    const effect = proposal.effects.find(item => item.event_id === clip.event_id);
    if (effect) clip.effects = [{ type: effect.type, max_zoom: effect.max_zoom,
      duration_frames: 24, anchor: 'center', enabled: true }];
    else clip.effects = [];
  }
  proposal.status = 'accepted';
  next.director = { mode: proposal.source, last_proposal: structuredClone(proposal) };
  rebuildTimeline(next);
  return next;
}
