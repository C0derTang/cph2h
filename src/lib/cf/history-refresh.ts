/**
 * Best-effort incremental solve-history refresh at ready time (issue #69).
 *
 * Problem exclusion ("neither player has done the problem", see
 * `src/lib/cf/problem-repo.ts` `getSeenProblemIds`) reads `user_problems`,
 * which is only populated at CF-verify time (`importSolveHistory`). A player
 * who solved problems after linking could otherwise be served one they just
 * did. `refreshSolveHistoryIfStale` re-syncs a player's history right before
 * problem selection when it has gone stale (`SOLVE_HISTORY_STALE_SEC`).
 *
 * Deliberately never throws: this runs on the ready-request path (see the
 * `refreshSolveHistory` hook in `src/lib/race/hooks.ts`, called from
 * `POST /api/races/[id]/ready`), and a CF hiccup must never stop a race from
 * starting — worst case the exclusion set is stale for this one selection.
 */

import { importSolveHistoryIncremental } from "@/lib/cf/history";
import { SOLVE_HISTORY_STALE_SEC } from "@/lib/types";

/** Minimal user shape this module needs — avoids importing the full `User` row type. */
export interface SolveHistoryUser {
  id: string;
  cfHandle: string | null;
  solveHistorySyncedAt: Date | null;
}

/**
 * True when `syncedAt` is stale enough (or absent) to warrant a refresh.
 * Pure — no I/O — so it's trivially unit-testable and reusable.
 */
export function isSolveHistoryStale(syncedAt: Date | null, now: Date = new Date()): boolean {
  if (syncedAt === null) return true;
  const ageSec = (now.getTime() - syncedAt.getTime()) / 1000;
  return ageSec >= SOLVE_HISTORY_STALE_SEC;
}

/**
 * Refresh `user`'s solve history if it's stale (or has never been synced).
 * No-op when:
 *  - the user has no linked CF handle (nothing to sync), or
 *  - the last sync is still within {@link SOLVE_HISTORY_STALE_SEC}.
 *
 * Never throws — any CF/API/db error is swallowed so the caller (the ready
 * path) never fails or stalls because of this best-effort refresh.
 */
export async function refreshSolveHistoryIfStale(user: SolveHistoryUser): Promise<void> {
  if (!user.cfHandle) return;
  if (!isSolveHistoryStale(user.solveHistorySyncedAt)) return;

  try {
    await importSolveHistoryIncremental(user.id, user.cfHandle, user.solveHistorySyncedAt);
  } catch (err) {
    console.error(`[history-refresh] refresh failed for user ${user.id}`, err);
  }
}
