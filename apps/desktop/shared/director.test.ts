import { describe, expect, it } from 'vitest';
import { applyProposal, createProject, type HighlightEvent, type MediaSource, type Project } from './project.js';
import { buildRuleProposal, validateAIProposal } from './director.js';

function fixture(): Project {
  const project = createProject('Unit test montage');
  const source: MediaSource = {
    media_id: 'media-12345678', path: 'C:/fixtures/gameplay.mp4', filename: 'gameplay.mp4', size_bytes: 1024,
    duration_us: 30_000_000, container: 'mov,mp4',
    video: { codec: 'h264', width: 1920, height: 1080, avg_frame_rate: [60, 1], r_frame_rate: [60, 1], rotation_degrees: 0 },
    audio: [], has_audio: false,
  };
  const makeEvent = (eventId: string, impact: number, tags: string[]): HighlightEvent => ({
    event_id: eventId, source_media_id: source.media_id, source_time_us: impact, source_frame: Math.round(impact * 60 / 1_000_000),
    in_us: impact - 1_000_000, out_us: impact + 2_000_000, evidence: [], owner: 'player', confidence: 0.92,
    tags, cluster_id: null, rating: null, is_user_override: true,
  });
  project.sources = [source];
  project.events = [
    makeEvent('event-00000001', 3_000_000, ['headshot']),
    makeEvent('event-00000002', 9_000_000, ['multikill']),
  ];
  return project;
}

describe('Creative Director proposals', () => {
  it('creates a deterministic rule-only plan from reviewed annotations', () => {
    const first = buildRuleProposal(fixture());
    const second = buildRuleProposal(fixture());
    expect(first.source).toBe('rule_only');
    expect(first.selected_event_ids).toHaveLength(2);
    expect(first.clip_plans.map(plan => plan.event_id)).toEqual(second.clip_plans.map(plan => plan.event_id));
    expect(first.status).toBe('proposal_needs_user_review');
  });

  it('accepts only event-backed, bounded clip plans and rejects invented events', () => {
    const project = fixture();
    const valid = {
      schema_version: 1,
      selected_event_ids: project.events.map(event => event.event_id),
      clip_plans: project.events.map((event, slot) => ({ event_id: event.event_id, in_us: event.in_us, out_us: event.out_us, slot })),
      beat_targets: [],
      effects: project.events.map(event => ({ event_id: event.event_id, type: 'impact_zoom', max_zoom: 1.018 })),
      rationale: ['Keep reviewed impact ranges intact.'], confidence: 0.8, warnings: [],
    };
    expect(validateAIProposal(valid, project).clip_plans).toHaveLength(2);
    expect(() => validateAIProposal({ ...valid, selected_event_ids: ['invented-event'] }, project)).toThrow(/event that does not exist|event/);
  });

  it('commits an accepted proposal to a new project timeline', () => {
    const project = fixture();
    const proposal = buildRuleProposal(project);
    const accepted = applyProposal(structuredClone(project), proposal);
    expect(project.timeline).toHaveLength(0);
    expect(accepted.timeline).toHaveLength(2);
    expect(accepted.timeline[0].output_start_frame).toBe(0);
    expect(accepted.timeline[1].output_start_frame).toBe(accepted.timeline[0].duration_frames);
    expect(accepted.director.last_proposal?.status).toBe('accepted');
  });
});
