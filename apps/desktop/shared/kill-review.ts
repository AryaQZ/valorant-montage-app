import type { AIKillReview, KillCandidate } from './bridge.js';

export const MAX_AI_KILL_CANDIDATES = 250;

export function killReviewMetadata(candidates: KillCandidate[]) {
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > MAX_AI_KILL_CANDIDATES) {
    throw new Error(`Tinjauan AI menerima 1–${MAX_AI_KILL_CANDIDATES} kandidat per permintaan.`);
  }
  const ids = new Set<string>();
  return { candidates: candidates.map((candidate, index) => {
    if (!candidate || typeof candidate.candidate_id !== 'string' || ids.has(candidate.candidate_id)
        || !Number.isSafeInteger(candidate.source_time_us) || candidate.source_time_us < 0
        || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
      throw new Error('Metadata kandidat kill tidak valid.');
    }
    ids.add(candidate.candidate_id);
    const method = typeof candidate.method === 'string' ? candidate.method.toLowerCase() : '';
    return {
      index,
      source_time_us: candidate.source_time_us,
      confidence: candidate.confidence,
      verified_shot: candidate.verified_by_upstream === true,
      needs_ownership_review: candidate.requires_ownership_review === true,
      ammo_signal: method.includes('ammo'),
      flash_signal: method.includes('flash'),
      audio_signal: method.includes('audio'),
      headshot_suggested: Array.isArray(candidate.suggested_tags) && candidate.suggested_tags.includes('headshot'),
    };
  }) };
}

export function parseJsonOnly(text: string): unknown {
  let trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  if (fenced) trimmed = fenced[1].trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error('The response was not valid JSON.');
  }
}

export function validateKillReview(value: unknown, candidates: KillCandidate[]): AIKillReview[] {
  const reviews = (value as { reviews?: unknown })?.reviews;
  if (!Array.isArray(reviews) || reviews.length !== candidates.length) throw new Error('Tinjauan AI tidak memuat daftar kandidat yang lengkap.');
  const seen = new Set<number>();
  return reviews.map(row => {
    const index = row?.index;
    const priority = row?.priority;
    if (!Number.isSafeInteger(index) || index < 0 || index >= candidates.length || seen.has(index)
        || (priority !== 'prioritize' && priority !== 'check_again')) {
      throw new Error('Tinjauan AI mengandung kandidat atau prioritas yang tidak valid.');
    }
    seen.add(index);
    return { candidateId: candidates[index].candidate_id, priority };
  });
}
