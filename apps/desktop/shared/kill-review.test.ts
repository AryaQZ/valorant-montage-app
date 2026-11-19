import { describe, expect, it } from 'vitest';
import type { KillCandidate } from './bridge.js';
import { killReviewMetadata, validateKillReview } from './kill-review.js';
import { isolatedKillWindow } from './project.js';

const candidate: KillCandidate = {
  candidate_id: 'internal-id-private',
  source_media_id: 'private-source',
  source_time_us: 24_200_000,
  source_frame: 1452,
  in_us: 22_200_000,
  out_us: 25_450_000,
  confidence: 0.74,
  confidence_label: 'medium',
  method: 'ammo/private-recording.mp4',
  feed_frame: 1461,
  verified_by_upstream: true,
  suggested_tags: ['headshot'],
  requires_user_review: true,
  requires_ownership_review: true,
  evidence: [{ review_sheet: 'local-screenshot.jpg' }],
};
const candidates = [candidate, { ...candidate, candidate_id: 'second', source_time_us: 25_666_667 }];

describe('AI kill review', () => {
  it('sends only allowlisted numeric and boolean signals', () => {
    const metadata = killReviewMetadata([candidate]);
    expect(metadata).toEqual({ candidates: [{ index: 0, source_time_us: 24_200_000, confidence: 0.74,
      verified_shot: true, needs_ownership_review: true, ammo_signal: true, flash_signal: false,
      audio_signal: false, headshot_suggested: true }] });
  });

  it('maps AI order back to the original candidates without accepting new or repeated entries', () => {
    expect(validateKillReview({ reviews: [{ index: 1, priority: 'prioritize' }, { index: 0, priority: 'check_again' }] }, candidates))
      .toEqual([{ candidateId: 'second', priority: 'prioritize' }, { candidateId: candidate.candidate_id, priority: 'check_again' }]);
    for (const index of [0, 2]) {
      expect(() => validateKillReview({ reviews: [{ index: 0, priority: 'prioritize' }, { index, priority: 'check_again' }] }, candidates)).toThrow();
    }
    expect(() => validateKillReview({ reviews: [{ index: 0, priority: 'prioritize' }] }, candidates)).toThrow();
  });
});

it('splits nearby unconfirmed candidates before preview or confirmation', () => {
  const first = candidates[0];
  const second = { ...candidates[1], in_us: 23_666_667, out_us: 26_916_667 };
  const unrelated = { ...first, source_media_id: 'other-recording', source_time_us: 25_600_000 };
  const neighbors = [second, unrelated, first];

  expect(isolatedKillWindow(first, neighbors)).toEqual({ inUs: 22_200_000, outUs: 24_933_334 });
  expect(isolatedKillWindow(second, neighbors)).toEqual({ inUs: 24_933_334, outUs: 26_916_667 });
});
