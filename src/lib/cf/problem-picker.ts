/**
 * Pure, deterministic problem picker for races. No I/O and no `Math.random` —
 * callers supply `seed` (e.g. derived from the race id) so a pick can be
 * reproduced and unit-tested. All candidate fetching lives in
 * `problem-repo.ts`; this module only ranks/filters/selects.
 */

import type { ProblemId, ProblemRef } from "@/lib/types";

/** Initial band: [target - LOW_OFFSET, target + HIGH_OFFSET]. */
const BAND_LOW_OFFSET = 100;
const BAND_HIGH_OFFSET = 200;

/** Each retry on an empty band grows both sides by this much. */
const WIDEN_STEP = 100;

/** Give up after this many widenings (bounds the final band width). */
const MAX_WIDEN_ATTEMPTS = 5;

export interface PickProblemOptions {
  candidates: ProblemRef[];
  seenIds: Set<ProblemId>;
  p1Rating: number | null;
  p2Rating: number | null;
  /** Caller-provided seed for deterministic, reproducible selection. */
  seed: number;
}

/**
 * Target rating for a race between two players: the average of their
 * ratings (unrated players default to 1200), rounded to the nearest 100.
 */
export function targetRating(p1Rating: number | null, p2Rating: number | null): number {
  const r1 = p1Rating ?? 1200;
  const r2 = p2Rating ?? 1200;
  return Math.round((r1 + r2) / 2 / 100) * 100;
}

function inBand(rating: number, target: number, widen: number): boolean {
  return rating >= target - BAND_LOW_OFFSET - widen && rating <= target + BAND_HIGH_OFFSET + widen;
}

/**
 * Deterministic PRNG (mulberry32) seeded by `seed`. Never uses `Math.random`
 * so the same seed + candidate set always produces the same pick.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks a fair, unseen problem for a race.
 *
 * 1. Compute `target = targetRating(p1Rating, p2Rating)`.
 * 2. Filter out seen problems, then filter to the rating band
 *    `[target - 100, target + 200]`.
 * 3. If the band is empty, widen it by ±100 and retry, up to
 *    `MAX_WIDEN_ATTEMPTS` times.
 * 4. Pick deterministically among the surviving candidates using `seed`.
 *
 * Returns `null` if no candidate is found even after widening.
 */
export function pickProblem(opts: PickProblemOptions): ProblemRef | null {
  const { candidates, seenIds, p1Rating, p2Rating, seed } = opts;
  const target = targetRating(p1Rating, p2Rating);
  const unseen = candidates.filter((candidate) => !seenIds.has(candidate.id));
  const rand = seededRandom(seed);

  for (let attempt = 0; attempt <= MAX_WIDEN_ATTEMPTS; attempt++) {
    const widen = attempt * WIDEN_STEP;
    const inWindow = unseen.filter((candidate) => inBand(candidate.rating, target, widen));
    if (inWindow.length === 0) {
      continue;
    }
    // Sort by id first so the pick is stable regardless of the candidates'
    // input order (DB result order is not guaranteed).
    const sorted = [...inWindow].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const index = Math.floor(rand() * sorted.length);
    return sorted[index];
  }

  return null;
}
