export type OutputProfile = 'master_144' | 'youtube_60' | 'preview_30';
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
  size_bytes?: number;
  file_sha256?: string;
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
  kind: 'beat_candidate' | 'measured_attack' | 'downbeat' | 'user_beat';
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

export type Effect =
  | { type: 'impact_zoom'; max_zoom: number; duration_frames: number; anchor: 'impact'; enabled: boolean;
      keyframes?: Array<{ frame_offset: number; scale: number }> }
  | { type: 'motion_blur'; strength: number; window_frames: 3 | 5; enabled: boolean }
  | { type: 'screen_shake'; amplitude_px: number; duration_frames: number; enabled: boolean }
  | { type: 'impact_flash'; intensity: number; duration_frames: number; enabled: boolean };

export interface TimelineTransition { type: 'dip_to_black'; duration_frames: number; enabled: boolean; }

export interface TimelineClip {
  clip_id: string;
  event_id: string;
  /** Additional reviewed event impacts retained in a deduplicated sequence clip. */
  included_event_ids?: string[];
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
    direction: 'forward' | 'reverse';
  }>;
  effects: Effect[];
  transitions: TimelineTransition[];
  audio_gain: number;
}

export interface Project {
  reference_draft?: string;
  reference_video?: { path: string; filename: string } | null;
  schema_version: 2;
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
  dismissed_kill_candidates?: Array<Pick<HighlightEvent, 'source_media_id' | 'source_time_us' | 'source_frame'>>;
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
  clip_plans: Array<{ event_id: string; included_event_ids?: string[]; in_us: number; out_us: number; slot: number }>;
  beat_targets: Array<{ marker_id: string; impact_event_id: string; intended_time_us: number }>;
  effects: Array<{ event_id: string; type: 'impact_zoom'; max_zoom: number }>;
  rationale: string[];
  confidence: number;
  warnings: string[];
  status: 'proposal_needs_user_review' | 'accepted' | 'rejected';
}

export const FPS: Record<OutputProfile, number> = { master_144: 144, youtube_60: 60, preview_30: 30 };

export function createProject(name = 'Untitled Montage'): Project {
  return {
    schema_version: 2,
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
    clip.included_event_ids = clip.included_event_ids?.length ? [...new Set(clip.included_event_ids)] : [clip.event_id];
    const remap = clip.time_remap.length ? clip.time_remap : [{ output_start_frame: 0,
      output_end_frame: 0, source_start_us: clip.in_us, source_end_us: clip.out_us,
      speed_num: 1, speed_den: 1, direction: 'forward' as const }];
    let localFrame = 0;
    for (const segment of remap) {
      const spanUs = segment.source_end_us - segment.source_start_us;
      const sourceDurationUs = Math.round(spanUs * segment.speed_den / segment.speed_num);
      const segmentFrames = durationToFrames(sourceDurationUs, fps);
      segment.output_start_frame = localFrame;
      segment.output_end_frame = localFrame + segmentFrames;
      localFrame += segmentFrames;
    }
    const durationFrames = localFrame;
    clip.output_start_frame = outputFrame;
    clip.duration_frames = durationFrames;
    clip.time_remap = remap;
    outputFrame += durationFrames;
  }
}

export function makeAutomaticEffects(event: HighlightEvent, intensity: number): Effect[] {
  if (intensity <= 0) return [];
  const peak = Math.round(Math.min(1.08, 1 + 0.08 * intensity) * 10_000) / 10_000;
  const effects: Effect[] = [{ type: 'impact_zoom', max_zoom: peak,
    duration_frames: 24, anchor: 'impact', enabled: true,
    keyframes: [{ frame_offset: -12, scale: 1 }, { frame_offset: 0, scale: peak }, { frame_offset: 12, scale: 1 }] }];
  const tags = new Set(event.tags);
  if (tags.has('headshot') || tags.has('multikill')) {
    effects.push({ type: 'impact_flash', intensity: Math.round(0.22 * intensity * 1000) / 1000,
      duration_frames: 3, enabled: true });
  }
  if (tags.has('multikill') && event.confidence >= 0.8) {
    effects.push({ type: 'screen_shake', amplitude_px: Math.round(8 * intensity * 100) / 100,
      duration_frames: 12, enabled: true });
    effects.push({ type: 'motion_blur', strength: Math.round(0.25 * intensity * 1000) / 1000,
      window_frames: 3, enabled: true });
  }
  return effects;
}

function remapFrames(sourceStartUs: number, sourceEndUs: number, speedNum: number, speedDen: number,
                     direction: 'forward' | 'reverse') {
  return { output_start_frame: 0, output_end_frame: 0, source_start_us: sourceStartUs, source_end_us: sourceEndUs,
    speed_num: speedNum, speed_den: speedDen, direction };
}

export function resizeClipRange(clip: TimelineClip, inUs: number, outUs: number): void {
  if (inUs === clip.in_us && outUs === clip.out_us) return;
  const segments = clip.time_remap.flatMap(segment => {
    const start = Math.max(segment.source_start_us, inUs);
    const end = Math.min(segment.source_end_us, outUs);
    return start < end ? [remapFrames(start, end, segment.speed_num, segment.speed_den, segment.direction)] : [];
  });
  if (inUs < clip.in_us && inUs < outUs) segments.unshift(remapFrames(inUs, Math.min(clip.in_us, outUs), 1, 1, 'forward'));
  if (outUs > clip.out_us && inUs < outUs) segments.push(remapFrames(Math.max(clip.out_us, inUs), outUs, 1, 1, 'forward'));
  clip.in_us = inUs;
  clip.out_us = outUs;
  clip.time_remap = segments;
}

export function makePostKillSpeedRamp(event: HighlightEvent, inUs: number, outUs: number, fps: number): TimelineClip['time_remap'] {
  const slowStart = Math.min(outUs, event.source_time_us + 180_000);
  const slowEnd = Math.min(outUs, event.source_time_us + 1_050_000);
  const parts: TimelineClip['time_remap'] = [];
  if (inUs < slowStart) parts.push(remapFrames(inUs, slowStart, 1, 1, 'forward'));
  const rampStart = Math.max(inUs, slowStart);
  if (slowEnd - rampStart >= 240_000) {
    const slices = 12;
    for (let index = 0; index < slices; index++) {
      const a = Math.round(rampStart + (slowEnd - rampStart) * index / slices);
      const b = Math.round(rampStart + (slowEnd - rampStart) * (index + 1) / slices);
      const phase = (index + 0.5) / slices;
      const speed = 1 - 0.48 * Math.sin(Math.PI * phase);
      const speedDen = 100;
      const speedNum = Math.round(speed * speedDen);
      if (b > a) parts.push(remapFrames(a, b, speedNum, speedDen, 'forward'));
    }
  }
  if (slowEnd < outUs) parts.push(remapFrames(slowEnd, outUs, 1, 1, 'forward'));
  if (!parts.length) parts.push(remapFrames(inUs, outUs, 1, 1, 'forward'));
  let cursor = 0;
  for (const segment of parts) {
    const frames = durationToFrames(Math.round((segment.source_end_us - segment.source_start_us) * segment.speed_den / segment.speed_num), fps);
    segment.output_start_frame = cursor;
    segment.output_end_frame = cursor + frames;
    cursor += frames;
  }
  return parts;
}

export function toggleReverseImpactReplay(clip: TimelineClip, event: HighlightEvent, enabled: boolean, fps: number): void {
  const base = clip.time_remap.filter(segment => segment.direction === 'forward')
    .sort((a, b) => a.source_start_us - b.source_start_us);
  if (!enabled) {
    clip.time_remap = base;
    return;
  }
  const replayStart = Math.max(clip.in_us, event.source_time_us + 220_000);
  const replayEnd = Math.min(clip.out_us, event.source_time_us + 520_000);
  if (replayEnd - replayStart < 120_000) return;
  const prefix: TimelineClip['time_remap'] = [];
  const region: TimelineClip['time_remap'] = [];
  const suffix: TimelineClip['time_remap'] = [];
  for (const segment of base) {
    const a = segment.source_start_us;
    const b = segment.source_end_us;
    if (a < replayStart) prefix.push(remapFrames(a, Math.min(b, replayStart), segment.speed_num, segment.speed_den, 'forward'));
    const midStart = Math.max(a, replayStart);
    const midEnd = Math.min(b, replayEnd);
    if (midEnd > midStart) region.push(remapFrames(midStart, midEnd, segment.speed_num, segment.speed_den, 'forward'));
    if (b > replayEnd) suffix.push(remapFrames(Math.max(a, replayEnd), b, segment.speed_num, segment.speed_den, 'forward'));
  }
  const rebuilt: TimelineClip['time_remap'] = [...prefix, ...region,
    remapFrames(replayStart, replayEnd, 1, 2, 'reverse'), ...suffix];
  clip.time_remap = rebuilt;
  let cursor = 0;
  for (const segment of clip.time_remap) {
    const frames = durationToFrames(Math.round((segment.source_end_us - segment.source_start_us) * segment.speed_den / segment.speed_num), fps);
    segment.output_start_frame = cursor;
    segment.output_end_frame = cursor + frames;
    cursor += frames;
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
  const fps = FPS[project.settings.output_profile];
  const useSlowRamp = event.confidence >= 0.85 && (event.tags.includes('headshot') || event.tags.includes('multikill'));
  const remap = useSlowRamp ? makePostKillSpeedRamp(event, inUs, outUs, fps) :
    [remapFrames(inUs, outUs, 1, 1, 'forward')];
  const durationFrames = remap.at(-1)?.output_end_frame ?? durationToFrames(outUs - inUs, fps);
  const intensity = project.settings.effects_intensity;
  const clip: TimelineClip = {
    clip_id: crypto.randomUUID(), event_id: event.event_id, included_event_ids: [event.event_id],
    source_media_id: event.source_media_id,
    in_us: inUs, out_us: outUs, output_start_frame: 0,
    duration_frames: durationFrames,
    time_remap: remap, effects: makeAutomaticEffects(event, intensity), transitions: [], audio_gain: project.settings.gameplay_gain,
  };
  return clip;
}

export function isAutoKill(event: HighlightEvent): boolean {
  return event.evidence.some(item => item.type === 'user_reviewed_upstream_candidate');
}

type SourceKillWindow = Pick<HighlightEvent, 'source_media_id' | 'source_time_us' | 'in_us' | 'out_us'>;

export function isolatedKillWindow(event: SourceKillWindow, neighbors: readonly SourceKillWindow[]): { inUs: number; outUs: number } {
  const time = event.source_time_us;
  let before = -Infinity;
  let after = Infinity;
  for (const other of neighbors) {
    if (other.source_media_id !== event.source_media_id) continue;
    if (other.source_time_us < time) before = Math.max(before, other.source_time_us);
    if (other.source_time_us > time) after = Math.min(after, other.source_time_us);
  }
  // Use a shared cut between neighboring impacts when their replay windows overlap.
  const inUs = Number.isFinite(before) ? Math.max(event.in_us, Math.ceil((before + time) / 2)) : event.in_us;
  const outUs = Math.min(event.out_us, Math.ceil(time + (after - time) / 2));
  return { inUs, outUs };
}

export function autoKillClipBounds(project: Project, clip: TimelineClip, detected: readonly SourceKillWindow[] = []): { inUs: number; outUs: number } | null {
  const event = project.events.find(item => item.event_id === clip.event_id);
  if (!event || !isAutoKill(event) || (clip.included_event_ids?.length ?? 1) > 1) return null;
  return isolatedKillWindow(event, [...project.events, ...detected]);
}

export function trimOverlappingAutoKillClips(project: Project, sourceId?: string, detected: readonly SourceKillWindow[] = []): void {
  for (const clip of project.timeline) {
    if (sourceId && clip.source_media_id !== sourceId) continue;
    const bounds = autoKillClipBounds(project, clip, detected);
    if (!bounds) continue;
    const inUs = Math.max(clip.in_us, bounds.inUs);
    const outUs = Math.min(clip.out_us, bounds.outUs);
    if (inUs >= outUs || (inUs === clip.in_us && outUs === clip.out_us)) continue;
    resizeClipRange(clip, inUs, outUs);
  }
  rebuildTimeline(project);
}

export function removeReviewedHighlight(project: Project, eventId: string): void {
  project.events = project.events.filter(event => event.event_id !== eventId);
  const events = new Map(project.events.map(event => [event.event_id, event]));
  project.timeline = project.timeline.flatMap(clip => {
    const ids = clip.included_event_ids ?? [clip.event_id];
    if (!ids.includes(eventId)) return [clip];
    const retained = ids.filter(id => id !== eventId).map(id => events.get(id)!);
    if (!retained.length) return [];
    if (clip.event_id !== eventId) {
      clip.included_event_ids = retained.map(event => event.event_id);
      return [clip];
    }
    const firstImpact = Math.min(...retained.map(event => event.source_time_us));
    const lastImpact = Math.max(...retained.map(event => event.source_time_us));
    const primary = retained.find(event => event.in_us <= firstImpact && event.out_us >= lastImpact);
    if (primary) {
      clip.event_id = primary.event_id;
      clip.included_event_ids = retained.map(event => event.event_id);
      const lo = Math.max(clip.in_us, primary.in_us);
      const hi = Math.min(clip.out_us, primary.out_us);
      resizeClipRange(clip, lo < hi ? lo : primary.in_us, lo < hi ? hi : primary.out_us);
      return [clip];
    }
    return retained.sort((a, b) => a.source_time_us - b.source_time_us).map((event, index) => {
      const bounds = isolatedKillWindow(event, retained);
      const next = { ...structuredClone(clip), clip_id: index === 0 ? clip.clip_id : crypto.randomUUID(),
        event_id: event.event_id, included_event_ids: [event.event_id] };
      const lo = Math.max(clip.in_us, bounds.inUs);
      const hi = Math.min(clip.out_us, bounds.outUs);
      resizeClipRange(next, lo < hi ? lo : bounds.inUs, lo < hi ? hi : bounds.outUs);
      return next;
    });
  });
  project.director = { ...project.director, last_proposal: null };
  delete project.reference_draft;
  rebuildTimeline(project);
}

export function applyProposal(project: Project, proposal: DirectorProposal): Project {
  const events = new Map(project.events.map(event => [event.event_id, event]));
  if (!proposal.clip_plans.length) throw new Error('Proposal has no editable sequences.');
  const plans = [...proposal.clip_plans].sort((a, b) => a.slot - b.slot).map(plan => {
    const event = events.get(plan.event_id);
    if (!event || !proposal.selected_event_ids.includes(plan.event_id)) throw new Error('Proposal references an unknown event.');
    const memberIds = plan.included_event_ids ?? [plan.event_id];
    const members = memberIds.map(id => events.get(id));
    if (!memberIds.includes(plan.event_id) || new Set(memberIds).size !== memberIds.length
        || members.some(member => !member || !proposal.selected_event_ids.includes(member.event_id)
          || member.source_media_id !== event.source_media_id
          || member.source_time_us < plan.in_us || member.source_time_us > plan.out_us)) {
      throw new Error('Proposal sequence references an unknown event.');
    }
    return { plan, event, members: members as HighlightEvent[] };
  });
  const assignedIds = plans.flatMap(item => item.members.map(event => event.event_id));
  if (new Set(assignedIds).size !== assignedIds.length
      || proposal.selected_event_ids.some(id => !assignedIds.includes(id))
      || assignedIds.some(id => !proposal.selected_event_ids.includes(id))) {
    throw new Error('Proposal must preserve each selected impact exactly once.');
  }
  const sequenceGroups: Array<Array<(typeof plans)[number]>> = [];
  for (const item of plans) {
    const matching = sequenceGroups.filter(group => group.some(other =>
      other.event.source_media_id === item.event.source_media_id &&
      overlapRatio(other.plan.in_us, other.plan.out_us, item.plan.in_us, item.plan.out_us) >= 0.8));
    if (!matching.length) {
      sequenceGroups.push([item]);
      continue;
    }
    const target = matching[0];
    target.push(item);
    for (const extra of matching.slice(1)) {
      target.push(...extra);
      sequenceGroups.splice(sequenceGroups.indexOf(extra), 1);
    }
  }
  const sequences = sequenceGroups.flatMap(group => {
    const members = [...new Map(group.flatMap(item => item.members).map(event => [event.event_id, event])).values()];
    if (group.length === 1) return [{ group, members, representative: group[0] }];
    const covering = group.filter(candidate => members.every(member =>
      candidate.plan.in_us <= member.source_time_us && member.source_time_us <= candidate.plan.out_us));
    if (!covering.length) return group.map(member => ({ group: [member], members: member.members,
      representative: member }));
    covering.sort((a, b) => eventScore(b.event, project.preferences.event_weights)
      - eventScore(a.event, project.preferences.event_weights)
      || a.event.source_time_us - b.event.source_time_us
      || a.event.event_id.localeCompare(b.event.event_id));
    return [{ group, members, representative: covering[0] }];
  }).sort((a, b) => Math.min(...a.group.map(item => item.plan.slot))
    - Math.min(...b.group.map(item => item.plan.slot)));
  const clips = sequences.map(({ group, members: memberEvents, representative }) => {
    const groupedTags = [...new Set(memberEvents.flatMap(event => event.tags))];
    if (memberEvents.length > 1 && !groupedTags.includes('multikill')) groupedTags.push('multikill');
    const event = { ...representative.event,
      confidence: Math.max(...memberEvents.map(item => item.confidence)), tags: groupedTags };
    const clip = makeClip(project, event, representative.plan.in_us, representative.plan.out_us);
    clip.included_event_ids = [...memberEvents].sort((a, b) => a.source_time_us - b.source_time_us
      || a.event_id.localeCompare(b.event_id)).map(item => item.event_id);
    const plannedZoom = proposal.effects.filter(item => clip.included_event_ids?.includes(item.event_id))
      .sort((a, b) => Number(b.event_id === representative.event.event_id)
        - Number(a.event_id === representative.event.event_id))[0];
    const generatedZoom = clip.effects.find((item): item is Extract<Effect, { type: 'impact_zoom' }> => item.type === 'impact_zoom');
    clip.effects = clip.effects.filter(item => item.type !== 'impact_zoom');
    if (plannedZoom) {
      if (generatedZoom) {
        clip.effects.unshift({ ...generatedZoom, max_zoom: plannedZoom.max_zoom,
          keyframes: generatedZoom.keyframes?.map(keyframe => ({ ...keyframe,
            scale: keyframe.scale > 1 ? plannedZoom.max_zoom : 1 })) });
      } else {
        clip.effects.unshift({ type: 'impact_zoom', max_zoom: plannedZoom.max_zoom,
          duration_frames: 24, anchor: 'impact', enabled: true });
      }
    }
    return clip;
  });
  const next = structuredClone(project);
  next.timeline = clips;
  rebuildTimeline(next);
  const acceptedProposal = structuredClone(proposal);
  acceptedProposal.status = 'accepted';
  acceptedProposal.selected_event_ids = next.timeline.flatMap(clip => clip.included_event_ids ?? [clip.event_id]);
  acceptedProposal.clip_plans = next.timeline.map((clip, slot) => ({ event_id: clip.event_id,
    included_event_ids: clip.included_event_ids ?? [clip.event_id], in_us: clip.in_us, out_us: clip.out_us, slot }));
  acceptedProposal.effects = next.timeline.flatMap(clip => {
    const effect = clip.effects.find((item): item is Extract<Effect, { type: 'impact_zoom' }> => item.type === 'impact_zoom');
    return effect ? [{ event_id: clip.event_id, type: 'impact_zoom' as const, max_zoom: effect.max_zoom }] : [];
  });
  acceptedProposal.beat_targets = [];
  if (next.music?.beat_grid.length) {
    const eventById = new Map(next.events.map(event => [event.event_id, event]));
    const fps = FPS[next.settings.output_profile];
    const offset = Math.max(0, next.music.offset_us);
    const usedBeatMarkerIds = new Set<string>();
    for (const clip of next.timeline) {
      for (const eventId of clip.included_event_ids ?? [clip.event_id]) {
        const event = eventById.get(eventId);
        if (!event) continue;
        const frame = clip.output_start_frame + eventOutputFrame(clip, event.source_time_us);
        const timeUs = Math.round(frame * 1_000_000 / fps);
        const beat = next.music.beat_grid.filter(marker => !usedBeatMarkerIds.has(marker.marker_id)
          && marker.kind === 'measured_attack').reduce<{ marker: BeatMarker; error: number } | null>((best, marker) => {
          const error = Math.abs(marker.time_us - offset - timeUs);
          return !best || error < best.error ? { marker, error } : best;
        }, null);
        if (beat && beat.error <= 80_000) {
          acceptedProposal.beat_targets.push({
            marker_id: beat.marker.marker_id, impact_event_id: eventId, intended_time_us: beat.marker.time_us,
          });
          usedBeatMarkerIds.add(beat.marker.marker_id);
        }
      }
    }
  }
  if (acceptedProposal.selected_event_ids.length > acceptedProposal.clip_plans.length
      && !acceptedProposal.rationale.some(line => line.includes('digabung'))) {
    acceptedProposal.rationale.push('Impact yang berdekatan digabung di satu sequence; seluruh impact tetap tercatat di timeline.');
  }
  next.director = { mode: acceptedProposal.source, last_proposal: acceptedProposal };
  return next;
}

function eventOutputFrame(clip: TimelineClip, sourceTimeUs: number): number {
  const candidates = clip.time_remap.filter(segment => segment.source_start_us <= sourceTimeUs
    && sourceTimeUs <= segment.source_end_us).map(segment => {
    const fraction = (sourceTimeUs - segment.source_start_us)
      / Math.max(1, segment.source_end_us - segment.source_start_us);
    const progress = segment.direction === 'reverse' ? 1 - fraction : fraction;
    return segment.output_start_frame + Math.round(progress * (segment.output_end_frame - segment.output_start_frame));
  });
  return Math.max(0, Math.min(clip.duration_frames - 1, candidates.length ? Math.min(...candidates) : 0));
}

function overlapRatio(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const shorter = Math.min(aEnd - aStart, bEnd - bStart);
  if (shorter <= 0) return 0;
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / shorter;
}
