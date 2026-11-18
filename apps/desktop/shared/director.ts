import type { DirectorProposal, HighlightEvent, Project } from './project.js';
import { durationToFrames, eventScore, FPS } from './project.js';

export class DirectorValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'DirectorValidationError'; }
}

function nearestBeat(timeUs: number, project: Project, excludedMarkerIds: Set<string> = new Set()) {
  const offset = Math.max(0, project.music?.offset_us ?? 0);
  const markers = (project.music?.beat_grid ?? []).filter(marker => marker.kind === 'measured_attack'
    && !excludedMarkerIds.has(marker.marker_id));
  if (!markers.length) return null;
  return markers.reduce((best, marker) => {
    const error = Math.abs(marker.time_us - offset - timeUs);
    return !best || error < best.error ? { marker, error } : best;
  }, null as { marker: (typeof markers)[number]; error: number } | null);
}

function outputImpactUs(event: HighlightEvent, inUs: number, outUs: number, outputStartFrame: number, fps: number): number {
  const impactOffsetFrames = Math.round((event.source_time_us - inUs) * fps / 1_000_000);
  return Math.round((outputStartFrame + impactOffsetFrames) * 1_000_000 / fps);
}

export function buildRuleProposal(project: Project): DirectorProposal {
  const rawCandidates = project.events.filter(event => event.confidence >= 0.4);
  const candidates = removeDuplicateUpstreamShots(rawCandidates, project.preferences.event_weights);
  if (!candidates.length) throw new DirectorValidationError('Tambahkan highlight manual sebelum membuat draft.');
  const weights = project.preferences.event_weights;
  const fps = FPS[project.settings.output_profile];
  const sequences = groupCandidateSequences(candidates, weights);
  const ordered: typeof sequences = [];
  const remaining = [...sequences];
  const sourceNames = new Map(project.sources.map(source => [source.media_id, source.filename.toLocaleLowerCase()]));
  let outputFrame = 0;
  const minScore = Math.min(...remaining.map(sequence => sequence.score));
  const maxScore = Math.max(...remaining.map(sequence => sequence.score));
  while (remaining.length) {
    const position = ordered.length;
    const targetEnergy = minScore + (maxScore - minScore) * (position / Math.max(1, sequences.length - 1));
    const best = remaining.map(sequence => {
      const energyPenalty = Math.abs(sequence.score - targetEnergy) * 0.35;
      const { representative } = sequence;
      const clipFrames = durationToFrames(representative.out_us - representative.in_us, fps);
      const beatErrors = sequence.members.map(event => {
        const impactTime = outputImpactUs(event, representative.in_us, representative.out_us, outputFrame, fps);
        return nearestBeat(impactTime, project)?.error;
      }).filter((error): error is number => error !== undefined);
      const beatPenalty = beatErrors.length
        ? project.settings.beat_sync_priority * Math.min(3, beatErrors.reduce((sum, error) => sum + error, 0)
          / beatErrors.length / 80_000) * 0.35 : 0;
      const previousClusters = new Set(ordered.at(-1)?.members.map(event => event.cluster_id).filter(Boolean));
      const clusterPenalty = sequence.members.some(event => event.cluster_id && previousClusters.has(event.cluster_id)) ? 0.6 : 0;
      return { sequence, score: energyPenalty + beatPenalty + clusterPenalty, clipFrames };
    }).sort((a, b) => a.score - b.score || b.sequence.score - a.sequence.score
      || (sourceNames.get(a.sequence.representative.source_media_id) ?? '').localeCompare(
        sourceNames.get(b.sequence.representative.source_media_id) ?? '')
      || a.sequence.representative.source_time_us - b.sequence.representative.source_time_us
      || a.sequence.representative.event_id.localeCompare(b.sequence.representative.event_id));
    const selected = best[0];
    ordered.push(selected.sequence);
    remaining.splice(remaining.findIndex(sequence => sequence === selected.sequence), 1);
    outputFrame += selected.clipFrames;
  }
  let cursor = 0;
  const clipPlans = ordered.map((sequence, slot) => {
    const event = sequence.representative;
    const plan = { event_id: event.event_id,
      included_event_ids: sequence.members.map(member => member.event_id),
      in_us: event.in_us, out_us: event.out_us, slot };
    cursor += durationToFrames(plan.out_us - plan.in_us, fps);
    return plan;
  });
  cursor = 0;
  const beatTargets: DirectorProposal['beat_targets'] = [];
  const usedBeatMarkerIds = new Set<string>();
  for (const plan of clipPlans) {
    const sequence = ordered.find(item => item.representative.event_id === plan.event_id)!;
    for (const event of sequence.members) {
      const impactTime = outputImpactUs(event, plan.in_us, plan.out_us, cursor, fps);
      const beat = nearestBeat(impactTime, project, usedBeatMarkerIds);
      if (beat && beat.error <= 80_000) {
        beatTargets.push({ marker_id: beat.marker.marker_id, impact_event_id: event.event_id,
          intended_time_us: beat.marker.time_us });
        usedBeatMarkerIds.add(beat.marker.marker_id);
      }
    }
    cursor += durationToFrames(plan.out_us - plan.in_us, fps);
  }
  const maxZoom = Math.round(Math.min(1.08, 1 + 0.08 * project.settings.effects_intensity) * 10000) / 10000;
  return {
    schema_version: 1, proposal_id: crypto.randomUUID(), source: 'rule_only',
    selected_event_ids: candidates.map(event => event.event_id), clip_plans: clipPlans,
    beat_targets: beatTargets,
    effects: project.settings.effects_intensity > 0 ? ordered.map(sequence => ({ event_id: sequence.representative.event_id,
      type: 'impact_zoom' as const, max_zoom: maxZoom })) : [],
    rationale: [
      'Dipilih hanya dari event yang dianotasi pengguna; tidak ada deteksi kill otomatis.',
      `Urutan membangun energi dari skor manual; ${candidates.length} impact ditempatkan dalam ${sequences.length} sequence tanpa mengulang jendela footage yang nyaris sama.`,
      'Jendela dari rekaman yang sama hanya digabung jika semua impact tetap terlihat di klip sequence.',
      candidates.length < rawCandidates.length
        ? `${rawCandidates.length - candidates.length} deteksi upstream yang menunjuk kill-feed row dan rentang shot yang sama dihapus sebagai duplikat.`
        : 'Tidak ada dua kandidat upstream yang menunjuk kill-feed row dan rentang shot yang sama.',
      'Beat target hanya dicantumkan jika dampak kill sudah berjarak paling jauh 80 ms dari marker musik.',
    ],
    confidence: Math.round(candidates.reduce((sum, event) => sum + event.confidence, 0) / candidates.length * 1000) / 1000,
    warnings: candidates.some(event => event.owner === 'unknown') ? ['Satu atau lebih event masih owner=unknown; konfirmasi sebelum render.'] : [],
    status: 'proposal_needs_user_review',
  };
}

interface EventSequence { members: HighlightEvent[]; representative: HighlightEvent; score: number; }

function upstreamShot(event: HighlightEvent) {
  return event.evidence.find(item => item.type === 'upstream_kill_candidate') ?? null;
}

function duplicateUpstreamShot(left: HighlightEvent, right: HighlightEvent): boolean {
  if (left.source_media_id !== right.source_media_id) return false;
  const a = upstreamShot(left);
  const b = upstreamShot(right);
  if (!a || !b || !Number.isSafeInteger(a.feed_frame) || !Number.isSafeInteger(b.feed_frame)
    || !Number.isSafeInteger(a.working_frame_60) || !Number.isSafeInteger(b.working_frame_60)) return false;
  return Math.abs(Number(a.feed_frame) - Number(b.feed_frame)) <= 1
    && Math.abs(Number(a.working_frame_60) - Number(b.working_frame_60)) <= 6;
}

function upstreamShotQuality(event: HighlightEvent, weights: Record<string, number>): number {
  const evidence = upstreamShot(event);
  const verification = evidence?.shot_verification as Record<string, unknown> | undefined;
  const rank = evidence?.kill_rank as Record<string, unknown> | undefined;
  const verified = evidence?.upstream_verified === true || verification?.verdict === 'verified' ? 1 : 0;
  const rankScore = typeof rank?.score === 'number' ? rank.score : 0;
  return verified * 1_000_000 + rankScore * 100 + eventScore(event, weights) * 10 + event.confidence;
}

function removeDuplicateUpstreamShots(events: HighlightEvent[], weights: Record<string, number>): HighlightEvent[] {
  const ranked = [...events].sort((a, b) => upstreamShotQuality(b, weights) - upstreamShotQuality(a, weights)
    || a.source_time_us - b.source_time_us || a.event_id.localeCompare(b.event_id));
  const kept: HighlightEvent[] = [];
  for (const event of ranked) {
    if (!kept.some(other => duplicateUpstreamShot(event, other))) kept.push(event);
  }
  const keptIds = new Set(kept.map(event => event.event_id));
  return events.filter(event => keptIds.has(event.event_id));
}

function eventOverlapRatio(a: HighlightEvent, b: HighlightEvent): number {
  const shorter = Math.min(a.out_us - a.in_us, b.out_us - b.in_us);
  if (shorter <= 0) return 0;
  return Math.max(0, Math.min(a.out_us, b.out_us) - Math.max(a.in_us, b.in_us)) / shorter;
}

function groupCandidateSequences(events: HighlightEvent[], weights: Record<string, number>): EventSequence[] {
  const groups: HighlightEvent[][] = [];
  const sorted = [...events].sort((a, b) => a.source_media_id.localeCompare(b.source_media_id)
    || a.in_us - b.in_us || a.source_time_us - b.source_time_us || a.event_id.localeCompare(b.event_id));
  for (const event of sorted) {
    const matching = groups.filter(group => group.some(other => other.source_media_id === event.source_media_id
      && eventOverlapRatio(other, event) >= 0.8));
    if (!matching.length) {
      groups.push([event]);
      continue;
    }
    matching[0].push(event);
    for (const extra of matching.slice(1)) {
      matching[0].push(...extra);
      groups.splice(groups.indexOf(extra), 1);
    }
  }
  return groups.flatMap(members => {
    if (members.length === 1) {
      const event = members[0];
      return [{ members, representative: event, score: eventScore(event, weights) }];
    }
    const covering = members.filter(candidate => members.every(event =>
      candidate.in_us <= event.source_time_us && event.source_time_us <= candidate.out_us));
    if (!covering.length) return members.map(event => ({ members: [event], representative: event, score: eventScore(event, weights) }));
    covering.sort((a, b) => eventScore(b, weights) - eventScore(a, weights)
      || Math.abs(a.source_time_us - (members[0].source_time_us + members.at(-1)!.source_time_us) / 2)
        - Math.abs(b.source_time_us - (members[0].source_time_us + members.at(-1)!.source_time_us) / 2)
      || a.event_id.localeCompare(b.event_id));
    const score = Math.max(...members.map(event => eventScore(event, weights)))
      + Math.min(0.3, (members.length - 1) * 0.15);
    return [{ members: [...members].sort((a, b) => a.source_time_us - b.source_time_us
      || a.event_id.localeCompare(b.event_id)), representative: covering[0], score }];
  });
}

export function validateAIProposal(raw: unknown, project: Project): DirectorProposal {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DirectorValidationError('Respons harus berupa JSON object.');
  const value = raw as Record<string, unknown>;
  const allowedFields = new Set(['schema_version', 'selected_event_ids', 'clip_plans', 'beat_targets', 'effects', 'rationale', 'confidence', 'warnings']);
  if (value.schema_version !== 1) throw new DirectorValidationError('Proposal harus menggunakan schema_version 1.');
  if (Object.keys(value).some(key => !allowedFields.has(key))) throw new DirectorValidationError('Proposal memiliki field yang tidak diizinkan.');
  const strings = (input: unknown, field: string, max: number): string[] => {
    if (!Array.isArray(input) || input.length > max || input.some(item => typeof item !== 'string' || item.length > 500)) {
      throw new DirectorValidationError(`${field} harus berisi string singkat.`);
    }
    return input as string[];
  };
  const selected = strings(value.selected_event_ids, 'selected_event_ids', 250);
  const rationale = strings(value.rationale, 'rationale', 12);
  const warnings = strings(value.warnings ?? [], 'warnings', 20);
  if (!selected.length || new Set(selected).size !== selected.length) throw new DirectorValidationError('Event terpilih kosong atau duplikat.');
  const events = new Map(project.events.map(event => [event.event_id, event]));
  if (selected.some(id => !events.has(id))) throw new DirectorValidationError('Proposal merujuk event yang tidak ada di project.');
  const requiredMultiKills = project.events.filter(event => event.confidence >= 0.75 && event.tags.includes('multikill')).map(event => event.event_id);
  if (requiredMultiKills.some(id => !selected.includes(id))) throw new DirectorValidationError('Proposal menghilangkan cluster multikill dengan confidence tinggi.');
  if (!Array.isArray(value.clip_plans) || !value.clip_plans.length || value.clip_plans.length > selected.length) {
    throw new DirectorValidationError('clip_plans harus berisi sequence yang valid untuk event terpilih.');
  }
  const assignedEventIds: string[] = [];
  const clipPlans = value.clip_plans.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new DirectorValidationError(`clip_plans[${index}] tidak valid.`);
    const plan = candidate as Record<string, unknown>;
    const eventId = plan.event_id;
    const inUs = plan.in_us;
    const outUs = plan.out_us;
    const slot = plan.slot;
    if (typeof eventId !== 'string' || !selected.includes(eventId) || !Number.isSafeInteger(inUs) || !Number.isSafeInteger(outUs) || !Number.isSafeInteger(slot)) {
      throw new DirectorValidationError(`clip_plans[${index}] memiliki ID, waktu, atau urutan tidak valid.`);
    }
    const event = events.get(eventId)!;
    if ((inUs as number) < event.in_us || (outUs as number) > event.out_us || (inUs as number) >= (outUs as number)
        || event.source_time_us < (inUs as number) || event.source_time_us > (outUs as number)) {
      throw new DirectorValidationError(`Trim untuk ${eventId} keluar dari range event atau membuang kill impact.`);
    }
    const includedEventIds = plan.included_event_ids === undefined ? [eventId]
      : strings(plan.included_event_ids, `clip_plans[${index}].included_event_ids`, 250);
    if (!includedEventIds.length || !includedEventIds.includes(eventId)
        || new Set(includedEventIds).size !== includedEventIds.length
        || includedEventIds.some(id => !selected.includes(id))) {
      throw new DirectorValidationError(`clip_plans[${index}] memiliki included_event_ids yang tidak valid.`);
    }
    for (const includedId of includedEventIds) {
      const member = events.get(includedId)!;
      if (member.source_media_id !== event.source_media_id
          || member.source_time_us < (inUs as number) || member.source_time_us > (outUs as number)) {
        throw new DirectorValidationError(`Sequence ${eventId} tidak mencakup impact event ${includedId} pada source yang sama.`);
      }
    }
    assignedEventIds.push(...includedEventIds);
    return { event_id: eventId, included_event_ids: includedEventIds,
      in_us: inUs as number, out_us: outUs as number, slot: slot as number };
  });
  if (new Set(assignedEventIds).size !== assignedEventIds.length
      || new Set(assignedEventIds).size !== selected.length || selected.some(id => !assignedEventIds.includes(id))
      || new Set(clipPlans.map(plan => plan.event_id)).size !== clipPlans.length
      || new Set(clipPlans.map(plan => plan.slot)).size !== clipPlans.length
      || clipPlans.some(plan => plan.slot < 0 || plan.slot >= clipPlans.length)) {
    throw new DirectorValidationError('Clip plan duplikat atau urutan slot tidak berurutan.');
  }
  const sortedPlans = [...clipPlans].sort((a, b) => a.slot - b.slot);
  const markers = new Map((project.music?.beat_grid ?? []).map(marker => [marker.marker_id, marker]));
  if (!Array.isArray(value.beat_targets) || value.beat_targets.length > selected.length) throw new DirectorValidationError('beat_targets tidak valid.');
  let frameCursor = 0;
  const impactTimes = new Map<string, number>();
  const fps = FPS[project.settings.output_profile];
  for (const plan of sortedPlans) {
    for (const eventId of plan.included_event_ids ?? [plan.event_id]) {
      const event = events.get(eventId)!;
      impactTimes.set(eventId, outputImpactUs(event, plan.in_us, plan.out_us, frameCursor, fps));
    }
    frameCursor += durationToFrames(plan.out_us - plan.in_us, fps);
  }
  const beatTargets = value.beat_targets.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new DirectorValidationError(`beat_targets[${index}] tidak valid.`);
    const target = candidate as Record<string, unknown>;
    const markerId = target.marker_id;
    const eventId = target.impact_event_id;
    if (typeof markerId !== 'string' || typeof eventId !== 'string' || !selected.includes(eventId)) throw new DirectorValidationError('Beat target merujuk marker atau event yang tidak dikenal.');
    const marker = markers.get(markerId);
    if (!marker || marker.kind !== 'measured_attack' || target.intended_time_us !== marker.time_us) {
      throw new DirectorValidationError('Beat target harus memakai measured attack asli dari project.');
    }
    const impactTime = impactTimes.get(eventId)!;
    const musicTime = marker.time_us - Math.max(0, project.music?.offset_us ?? 0);
    if (Math.abs(impactTime - musicTime) > 80_000) throw new DirectorValidationError('Beat target berada di luar toleransi 80 ms.');
    return { marker_id: markerId, impact_event_id: eventId, intended_time_us: marker.time_us };
  });
  if (new Set(beatTargets.map(target => target.impact_event_id)).size !== beatTargets.length) {
    throw new DirectorValidationError('Beat target duplikat untuk event yang sama.');
  }
  if (new Set(beatTargets.map(target => target.marker_id)).size !== beatTargets.length) {
    throw new DirectorValidationError('Measured attack yang sama tidak boleh dipakai untuk lebih dari satu impact.');
  }
  const confidence = value.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new DirectorValidationError('confidence harus berada pada rentang 0..1.');
  if (!Array.isArray(value.effects) || value.effects.length > selected.length) throw new DirectorValidationError('effects tidak valid.');
  const effects = value.effects.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new DirectorValidationError(`effects[${index}] tidak valid.`);
    const effect = candidate as Record<string, unknown>;
    const maxAllowedZoom = Math.min(1.08, 1 + 0.08 * project.settings.effects_intensity);
    if (!selected.includes(String(effect.event_id)) || effect.type !== 'impact_zoom'
        || typeof effect.max_zoom !== 'number' || effect.max_zoom < 1 || effect.max_zoom > maxAllowedZoom) {
      throw new DirectorValidationError('Effect bukan Smooth/Clean yang diizinkan atau parameternya melewati intensity project.');
    }
    return { event_id: effect.event_id as string, type: 'impact_zoom' as const, max_zoom: effect.max_zoom };
  });
  if (new Set(effects.map(effect => effect.event_id)).size !== effects.length) throw new DirectorValidationError('Effect ganda untuk event yang sama.');
  if (!rationale.length) throw new DirectorValidationError('Proposal harus memberi alasan singkat.');
  return { schema_version: 1, proposal_id: crypto.randomUUID(), source: 'chatgpt', selected_event_ids: selected,
    clip_plans: clipPlans, beat_targets: beatTargets, effects, rationale, confidence,
    warnings, status: 'proposal_needs_user_review' };
}
