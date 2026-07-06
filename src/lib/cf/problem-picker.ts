/**
 * Pure, deterministic problem picker for races. No I/O and no `Math.random` —
 * callers supply `seed` (e.g. derived from the race id) so a pick can be
 * reproduced and unit-tested. All candidate fetching lives in
 * `problem-repo.ts`; this module only ranks/filters/selects.
 */

import type {
  ProblemId,
  ProblemRef,
  ProblemSelectionFailureReason,
} from "@/lib/types";

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
  /**
   * Hard rating-filter bounds from the challenger's filters (null = no
   * constraint). Widening never escapes `[ratingMin, ratingMax]`, and only
   * problems inside these bounds are ever eligible — so a rating-filtered race
   * can never pick a non-conforming problem.
   */
  ratingMin?: number | null;
  ratingMax?: number | null;
}

/**
 * Result of a pick: either a conforming problem, or a discriminated failure
 * reason (`no_problems_in_filters` when nothing in the eligible range exists at
 * all; `all_problems_seen` when eligible problems exist but every one has been
 * attempted by a player). Mirrors {@link SelectProblemResult} minus the I/O.
 */
export type PickProblemResult =
  | { ok: true; problem: ProblemRef }
  | { ok: false; reason: ProblemSelectionFailureReason };

/**
 * Target rating for a race between two players: the average of their
 * ratings (unrated players default to 1200), rounded to the nearest 100.
 */
export function targetRating(p1Rating: number | null, p2Rating: number | null): number {
  const r1 = p1Rating ?? 1200;
  const r2 = p2Rating ?? 1200;
  return Math.round((r1 + r2) / 2 / 100) * 100;
}

/** Deterministic pick among `pool` using `rand`; stable regardless of input order. */
function pickDeterministic(pool: ProblemRef[], rand: () => number): ProblemRef {
  // Sort by id first so the pick is stable regardless of the candidates'
  // input order (DB result order is not guaranteed).
  const sorted = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index = Math.floor(rand() * sorted.length);
  return sorted[index];
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
 * Picks a fair, unseen problem for a race, honoring the challenger's hard
 * rating filter.
 *
 * 1. Compute `target = targetRating(p1Rating, p2Rating)`.
 * 2. Restrict to *eligible* candidates: those within `[ratingMin, ratingMax]`
 *    when set. If none exist at all → `no_problems_in_filters`.
 * 3. Drop seen problems. If nothing unseen remains → `all_problems_seen`.
 * 4. Prefer problems near the target: filter to `[target-100, target+200]`,
 *    widening by ±100 up to `MAX_WIDEN_ATTEMPTS` times — the band is always
 *    clamped so it never escapes `[ratingMin, ratingMax]`.
 * 5. When a rating filter is set and target-proximity finds nothing (an unseen
 *    conforming problem exists but lies outside the target's widening reach),
 *    fall back to any unseen eligible problem so the race can still start with
 *    a conforming problem. Without a rating filter, the widening reach is the
 *    whole eligible universe, so this fallback never triggers — an out-of-band
 *    problem is intentionally *not* forced onto a mismatched race.
 */
export function pickProblem(opts: PickProblemOptions): PickProblemResult {
  const { candidates, seenIds, p1Rating, p2Rating, seed } = opts;
  const ratingMin = opts.ratingMin ?? null;
  const ratingMax = opts.ratingMax ?? null;
  const hasRatingFilter = ratingMin !== null || ratingMax !== null;
  const target = targetRating(p1Rating, p2Rating);
  const rand = seededRandom(seed);

  // Only problems inside the hard rating filter are ever eligible.
  const eligible = candidates.filter(
    (c) =>
      (ratingMin === null || c.rating >= ratingMin) &&
      (ratingMax === null || c.rating <= ratingMax),
  );
  if (eligible.length === 0) {
    return { ok: false, reason: "no_problems_in_filters" };
  }

  const unseen = eligible.filter((candidate) => !seenIds.has(candidate.id));
  if (unseen.length === 0) {
    return { ok: false, reason: "all_problems_seen" };
  }

  for (let attempt = 0; attempt <= MAX_WIDEN_ATTEMPTS; attempt++) {
    const widen = attempt * WIDEN_STEP;
    let lo = target - BAND_LOW_OFFSET - widen;
    let hi = target + BAND_HIGH_OFFSET + widen;
    // Clamp the band so widening never escapes the hard filter bounds.
    if (ratingMin !== null) lo = Math.max(lo, ratingMin);
    if (ratingMax !== null) hi = Math.min(hi, ratingMax);
    const inWindow = unseen.filter((c) => c.rating >= lo && c.rating <= hi);
    if (inWindow.length === 0) {
      continue;
    }
    return { ok: true, problem: pickDeterministic(inWindow, rand) };
  }

  // Rating-filtered race with an unseen conforming problem outside the target's
  // widening reach — still start, on any conforming problem.
  if (hasRatingFilter) {
    return { ok: true, problem: pickDeterministic(unseen, rand) };
  }

  // Filterless: unseen problems exist but all lie outside the acceptable
  // rating window around the target — treat as "nothing in range".
  return { ok: false, reason: "no_problems_in_filters" };
}
