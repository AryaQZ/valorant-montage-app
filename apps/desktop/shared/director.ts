import type { DirectorProposal, HighlightEvent, Project } from './project.js';
import { durationToFrames, eventScore, FPS } from './project.js';

export class DirectorValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'DirectorValidationError'; }
}

function nearestBeat(timeUs: number, project: Project) {
  const offset = Math.max(0, project.music?.offset_us ?? 0);
  const markers = project.music?.beat_grid ?? [];
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
  const candidates = project.events.filter(event => event.confidence >= 0.4);
  if (!candidates.length) throw new DirectorValidationError('Tambahkan highlight manual sebelum membuat draft.');
  const weights = project.preferences.event_weights;
  const fps = FPS[project.settings.output_profile];
  const ordered: HighlightEvent[] = [];
  const remaining = [...candidates];
  let outputFrame = 0;
  const minScore = Math.min(...remaining.map(event => eventScore(event, weights)));
  const maxScore = Math.max(...remaining.map(event => eventScore(event, weights)));
  while (remaining.length) {
    const position = ordered.length;
    const targetEnergy = minScore + (maxScore - minScore) * (position / Math.max(1, candidates.length - 1));
    const best = remaining.map(event => {
      const energyPenalty = Math.abs(eventScore(event, weights) - targetEnergy) * 0.35;
      const clipFrames = durationToFrames(event.out_us - event.in_us, fps);
      const impactTime = outputImpactUs(event, event.in_us, event.out_us, outputFrame, fps);
      const beat = nearestBeat(impactTime, project);
      const beatPenalty = beat ? project.settings.beat_sync_priority * Math.min(3, beat.error / 80_000) * 0.35 : 0;
      const clusterPenalty = ordered.at(-1)?.cluster_id && ordered.at(-1)?.cluster_id === event.cluster_id ? 0.6 : 0;
      return { event, score: energyPenalty + beatPenalty + clusterPenalty, clipFrames };
    }).sort((a, b) => a.score - b.score || eventScore(b.event, weights) - eventScore(a.event, weights) || a.event.event_id.localeCompare(b.event.event_id));
    const selected = best[0];
    ordered.push(selected.event);
    remaining.splice(remaining.findIndex(event => event.event_id === selected.event.event_id), 1);
    outputFrame += selected.clipFrames;
  }
  let cursor = 0;
  const clipPlans = ordered.map((event, slot) => {
    const plan = { event_id: event.event_id, in_us: event.in_us, out_us: event.out_us, slot };
    const impactTime = outputImpactUs(event, plan.in_us, plan.out_us, cursor, fps);
    cursor += durationToFrames(plan.out_us - plan.in_us, fps);
    return plan;
  });
  cursor = 0;
  const beatTargets: DirectorProposal['beat_targets'] = [];
  for (const plan of clipPlans) {
    const event = ordered.find(item => item.event_id === plan.event_id)!;
    const impactTime = outputImpactUs(event, plan.in_us, plan.out_us, cursor, fps);
    const beat = nearestBeat(impactTime, project);
    if (beat && beat.error <= 80_000) {
      beatTargets.push({ marker_id: beat.marker.marker_id, impact_event_id: event.event_id,
        intended_time_us: beat.marker.time_us });
    }
    cursor += durationToFrames(plan.out_us - plan.in_us, fps);
  }
  const maxZoom = Math.round((1 + 0.04 * project.settings.effects_intensity) * 10000) / 10000;
  return {
    schema_version: 1, proposal_id: crypto.randomUUID(), source: 'rule_only',
    selected_event_ids: ordered.map(event => event.event_id), clip_plans: clipPlans,
    beat_targets: beatTargets,
    effects: project.settings.effects_intensity > 0 ? ordered.map(event => ({ event_id: event.event_id,
      type: 'impact_zoom' as const, max_zoom: maxZoom })) : [],
    rationale: [
      'Dipilih hanya dari event yang dianotasi pengguna; tidak ada deteksi kill otomatis.',
      'Urutan membangun energi dari skor manual, dengan penalti lembut untuk beat dan cluster yang berulang.',
      'Beat target hanya dicantumkan jika dampak kill sudah berjarak paling jauh 80 ms dari marker musik.',
    ],
    confidence: Math.round(ordered.reduce((sum, event) => sum + event.confidence, 0) / ordered.length * 1000) / 1000,
    warnings: ordered.some(event => event.owner === 'unknown') ? ['Satu atau lebih event masih owner=unknown; konfirmasi sebelum render.'] : [],
    status: 'proposal_needs_user_review',
  };
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
  if (!Array.isArray(value.clip_plans) || value.clip_plans.length !== selected.length) throw new DirectorValidationError('Setiap event terpilih harus memiliki satu clip plan.');
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
    return { event_id: eventId, in_us: inUs as number, out_us: outUs as number, slot: slot as number };
  });
  if (new Set(clipPlans.map(plan => plan.event_id)).size !== selected.length
      || new Set(clipPlans.map(plan => plan.slot)).size !== selected.length
      || clipPlans.some(plan => plan.slot < 0 || plan.slot >= selected.length)) {
    throw new DirectorValidationError('Clip plan duplikat atau urutan slot tidak berurutan.');
  }
  const sortedPlans = [...clipPlans].sort((a, b) => a.slot - b.slot);
  const markers = new Map((project.music?.beat_grid ?? []).map(marker => [marker.marker_id, marker]));
  if (!Array.isArray(value.beat_targets) || value.beat_targets.length > selected.length) throw new DirectorValidationError('beat_targets tidak valid.');
  let frameCursor = 0;
  const impactTimes = new Map<string, number>();
  const fps = FPS[project.settings.output_profile];
  for (const plan of sortedPlans) {
    const event = events.get(plan.event_id)!;
    impactTimes.set(plan.event_id, outputImpactUs(event, plan.in_us, plan.out_us, frameCursor, fps));
    frameCursor += durationToFrames(plan.out_us - plan.in_us, fps);
  }
  const beatTargets = value.beat_targets.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new DirectorValidationError(`beat_targets[${index}] tidak valid.`);
    const target = candidate as Record<string, unknown>;
    const markerId = target.marker_id;
    const eventId = target.impact_event_id;
    if (typeof markerId !== 'string' || typeof eventId !== 'string' || !selected.includes(eventId)) throw new DirectorValidationError('Beat target merujuk marker atau event yang tidak dikenal.');
    const marker = markers.get(markerId);
    if (!marker || target.intended_time_us !== marker.time_us) throw new DirectorValidationError('Beat target harus memakai marker asli dari project.');
    const impactTime = impactTimes.get(eventId)!;
    const musicTime = marker.time_us - Math.max(0, project.music?.offset_us ?? 0);
    if (Math.abs(impactTime - musicTime) > 80_000) throw new DirectorValidationError('Beat target berada di luar toleransi 80 ms.');
    return { marker_id: markerId, impact_event_id: eventId, intended_time_us: marker.time_us };
  });
  if (new Set(beatTargets.map(target => target.impact_event_id)).size !== beatTargets.length) {
    throw new DirectorValidationError('Beat target duplikat untuk event yang sama.');
  }
  const confidence = value.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new DirectorValidationError('confidence harus berada pada rentang 0..1.');
  if (!Array.isArray(value.effects) || value.effects.length > selected.length) throw new DirectorValidationError('effects tidak valid.');
  const effects = value.effects.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new DirectorValidationError(`effects[${index}] tidak valid.`);
    const effect = candidate as Record<string, unknown>;
    const maxAllowedZoom = Math.min(1.04, 1 + 0.04 * project.settings.effects_intensity);
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
