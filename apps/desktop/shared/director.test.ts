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

function measuredMusic(project: Project, markerTimes: number[]) {
  project.music = {
    path: 'C:/fixtures/approved-song.wav', filename: 'approved-song.wav', duration_us: 20_000_000,
    bpm_estimate: 120, confidence: 1, sample_rate: 48_000,
    beat_grid: markerTimes.map((time_us, index) => ({ marker_id: `attack-${index + 1}`, time_us,
      confidence: 0.9, kind: 'measured_attack' as const })),
    waveform: [], method: 'upstream beat_hits.py: sample-domain attack timing',
    rights_acknowledged: true, offset_us: 0,
  };
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
    expect(accepted.timeline[1].effects.map(effect => effect.type)).toEqual(
      expect.arrayContaining(['impact_flash', 'screen_shake', 'motion_blur']));
  });

  it('groups near-duplicate same-source kill windows into one multikill sequence', () => {
    const project = fixture();
    const neighbor = structuredClone(project.events[0]);
    neighbor.event_id = 'event-00000003';
    neighbor.source_time_us += 67_000;
    neighbor.source_frame += 4;
    neighbor.in_us += 67_000;
    neighbor.out_us += 67_000;
    project.events.push(neighbor);
    const third = structuredClone(project.events[0]);
    third.event_id = 'event-00000004';
    third.source_time_us += 450_000;
    third.source_frame += 27;
    third.in_us += 450_000;
    third.out_us += 450_000;
    third.confidence = 0.95;
    project.events.push(third);

    const proposal = buildRuleProposal(project);
    expect(proposal.selected_event_ids).toHaveLength(4);
    expect(proposal.clip_plans).toHaveLength(2);
    expect(proposal.clip_plans[0].event_id).toBe('event-00000004');
    expect(proposal.clip_plans[0].included_event_ids).toEqual([
      'event-00000001', 'event-00000003', 'event-00000004',
    ]);
    const accepted = applyProposal(structuredClone(project), proposal);
    const grouped = accepted.timeline.find(clip => clip.included_event_ids?.length === 3);

    expect(accepted.timeline).toHaveLength(2);
    expect(grouped?.included_event_ids).toEqual(['event-00000001', 'event-00000003', 'event-00000004']);
    expect(grouped?.effects.map(effect => effect.type)).toEqual(
      expect.arrayContaining(['impact_flash', 'screen_shake', 'motion_blur']));
    expect(grouped?.time_remap.length).toBeGreaterThan(1);
    expect(accepted.director.last_proposal?.clip_plans).toHaveLength(2);
  });

  it('drops duplicate upstream candidates tied to the same kill-feed row', () => {
    const project = fixture();
    const first = structuredClone(project.events[0]);
    const second = structuredClone(first);
    first.event_id = 'event-00000011';
    first.source_time_us = 36_087_517;
    first.source_frame = 2_165;
    first.evidence = [{ type: 'upstream_kill_candidate', upstream_verified: true,
      feed_frame: 2_173, working_frame_60: 2_163, kill_rank: { score: 8 } }];
    second.event_id = 'event-00000012';
    second.source_time_us = 36_154_184;
    second.source_frame = 2_169;
    second.in_us += 66_667;
    second.out_us += 66_667;
    second.evidence = [{ type: 'upstream_kill_candidate', upstream_verified: true,
      feed_frame: 2_174, working_frame_60: 2_167, kill_rank: { score: 7 } }];
    project.events = [first, second];

    const proposal = buildRuleProposal(project);

    expect(proposal.selected_event_ids).toEqual([first.event_id]);
    expect(proposal.rationale.some(item => item.includes('1 deteksi upstream'))).toBe(true);
  });

  it('assigns distinct measured attacks to adjacent impacts when available', () => {
    const project = fixture();
    const neighbor = structuredClone(project.events[0]);
    neighbor.event_id = 'event-00000003';
    neighbor.source_time_us += 67_000;
    neighbor.source_frame += 4;
    neighbor.in_us += 67_000;
    neighbor.out_us += 67_000;
    project.events = [project.events[0], neighbor];
    measuredMusic(project, [1_000_000, 1_069_444]);

    const proposal = buildRuleProposal(project);
    const accepted = applyProposal(structuredClone(project), proposal);

    expect(proposal.beat_targets.map(target => target.marker_id)).toEqual(['attack-1', 'attack-2']);
    expect(accepted.director.last_proposal?.beat_targets.map(target => target.marker_id)).toEqual(['attack-1', 'attack-2']);
  });

  it('validates grouped AI impacts as one source-bounded editable sequence', () => {
    const project = fixture();
    const neighbor = structuredClone(project.events[0]);
    neighbor.event_id = 'event-00000003';
    neighbor.source_time_us += 67_000;
    neighbor.source_frame += 4;
    neighbor.in_us += 67_000;
    neighbor.out_us += 67_000;
    project.events.push(neighbor);
    const valid = {
      schema_version: 1,
      selected_event_ids: project.events.map(event => event.event_id),
      clip_plans: [
        { event_id: project.events[0].event_id, included_event_ids: [project.events[0].event_id, neighbor.event_id],
          in_us: project.events[0].in_us, out_us: project.events[0].out_us, slot: 0 },
        { event_id: project.events[1].event_id, in_us: project.events[1].in_us,
          out_us: project.events[1].out_us, slot: 1 },
      ],
      beat_targets: [], effects: [], rationale: ['Preserve both adjacent impacts.'], confidence: 0.8, warnings: [],
    };
    expect(validateAIProposal(valid, project).clip_plans[0].included_event_ids).toHaveLength(2);
    expect(() => validateAIProposal({ ...valid, clip_plans: [valid.clip_plans[1]] }, project))
      .toThrow(/included_event_ids|slot/);
  });

  it('rejects reusing one measured attack for two impacts', () => {
    const project = fixture();
    const neighbor = structuredClone(project.events[0]);
    neighbor.event_id = 'event-00000003';
    neighbor.source_time_us += 67_000;
    neighbor.source_frame += 4;
    neighbor.in_us += 67_000;
    neighbor.out_us += 67_000;
    project.events.push(neighbor);
    measuredMusic(project, [1_000_000]);
    const proposal = {
      schema_version: 1,
      selected_event_ids: project.events.map(event => event.event_id),
      clip_plans: [
        { event_id: project.events[0].event_id, included_event_ids: [project.events[0].event_id, neighbor.event_id],
          in_us: project.events[0].in_us, out_us: project.events[0].out_us, slot: 0 },
        { event_id: project.events[1].event_id, in_us: project.events[1].in_us,
          out_us: project.events[1].out_us, slot: 1 },
      ],
      beat_targets: [
        { marker_id: 'attack-1', impact_event_id: project.events[0].event_id, intended_time_us: 1_000_000 },
        { marker_id: 'attack-1', impact_event_id: neighbor.event_id, intended_time_us: 1_000_000 },
      ],
      effects: [], rationale: ['Preserve all impacts.'], confidence: 0.8, warnings: [],
    };

    expect(() => validateAIProposal(proposal, project)).toThrow(/Measured attack yang sama/);
  });

  it('makes the 45 percent default impact zoom visible while staying in the clean limit', () => {
    const project = fixture();
    const proposal = buildRuleProposal(project);
    expect(proposal.effects[0].max_zoom).toBeGreaterThanOrEqual(1.03);
    expect(proposal.effects[0].max_zoom).toBeLessThanOrEqual(1.04);
  });
});
