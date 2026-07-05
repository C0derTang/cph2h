/**
 * Import a user's Codeforces solve history into `user_problems`.
 *
 * Extracted from the old password-login link route so the compile-error
 * verification flow (`POST /api/cf/verify/check`) can reuse the exact same
 * import logic. Walks the user's full submission history via the public
 * `user.status` API (paginated) and marks `user_problems.solved`.
 *
 * OUT OF SCOPE (tracked on issue #32, deferred — need infra/schema changes):
 *  - Moving this off the request path onto a background job/queue so a function
 *    timeout can't abort mid-import.
 *  - Allowing provisional `user_problems` rows for problems not yet in the
 *    `problems` catalogue (the unseen-problem FK limitation).
 */

import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { problems, userProblems } from "@/lib/db/schema";
import { getUserStatus } from "@/lib/cf/client";

/** Page size for history import; walked via `from` until exhausted or capped. */
const HISTORY_PAGE_SIZE = 1000;
/** Safety cap on total pages fetched (HISTORY_PAGE_SIZE * MAX_PAGES rows). */
const MAX_HISTORY_PAGES = 20;
/** Batch size for `user_problems` upserts. */
const UPSERT_BATCH_SIZE = 500;

/**
 * Walk the user's full submission history and mark `user_problems.solved`.
 *
 * Only problems already present in the `problems` table are recorded, so the
 * `user_problems -> problems` foreign key is never violated (the problem
 * catalogue is populated by a separate sync job).
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

  if (attempts.size === 0) return;

  // Restrict to catalogued problems to satisfy the FK constraint.
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
