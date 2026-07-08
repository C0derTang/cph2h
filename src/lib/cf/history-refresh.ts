/**
 * Best-effort incremental solve-history refresh at ready time (issue #69,
 * always-refresh fix #98).
 *
 * Problem exclusion ("neither player has done the problem", see
 * `src/lib/cf/problem-repo.ts` `getSeenProblemIds`) reads `user_problems`,
 * which is only populated at CF-verify time (`importSolveHistory`). A player
 * who solved problems after linking could otherwise be served one they just
 * did.
 *
 * Two entry points share the same never-throws refresh core
 * ({@link refreshSolveHistory}):
 *  - {@link refreshSolveHistoryForce} — always re-syncs regardless of
 *    staleness. Used on the both-ready path (see the `refreshSeenProblems`
 *    hook in `src/lib/race/hooks.ts`, called from
 *    `POST /api/races/[id]/ready`) so a problem solved moments ago (with a
 *    still-fresh `syncedAt`) is still excluded from this selection (issue
 *    #98) — a bounded, cheap incremental walk since the last sync.
 *  - {@link refreshSolveHistoryIfStale} — only re-syncs when
 *    `solveHistorySyncedAt` has gone stale (`SOLVE_HISTORY_STALE_SEC`).
 *    Kept for any other caller that wants the staleness gate; the predicate
 *    itself ({@link isSolveHistoryStale}) stays exported and tested.
 *
 * Deliberately never throws: a CF hiccup must never stop a race from
 * starting — worst case the exclusion set is stale for this one selection.
 */

import { importSolveHistoryIncremental } from "@/lib/cf/history";
import type { CfFetchOptions } from "@/lib/cf/client";
import { SOLVE_HISTORY_STALE_SEC } from "@/lib/types";

/** Minimal user shape this module needs — avoids importing the full `User` row type. */
export interface SolveHistoryUser {
  id: string;
  cfHandle: string | null;
  solveHistorySyncedAt: Date | null;
  solveHistoryImportCursor?: number | null;
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

export interface RefreshSolveHistoryOptions {
  /**
   * Skip the {@link isSolveHistoryStale} gate and always run the incremental
   * import (still a no-op when the user has no linked CF handle). Used by
   * the both-ready path (issue #98) where a fresh-but-not-yet-reflected solve
   * must still be excluded from this selection.
   */
  force?: boolean;

  /**
   * Optional cancellation for best-effort callers with a request-path budget.
   * If a CF request is still queued behind the shared limiter when the budget
   * expires, aborting the signal removes it from the queue instead of letting
   * stale refresh work consume later request slots.
   */
  signal?: AbortSignal;
}

/**
 * Refresh `user`'s solve history. No-op when the user has no linked CF
 * handle (nothing to sync). Unless `force` is set, also no-ops when the last
 * sync is still within {@link SOLVE_HISTORY_STALE_SEC}.
 *
 * Never throws — any CF/API/db error is swallowed so the caller (the ready
 * path) never fails or stalls because of this best-effort refresh.
 */
export async function refreshSolveHistory(
  user: SolveHistoryUser,
  options: RefreshSolveHistoryOptions = {},
): Promise<void> {
  if (!user.cfHandle) return;
  if (!options.force && !isSolveHistoryStale(user.solveHistorySyncedAt)) return;

  try {
    const cfOptions = options.signal ? { signal: options.signal } : undefined;
    await importSolveHistoryIncremental(
      user.id,
      user.cfHandle,
      user.solveHistorySyncedAt,
      user.solveHistoryImportCursor ?? null,
      cfOptions,
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    console.error(`[history-refresh] refresh failed for user ${user.id}`, err);
  }
}

/**
 * Refresh `user`'s solve history only when it's stale (or has never been
 * synced) — see {@link isSolveHistoryStale}. Kept for any caller that wants
 * the staleness gate; the both-ready path uses {@link refreshSolveHistoryForce}
 * instead (issue #98).
 */
export async function refreshSolveHistoryIfStale(user: SolveHistoryUser): Promise<void> {
  await refreshSolveHistory(user);
}

/**
 * Refresh `user`'s solve history unconditionally (staleness predicate
 * skipped) — see {@link RefreshSolveHistoryOptions.force}.
 */
export async function refreshSolveHistoryForce(
  user: SolveHistoryUser,
  options: CfFetchOptions = {},
): Promise<void> {
  await refreshSolveHistory(user, { force: true, signal: options.signal });
}
