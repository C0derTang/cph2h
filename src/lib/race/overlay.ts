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

import type { RaceSnapshot, RaceStatus, RaceSubmissionInfo } from "@/lib/types";

export type OverlayOutcome = "victory" | "defeat" | "draw" | "none";

/**
 * Decide the overlay to show for a snapshot receipt.
 *
 * @param prevStatus The status the client last rendered (null = never seen).
 * @param next       The freshly-received snapshot (source of truth).
 * @param youId      The viewer's `users.id`.
 *
 * Returns `"none"` unless this is a live `active → finished|aborted`
 * transition, OR (issue #276) a live `ready → finished` transition with a
 * winner — the matchmade walkover slam: one player readied up, the other
 * didn't, the deadline passed, and the walkover winner never actually entered
 * `active`. On such a transition the outcome is derived from the snapshot: a
 * `draw` outcome (or a terminal race with no winner) → `"draw"`, otherwise
 * `"victory"` when the viewer is the winner and `"defeat"` when they are not.
 * A forfeit is not a distinct return value — a forfeit win/loss is still a
 * victory/defeat (the display layer varies its copy off the snapshot).
 *
 * `ready → aborted` (the double-timeout, nobody-readied-up case) must NOT
 * fire this overlay — there is no winner to slam, just a quiet cancellation.
 */
export function detectOverlayOutcome(
  prevStatus: RaceStatus | null,
  next: RaceSnapshot,
  youId: string,
): OverlayOutcome {
  const isActiveTerminalTransition =
    prevStatus === "active" && (next.status === "finished" || next.status === "aborted");
  const isWalkoverSlam =
    prevStatus === "ready" && next.status === "finished" && next.winnerId != null;

  if (!isActiveTerminalTransition && !isWalkoverSlam) return "none";

  if (next.outcome === "draw") return "draw";
  if (next.winnerId == null) return "draw";
  return next.winnerId === youId ? "victory" : "defeat";
}

export function winnerHasAcceptedSubmission(
  winnerId: string | null,
  submissions: RaceSubmissionInfo[],
): boolean {
  return (
    winnerId != null &&
    submissions.some((s) => s.userId === winnerId && s.verdict === "OK")
  );
}
