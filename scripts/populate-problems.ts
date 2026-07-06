/**
 * Manual backfill of the cached Codeforces problemset.
 *
 * Runs the same fetch-and-stamp logic as the weekly cron
 * (`src/app/api/cron/problemset/route.ts`) — `problemset.problems` for the
 * catalogue plus `contest.list` for `contestStartedAt` — but as an on-demand
 * script, e.g. to populate a freshly migrated database without waiting for
 * the cron to fire. Idempotent: safe to re-run, updates existing rows.
 *
 * Usage: `pnpm exec tsx scripts/populate-problems.ts`
 * Requires `DATABASE_URL` to point at a real (migrated) Postgres instance.
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { getContestList, getProblemset } from "@/lib/cf/client";
import {
  buildContestDateMap,
  stampContestStartedAt,
  type ProblemWithoutContestDate,
} from "@/lib/cf/contest-dates";
import { upsertProblems } from "@/lib/cf/problem-repo";
import { problemIdOf } from "@/lib/types";

async function main() {
  console.log("Fetching problemset.problems...");
  const { problems: cfProblems } = await getProblemset();
  const fetchedAt = new Date();

  console.log("Fetching contest.list...");
  let contestDates: Map<number, Date>;
  try {
    const contests = await getContestList();
    contestDates = buildContestDateMap(contests);
  } catch (error) {
    console.error(
      "contest.list fetch failed; contestStartedAt stamped null this run (existing dates preserved by upsert COALESCE):",
      error,
    );
    contestDates = new Map();
  }

  const rows: ProblemWithoutContestDate[] = [];
  let skipped = 0;
  for (const problem of cfProblems) {
    if (typeof problem.rating !== "number") {
      skipped++;
      continue;
    }
    rows.push({
      id: problemIdOf(problem),
      contestId: problem.contestId,
      index: problem.index,
      name: problem.name,
      rating: problem.rating,
      tags: problem.tags,
      fetchedAt,
    });
  }

  const upserted = await upsertProblems(stampContestStartedAt(rows, contestDates));

  console.log(`Done. Upserted ${upserted} problems (${skipped} skipped, no rating).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Populate failed:", err);
    process.exit(1);
  });
