/**
 * Pure display helpers for the admin bracket panel (issue #241): round
 * labels, per-round default rating windows for "Create races", and the
 * match-status badge mapping. No I/O — unit-tested directly in
 * tests/admin-bracket-display.test.ts.
 */

import type { VariantProps } from "class-variance-authority";
import type { badgeVariants } from "@/components/ui/badge";
import type { TournamentMatchDTO } from "@/lib/types";

const ROUND_LABELS = ["R64", "R32", "R16", "QF", "SF", "F"] as const;

/** Human label for a 1-based round number. Falls back to `R{n}` out of range. */
export function roundLabel(round: number): string {
  return ROUND_LABELS[round - 1] ?? `R${round}`;
}

/**
 * Per-round default rating window passed to "Create races" — admin-editable
 * in the panel, these are just sane starting points that widen as the
 * bracket narrows (later rounds skew toward stronger competitors).
 */
const DEFAULT_RATING_RANGES: Record<number, { min: number; max: number }> = {
  1: { min: 800, max: 1200 },
  2: { min: 1000, max: 1400 },
  3: { min: 1200, max: 1700 },
  4: { min: 1400, max: 1900 },
  5: { min: 1600, max: 2100 },
  6: { min: 1800, max: 2400 },
};

const FALLBACK_RATING_RANGE = { min: 800, max: 3500 };

export function defaultRatingRange(round: number): { min: number; max: number } {
  return DEFAULT_RATING_RANGES[round] ?? FALLBACK_RATING_RANGE;
}

export type MatchBadgeVariant = VariantProps<typeof badgeVariants>["variant"];

export interface MatchBadge {
  variant: MatchBadgeVariant;
  label: string;
}

/**
 * Status badge for a match row — five buckets: bye / awaiting race / live /
 * done / needs attention.
 *
 * `done` matches: `resolution === "bye"` → Bye, otherwise → Done (race or
 * walkover). `pending` matches: no linked race → Awaiting race; the linked
 * race aborted, or finished in a draw → Needs attention (admin must walk it
 * over or recreate the race); any other linked-race state (ready/active, or
 * finished with a winner not yet pulled in by "Resolve round") → Live.
 */
export function matchStatusBadge(match: TournamentMatchDTO): MatchBadge {
  if (match.status === "done") {
    if (match.resolution === "bye") return { variant: "outline", label: "Bye" };
    return { variant: "verdict-ok", label: "Done" };
  }

  if (!match.raceId) return { variant: "secondary", label: "Awaiting race" };
  if (match.raceStatus === "aborted") {
    return { variant: "verdict-fail", label: "Needs attention" };
  }
  if (match.raceStatus === "finished" && match.raceOutcome === "draw") {
    return { variant: "verdict-fail", label: "Needs attention" };
  }
  return { variant: "verdict-pending", label: "Live" };
}

/** `seed. username (cfHandle)` for a match player slot, `—` when empty. */
export function playerLabel(
  player: TournamentMatchDTO["p1"] | TournamentMatchDTO["p2"],
): string {
  if (!player) return "—";
  return `${player.seed}. ${player.username} (${player.cfHandle ?? "unlinked"})`;
}
