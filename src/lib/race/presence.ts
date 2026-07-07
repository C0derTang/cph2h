/**
 * Pure presence / absence-forfeit helpers (issue #105).
 *
 * A player who closes their tab during an active race loses by forfeit after a
 * grace window (`ABSENCE_FORFEIT_SEC`). Presence is proven server-side by the
 * existing poll traffic: every participant poll stamps the caller's
 * `pN_last_seen_at`. These functions are the shared, exhaustively-testable math
 * behind both the server's authoritative forfeit decision and the client's
 * "they bailed" countdown banner.
 *
 * All functions are pure — no `Date.now()` baked in; callers inject the clock
 * (the client injects a *skew-corrected* now, see `src/lib/race/countdown.ts`).
 * The server decides the forfeit; the client only *displays* the countdown.
 */

import { ABSENCE_FORFEIT_SEC } from "@/lib/types";

/**
 * How long (seconds) the opponent's heartbeat must be stale before the client
 * escalates the generic "disconnected" banner into the absence-forfeit
 * countdown. Kept comfortably below `ABSENCE_FORFEIT_SEC` so the last stretch of
 * the grace window is shown as a live countdown, yet high enough that an
 * ordinary refresh (a few seconds of heartbeat gap) never triggers it.
 */
export const ABSENCE_COUNTDOWN_AFTER_SEC = 35;

/**
 * The opponent's *effective* last-seen instant (ms), floored at the race start.
 *
 * A `null` heartbeat (opponent hasn't polled yet) or any stamp somehow older
 * than `startedAtMs` collapses to `startedAtMs`, so the grace window can never
 * begin before the opponent has actually had a chance to poll — this is the
 * "no forfeit before the opponent's first poll window" invariant.
 */
export function effectiveLastSeenMs(
  lastSeenMs: number | null,
  startedAtMs: number,
): number {
  if (lastSeenMs === null || lastSeenMs < startedAtMs) return startedAtMs;
  return lastSeenMs;
}

/**
 * Whole seconds of grace left before an absent opponent forfeits, clamped to
 * `[0, graceSec]`. Display only — never the finish decision. Returns `graceSec`
 * during the countdown (before `startedAtMs`) since the window hasn't opened.
 */
export function absenceSecondsRemaining(
  lastSeenMs: number | null,
  startedAtMs: number,
  nowMs: number,
  graceSec: number = ABSENCE_FORFEIT_SEC,
): number {
  const eff = effectiveLastSeenMs(lastSeenMs, startedAtMs);
  const elapsedSec = (nowMs - eff) / 1000;
  const remaining = graceSec - elapsedSec;
  if (remaining <= 0) return 0;
  return Math.min(graceSec, Math.ceil(remaining));
}

/**
 * Server-authoritative forfeit decision: `true` when the opponent has been
 * absent strictly longer than the grace window. Never fires during the
 * countdown (`nowMs < startedAtMs`). The caller pairs this with the present
 * participant as the winner; `finishRace`'s own `WHERE status='active'` claim
 * keeps the resulting finish idempotent.
 */
export function isAbsenceForfeit(
  lastSeenMs: number | null,
  startedAtMs: number,
  nowMs: number,
  graceSec: number = ABSENCE_FORFEIT_SEC,
): boolean {
  if (nowMs < startedAtMs) return false;
  const eff = effectiveLastSeenMs(lastSeenMs, startedAtMs);
  return (nowMs - eff) / 1000 > graceSec;
}

/**
 * Client display gate: whether to escalate the disconnect banner into the
 * absence-forfeit countdown. `true` once the opponent's heartbeat has been stale
 * for at least {@link ABSENCE_COUNTDOWN_AFTER_SEC} (and the countdown has ended).
 * A brief refresh gap stays below the threshold and never shows the banner.
 */
export function shouldShowAbsenceCountdown(
  lastSeenMs: number | null,
  startedAtMs: number,
  nowMs: number,
  afterSec: number = ABSENCE_COUNTDOWN_AFTER_SEC,
): boolean {
  if (nowMs < startedAtMs) return false;
  const eff = effectiveLastSeenMs(lastSeenMs, startedAtMs);
  return (nowMs - eff) / 1000 >= afterSec;
}
