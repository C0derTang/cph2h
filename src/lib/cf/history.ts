/**
 * Import a user's Codeforces solve history into `user_problems`.
 *
 * Extracted from the old password-login link route so the compile-error
 * verification flow (`POST /api/cf/verify/check`) can reuse the exact same
 * import logic. Walks the user's full submission history via the public
 * `user.status` API (paginated) and marks `user_problems.solved`.
 *
 * `importSolveHistoryIncremental` (issue #69) layers an incremental variant
 * on top for the ready-time refresh: newest-first, stopping at the first
 * submission older than the user's last sync, so problems solved after
 * link time are excluded from selection without re-walking the whole history
 * on every race.
 *
 * OUT OF SCOPE (tracked on issue #32, deferred — need infra/schema changes):
 *  - Moving this off the request path onto a background job/queue so a function
 *    timeout can't abort mid-import.
 *  - Allowing provisional `user_problems` rows for problems not yet in the
 *    `problems` catalogue (the unseen-problem FK limitation).
 */

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { problems, userProblems, users } from "@/lib/db/schema";
import { getUserStatus } from "@/lib/cf/client";
import type { CfSubmission } from "@/lib/types";

/** Page size for history import; walked via `from` until exhausted or capped. */
const HISTORY_PAGE_SIZE = 1000;
/** Safety cap on total pages fetched (HISTORY_PAGE_SIZE * MAX_PAGES rows). */
const MAX_HISTORY_PAGES = 20;
/**
 * Safety cap on pages fetched by the incremental refresh — much smaller than
 * the full walk since it only needs to reach back to the last sync, and it
 * runs on the ready-request path where CF's rate limit and a soft timeout
 * both apply.
 */
const MAX_INCREMENTAL_PAGES = 2;
/** Batch size for `user_problems` upserts. */
const UPSERT_BATCH_SIZE = 500;

/**
 * Restrict `attempts` to problems already present in the `problems` table
 * (satisfies the `user_problems -> problems` FK — the catalogue is populated
 * by a separate sync job) and upsert with once-solved-always-solved
 * semantics.
 */
async function upsertAttempts(userId: string, attempts: Map<string, boolean>): Promise<void> {
  if (attempts.size === 0) return;

  const ids = [...attempts.keys()];
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += UPSERT_BATCH_SIZE) {
    const chunk = ids.slice(i, i + UPSERT_BATCH_SIZE);
    const rows = await db
      .select({ id: problems.id })
      .from(problems)
      .where(inArray(problems.id, chunk));
    for (const row of rows) known.add(row.id);
  }

  const rows = [...attempts.entries()]
    .filter(([problemId]) => known.has(problemId))
    .map(([problemId, solved]) => ({ userId, problemId, solved }));

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    await db
      .insert(userProblems)
      .values(batch)
      .onConflictDoUpdate({
        target: [userProblems.userId, userProblems.problemId],
        // Once solved, always solved — even on re-import.
        set: { solved: sql`${userProblems.solved} OR excluded.solved` },
      });
  }
}

/** Stamp `users.solve_history_synced_at = now` after a successful import. */
async function stampSyncedAt(userId: string, now: Date): Promise<void> {
  await db.update(users).set({ solveHistorySyncedAt: now }).where(eq(users.id, userId));
}

/**
 * Walk the user's full submission history and mark `user_problems.solved`.
 *
 * Only problems already present in the `problems` table are recorded, so the
 * `user_problems -> problems` foreign key is never violated (the problem
 * catalogue is populated by a separate sync job).
 *
 * Does NOT stamp `solveHistorySyncedAt` — the verify/check link route calls
 * this directly (a fresh link has no baseline to compare against yet; the
 * first ready-time refresh establishes one via the null-`syncedAt` branch of
 * {@link importSolveHistoryIncremental}, which does stamp).
 */
export async function importSolveHistory(userId: string, handle: string): Promise<void> {
  // problemId -> solved (any OK verdict wins over a non-OK attempt).
  const attempts = new Map<string, boolean>();

  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const from = page * HISTORY_PAGE_SIZE + 1;
    const submissions = await getUserStatus(handle, from, HISTORY_PAGE_SIZE);
    if (submissions.length === 0) break;

    for (const sub of submissions) {
      const problemId = `${sub.problem.contestId}${sub.problem.index}`;
      const solved = sub.verdict === "OK";
      attempts.set(problemId, (attempts.get(problemId) ?? false) || solved);
    }

    if (submissions.length < HISTORY_PAGE_SIZE) break;
  }

  await upsertAttempts(userId, attempts);
}

/**
 * Incremental solve-history refresh (issue #69): fetches `user.status`
 * newest-first and stops at the first submission older than `syncedAt`,
 * capped at {@link MAX_INCREMENTAL_PAGES} pages — the ready-time refresh only
 * needs to catch up on what changed since the last sync, not re-walk
 * everything.
 *
 * `syncedAt === null` means the user has never been synced (a fresh link):
 * falls back to the existing full walk (`importSolveHistory`) so the very
 * first refresh still captures complete history.
 *
 * Stamps `users.solveHistorySyncedAt = now` on success in both branches. Can
 * throw (CF/API/db errors) — callers on the ready path must guard with a
 * timeout/try-catch (see `refreshSolveHistoryIfStale`).
 */
export async function importSolveHistoryIncremental(
  userId: string,
  handle: string,
  syncedAt: Date | null,
): Promise<void> {
  const now = new Date();

  if (syncedAt === null) {
    await importSolveHistory(userId, handle);
    await stampSyncedAt(userId, now);
    return;
  }

  const cutoffSec = Math.floor(syncedAt.getTime() / 1000);
  const attempts = new Map<string, boolean>();

  for (let page = 0; page < MAX_INCREMENTAL_PAGES; page++) {
    const from = page * HISTORY_PAGE_SIZE + 1;
    const submissions = await getUserStatus(handle, from, HISTORY_PAGE_SIZE);
    if (submissions.length === 0) break;

    const cutoffIndex = submissions.findIndex(
      (sub: CfSubmission) => sub.creationTimeSeconds < cutoffSec,
    );
    const pageSubmissions =
      cutoffIndex === -1 ? submissions : submissions.slice(0, cutoffIndex);

    for (const sub of pageSubmissions) {
      const problemId = `${sub.problem.contestId}${sub.problem.index}`;
      const solved = sub.verdict === "OK";
      attempts.set(problemId, (attempts.get(problemId) ?? false) || solved);
    }

    // Hit the cutoff within this page — everything older is already synced.
    if (cutoffIndex !== -1) break;
    if (submissions.length < HISTORY_PAGE_SIZE) break;
  }

  await upsertAttempts(userId, attempts);
  await stampSyncedAt(userId, now);
}
