/**
 * Dynamic verdict-poll interval under load (issue #238).
 *
 * The CF client serializes ALL requests at ~2s global spacing
 * (`MIN_REQUEST_SPACING_MS` in `src/lib/cf/client.ts`), so the app-wide budget is
 * ~30 CF calls/min. Each active-race poll costs 2 `user.status` calls, i.e. ~4s
 * of the shared queue to service one race once. At tournament load (up to 32
 * concurrent races) a fixed {@link POLL_MIN_INTERVAL_SEC} window would demand far
 * more CF throughput than exists → unbounded growth of the client's promise
 * chain → function timeouts.
 *
 * The per-race poll mutex therefore scales its window with the number of active
 * races: `activeRaces * SECONDS_PER_ACTIVE_RACE`, floored at the static
 * `POLL_MIN_INTERVAL_SEC`. This keeps aggregate CF demand within the serialized
 * budget regardless of load. 1 race → 5s (as today); 8 → 32s; 32 → 128s.
 *
 * Pure and unit-tested; the poll route enforces the same formula inside its
 * single atomic claim via a scalar subquery so the value is computed against a
 * consistent snapshot of `active` races.
 */

import { POLL_MIN_INTERVAL_SEC } from "@/lib/types";

/** Seconds of the serialized CF queue one active race consumes per poll (2 calls * 2s). */
export const SECONDS_PER_ACTIVE_RACE = 4;

/**
 * The per-race minimum seconds between CF-hitting polls, given the current count
 * of `active` races. Never drops below the static {@link POLL_MIN_INTERVAL_SEC}.
 */
export function dynamicPollIntervalSec(activeRaces: number): number {
  return Math.max(POLL_MIN_INTERVAL_SEC, activeRaces * SECONDS_PER_ACTIVE_RACE);
}
