/**
 * Weekly refresh of the cached Codeforces problemset.
 *
 * Triggered by the Vercel cron in `vercel.json` (`0 4 * * 1`). Protected by
 * `CRON_SECRET` — see `src/proxy.ts`, which exempts `/api/cron/*` from Clerk
 * auth in favor of this bearer check.
 *
 * CF `problemset.problems` doesn't include contest start times, so we also
 * fetch `contest.list` and stamp each row's `contestStartedAt` from it (see
 * `src/lib/cf/contest-dates.ts`). If `contest.list` fails, we degrade to an
 * empty date map — every row gets a null `contestStartedAt` rather than
 * failing the whole sync.
 */

import { NextResponse } from "next/server";
import { getContestList, getProblemset } from "@/lib/cf/client";
import { buildContestDateMap, stampContestStartedAt } from "@/lib/cf/contest-dates";
import type { ProblemWithoutContestDate } from "@/lib/cf/contest-dates";
import { upsertProblems } from "@/lib/cf/problem-repo";
import { problemIdOf } from "@/lib/types";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { problems: cfProblems } = await getProblemset();
  const fetchedAt = new Date();

  let contestDates: Map<number, Date>;
  try {
    const contests = await getContestList();
    contestDates = buildContestDateMap(contests);
  } catch (error) {
    console.error("contest.list fetch failed; contestStartedAt will be null this run:", error);
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

  return NextResponse.json({ ok: true, upserted, skipped });
}
