/**
 * Pure victory/defeat overlay transition detector (issue #113).
 *
 * The race-end overlay is a game-like, unmissable notification shown the
 * moment a race a player is *watching* ends — it must fire ONLY on an observed
 * live transition out of `active` into a terminal state, never on a direct
 * navigation onto an already-finished race (there is no transition to observe,
 * so the persistent {@link ResultCard} is enough).
 *
 * This module is the pure decision core: given the status the client last saw
 * and the freshly-received snapshot, it returns which overlay (if any) to show.
 * The snapshot — never a trusted LiveKit event payload — is the source of
 * truth for the outcome (`winnerId`/`outcome`), per the "events are hints"
 * architecture rule.
 */

import type { RaceSnapshot, RaceStatus } from "@/lib/types";

export type OverlayOutcome = "victory" | "defeat" | "draw" | "none";

/**
 * Decide the overlay to show for a snapshot receipt.
 *
 * @param prevStatus The status the client last rendered (null = never seen).
 * @param next       The freshly-received snapshot (source of truth).
 * @param youId      The viewer's `users.id`.
 *
 * Returns `"none"` unless this is a live `active → finished|aborted`
 * transition. On such a transition the outcome is derived from the snapshot:
 * a `draw` outcome (or a terminal race with no winner) → `"draw"`, otherwise
 * `"victory"` when the viewer is the winner and `"defeat"` when they are not.
 * A forfeit is not a distinct return value — a forfeit win/loss is still a
 * victory/defeat (the display layer varies its copy off the snapshot).
 */
export function detectOverlayOutcome(
  prevStatus: RaceStatus | null,
  next: RaceSnapshot,
  youId: string,
): OverlayOutcome {
  // Only a transition *out of* active counts — a direct load onto a finished
  // race (prevStatus is already terminal, or null) shows nothing.
  if (prevStatus !== "active") return "none";
  if (next.status !== "finished" && next.status !== "aborted") return "none";

  if (next.outcome === "draw") return "draw";
  if (next.winnerId == null) return "draw";
  return next.winnerId === youId ? "victory" : "defeat";
}
