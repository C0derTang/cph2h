/**
 * Weekly refresh of the cached Codeforces problemset.
 *
 * Triggered by the Vercel cron in `vercel.json` (`0 4 * * 1`). Protected by
 * `CRON_SECRET` — see `src/proxy.ts`, which exempts `/api/cron/*` from Clerk
 * auth in favor of this bearer check.
 *
 * NOTE on scope: the CF `problemset.problems` payload does not include
 * contest start times, so the issue's optional "contest-age > 30 days"
 * candidate filter is intentionally omitted here — there's no data to filter
 * on without a separate `contest.list` fetch, which is out of scope for this
 * issue.
 */

import { NextResponse } from "next/server";
import { getProblemset } from "@/lib/cf/client";
import { upsertProblems } from "@/lib/cf/problem-repo";
import type { NewProblem } from "@/lib/db/schema";
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

  const rows: NewProblem[] = [];
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

  const upserted = await upsertProblems(rows);

  return NextResponse.json({ ok: true, upserted, skipped });
}
