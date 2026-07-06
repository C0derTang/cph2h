/**
 * Pure clock-skew and countdown/unlock-timing helpers (issue #62).
 *
 * Root cause this module fixes: clients previously compared the server's
 * `startedAt`/`endsAt` against raw `Date.now()`. A client with an unskewed
 * clock unlocks the problem right on time via the countdown UI re-render, but
 * a client whose clock lags (or a slow verdict-poll mutex loss streak) could
 * sit on a locked problem for 15–22s with no timer keyed to the actual unlock
 * instant. Every countdown / unlock computation must go through
 * {@link correctedNow} instead of `Date.now()` directly.
 *
 * All functions are pure (no `Date.now()` calls baked in — callers inject the
 * local clock reading) so they are exhaustively unit-testable.
 */

import { UNLOCK_REFETCH_BACKOFF_MS, type RaceSnapshot } from "@/lib/types";

/**
 * Clock skew (ms): how far ahead the local clock is of the server's clock,
 * derived from a snapshot's `now` (server ISO time at build) and the local
 * `Date.now()` reading taken the instant the snapshot was received.
 *
 * Positive skew means the local clock runs ahead of the server; subtract it
 * from local readings to get server-aligned time (see {@link correctedNow}).
 * Recompute this on every snapshot receipt — skew can drift and network
 * latency varies per request.
 */
export function computeSkewMs(serverNowIso: string, localReceiveMs: number): number {
  const serverNowMs = Date.parse(serverNowIso);
  return localReceiveMs - serverNowMs;
}

/** Skew-corrected "now": the local clock reading with the known skew removed. */
export function correctedNow(skewMs: number, localNowMs: number = Date.now()): number {
  return localNowMs - skewMs;
}

/**
 * Milliseconds until `startedAtIso` unlocks the problem, using skew-corrected
 * time. Zero or negative once the unlock instant has passed.
 */
export function msUntilUnlock(
  startedAtIso: string,
  skewMs: number,
  nowMs: number = Date.now(),
): number {
  const startedAtMs = Date.parse(startedAtIso);
  return startedAtMs - correctedNow(skewMs, nowMs);
}

/**
 * The unlock-refetch retry delay (ms) for the given 0-indexed attempt number.
 * Attempt 0 is the first *retry* after the initial at-unlock refetch (i.e. the
 * first entry of {@link UNLOCK_REFETCH_BACKOFF_MS}); once attempts run past
 * the configured table, the last delay is held indefinitely rather than
 * growing further or throwing.
 */
export function nextRetryDelay(attempt: number): number {
  const table = UNLOCK_REFETCH_BACKOFF_MS;
  const idx = Math.min(Math.max(attempt, 0), table.length - 1);
  return table[idx];
}

/** Discriminated classification of a `POST /api/races/[id]/poll` response body. */
export type PollResponseClassification =
  | { kind: "snapshot"; snapshot: RaceSnapshot }
  | { kind: "skipped" }
  | { kind: "unknown" };

/**
 * Classify a verdict-poll response: a full {@link RaceSnapshot} (has a string
 * `status`), the DB-mutex `{ skipped: true }` shape, or anything else
 * (network hiccup / unexpected payload). The skipped-poll fallback (RaceRoom)
 * uses this to decide whether to fall back to a plain snapshot refetch.
 */
export function classifyPollResponse(data: unknown): PollResponseClassification {
  if (data && typeof data === "object") {
    if (typeof (data as { status?: unknown }).status === "string") {
      return { kind: "snapshot", snapshot: data as RaceSnapshot };
    }
    if ((data as { skipped?: unknown }).skipped === true) {
      return { kind: "skipped" };
    }
  }
  return { kind: "unknown" };
}
