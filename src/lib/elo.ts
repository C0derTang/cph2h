/**
 * ELO rating calculation for cph2h races.
 * Pure functions for computing expected scores and rating deltas.
 */

import {
  ELO_K_PROVISIONAL,
  ELO_K_STANDARD,
  ELO_FLOOR,
  PROVISIONAL_RACES,
  type RaceOutcome,
} from "./types";

/**
 * Calculate the expected score for a player with rating `a` against rating `b`.
 * Formula: 1 / (1 + 10^((b-a)/400))
 */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/**
 * Determine the K-factor based on races played.
 * Returns ELO_K_PROVISIONAL (64) if racesPlayed < PROVISIONAL_RACES (10),
 * else ELO_K_STANDARD (32).
 */
export function kFor(racesPlayed: number): number {
  return racesPlayed < PROVISIONAL_RACES ? ELO_K_PROVISIONAL : ELO_K_STANDARD;
}

/**
 * Apply race result and compute ELO deltas for both players.
 * Returns {d1, d2} where d1 is player 1's delta and d2 is player 2's delta.
 *
 * - Aborted races return {0, 0}.
 * - Scores: 1 for win, 0 for loss, 0.5 for draw.
 * - Each player uses their own K-factor.
 * - Final rating never drops below ELO_FLOOR (100).
 * - Deltas are rounded.
 */
export function applyResult(
  p1: { elo: number; racesPlayed: number },
  p2: { elo: number; racesPlayed: number },
  outcome: RaceOutcome
): { d1: number; d2: number } {
  if (outcome === "aborted") {
    return { d1: 0, d2: 0 };
  }

  // Determine scores based on outcome
  let p1Score: number;
  let p2Score: number;

  switch (outcome) {
    case "p1_win":
      p1Score = 1;
      p2Score = 0;
      break;
    case "p2_win":
      p1Score = 0;
      p2Score = 1;
      break;
    case "draw":
      p1Score = 0.5;
      p2Score = 0.5;
      break;
    default:
      const _exhaustive: never = outcome;
      return _exhaustive;
  }

  // Get K-factors
  const k1 = kFor(p1.racesPlayed);
  const k2 = kFor(p2.racesPlayed);

  // Calculate expected scores
  const exp1 = expectedScore(p1.elo, p2.elo);
  const exp2 = expectedScore(p2.elo, p1.elo);

  // Calculate raw deltas
  const rawD1 = k1 * (p1Score - exp1);
  const rawD2 = k2 * (p2Score - exp2);

  // Round deltas
  const d1 = Math.round(rawD1);
  const d2 = Math.round(rawD2);

  // Clamp deltas to ensure final rating never drops below ELO_FLOOR
  const clampedD1 = Math.max(d1, ELO_FLOOR - p1.elo);
  const clampedD2 = Math.max(d2, ELO_FLOOR - p2.elo);

  return { d1: clampedD1, d2: clampedD2 };
}
