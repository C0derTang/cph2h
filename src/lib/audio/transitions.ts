/**
 * Pure race-audio transition detector (issue #112).
 *
 * Diffs two consecutive `RaceSnapshot`s (as received by `RaceAudio.tsx`) and
 * returns the list of SFX names that should fire for that transition. Kept
 * pure and side-effect-free (no `AudioContext`, no `Date.now()`) so it is
 * exhaustively unit-testable without a DOM.
 *
 * `prev === null` (the very first snapshot a mount ever sees — including a
 * fresh mount on an already-`finished` race) never produces any SFX: every
 * event here is a *transition*, and there is nothing to transition from yet.
 * This also makes the detector naturally idempotent/no-repeat on identical
 * snapshots (an unchanged snapshot passed as both `prev` and `next` diffs to
 * nothing).
 *
 * Countdown ticks are deliberately NOT part of this diff — they're driven by
 * a local per-second timer in `RaceAudio.tsx` (snapshots only arrive every
 * few seconds via the poll loop, not every second), keyed off the derived
 * `active && now < startedAt` countdown. This detector only covers the
 * *boundary* (countdown ending → `race_start`), which is diffable between two
 * snapshots.
 */

import type { RaceSnapshot, RaceSubmissionInfo } from "@/lib/types";
import type { SfxName } from "@/lib/audio/sfx";

/** True while a snapshot's own countdown is still running (per its own `now`). */
function isCountingDown(snapshot: RaceSnapshot): boolean {
  if (snapshot.status !== "active" || !snapshot.startedAt) return false;
  return Date.parse(snapshot.now) < Date.parse(snapshot.startedAt);
}

/** True once the race is active and the countdown (per the snapshot's own `now`) has ended. */
function isPostCountdownActive(snapshot: RaceSnapshot): boolean {
  return snapshot.status === "active" && snapshot.startedAt != null && !isCountingDown(snapshot);
}

/** Identity for a submission across snapshots: the CF submission id, when known. */
function submissionKey(s: RaceSubmissionInfo): string {
  return s.cfSubmissionId != null ? `cf:${s.cfSubmissionId}` : `${s.userId}:${s.submittedAt}`;
}

function isAccepted(verdict: string | null): boolean {
  return verdict === "OK" || verdict === "ACCEPTED";
}

/**
 * `(prevSnapshot, nextSnapshot, youId) => SfxName[]`
 *
 * - `opponent_joined`: `p2` was absent, now present.
 * - `race_start`: the countdown was running (or the race hadn't started yet)
 *   and is now over — fires exactly once at the boundary.
 * - `verdict_ok` / `verdict_fail`: a submission's verdict newly resolved
 *   (either a brand-new submission or one that was previously pending).
 * - `win` / `lose`: status just flipped to `finished` with a winner — `win`
 *   if `winnerId === youId`, `lose` if it's the opponent. A draw or an
 *   `aborted` race (both `winnerId === null`, or status never reaches
 *   `finished`) produces neither, per spec.
 */
export function detectAudioTransitions(
  prev: RaceSnapshot | null,
  next: RaceSnapshot,
  youId: string,
): SfxName[] {
  if (!prev) return [];

  const sfx: SfxName[] = [];

  if (!prev.p2 && next.p2) {
    sfx.push("opponent_joined");
  }

  if (!isPostCountdownActive(prev) && isPostCountdownActive(next)) {
    sfx.push("race_start");
  }

  const prevByKey = new Map(prev.submissions.map((s) => [submissionKey(s), s]));
  for (const submission of next.submissions) {
    if (submission.verdict == null) continue;
    const before = prevByKey.get(submissionKey(submission));
    if (before && before.verdict != null) continue; // already announced
    sfx.push(isAccepted(submission.verdict) ? "verdict_ok" : "verdict_fail");
  }

  if (prev.status !== "finished" && next.status === "finished") {
    if (next.winnerId === youId) {
      sfx.push("win");
    } else if (next.winnerId != null) {
      sfx.push("lose");
    }
    // Draw (winnerId === null) — nothing extra, per spec.
  }

  return sfx;
}
