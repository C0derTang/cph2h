/**
 * Pure decision core for the data-channel refetch throttle (issue #84,
 * PR #85 security review).
 *
 * With `canPublishData: true` on client tokens (needed so clients can send
 * `taunt` events, see `src/lib/livekit.ts`), a malicious opponent could
 * bypass the UI and publish forged NON-taunt `RaceEvent`s at arbitrary rate;
 * each one used to trigger an immediate snapshot refetch — a 1:1
 * amplification against our own `GET /api/races/[id]` from the victim's
 * browser. `RaceEvents` (in `RaceRoom.tsx`) therefore throttles the
 * event→refetch path to at most one refetch per `REFETCH_MIN_MS`, with
 * leading + trailing edges: the first event of a burst refetches
 * immediately, and one trailing refetch is scheduled for the tail so a
 * legitimate final event (e.g. `race_finished`) is never dropped — a flood
 * simply collapses to ~1 refetch/sec.
 *
 * This module is the pure timing math; the component owns the actual
 * `setTimeout`/refs. Reconnection-driven refetches are NOT routed through
 * this throttle — connection state is LiveKit-server-driven, not
 * attacker-controllable.
 */

/** Minimum gap between event-driven snapshot refetches. */
export const REFETCH_MIN_MS = 1000;

export type RefetchThrottleDecision =
  | { action: "now" }
  | { action: "trailing"; delayMs: number };

/**
 * Decide how to handle an incoming event given the time of the last
 * refetch. `lastRefetchAt` is epoch ms of the last fired refetch (0 = never,
 * which always yields `now` for any sane clock). Returns:
 * - `{ action: "now" }` — outside the window; fire immediately (leading edge)
 *   and record `now` as the new `lastRefetchAt`.
 * - `{ action: "trailing", delayMs }` — inside the window; if no trailing
 *   refetch is already scheduled, schedule one after `delayMs` (which lands
 *   exactly at the window boundary). If one is already pending, drop the
 *   event — the pending trailing refetch already covers it.
 */
export function refetchThrottleDecision(
  lastRefetchAt: number,
  now: number,
  minMs: number = REFETCH_MIN_MS,
): RefetchThrottleDecision {
  const since = now - lastRefetchAt;
  if (since >= minMs) return { action: "now" };
  return { action: "trailing", delayMs: minMs - since };
}
