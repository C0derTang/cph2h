/**
 * Format race outcome (W/L/D) based on race result.
 */
export function formatOutcome(outcome: string | null): string {
  if (!outcome) return "Pending";
  if (outcome === "draw") return "Draw";
  // For p1_win and p2_win, caller must determine perspective
  return "Unknown";
}

/**
 * Format Elo delta as signed string (e.g., +15, -5, —).
 */
export function formatEloDelta(delta: number | null): string {
  if (delta === null) return "—";
  return delta >= 0 ? `+${delta}` : `${delta}`;
}
