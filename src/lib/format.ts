import type { RaceOutcome } from "@/lib/types";

/**
 * Format a race outcome as Win/Loss/Draw from a given player's perspective.
 *
 * @param outcome the race outcome ("p1_win" | "p2_win" | "draw" | "aborted") or null
 * @param isP1 whether the player we're formatting for is player 1 of the race
 */
export function formatOutcome(
  outcome: RaceOutcome | null,
  isP1: boolean,
): string {
  if (!outcome) return "Pending";
  if (outcome === "draw") return "Draw";
  if (outcome === "aborted") return "Aborted";
  if (outcome === "p1_win") return isP1 ? "Win" : "Loss";
  if (outcome === "p2_win") return isP1 ? "Loss" : "Win";
  return "Unknown";
}

/**
 * Format Elo delta as signed string (e.g., +15, -5, —).
 */
export function formatEloDelta(delta: number | null): string {
  if (delta === null) return "—";
  return delta >= 0 ? `+${delta}` : `${delta}`;
}
