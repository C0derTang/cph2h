/**
 * GET /api/cron/sweep — race safety-net cron (issue #15).
 *
 * Runs every minute (see `vercel.json`). Guarantees no race can get stuck when
 * both participants close their tabs (nobody polling) or a `pending` challenge
 * is never accepted. Protected by `CRON_SECRET` — `src/proxy.ts` exempts
 * `/api/cron/*` from Clerk auth in favor of this bearer check.
 *
 * Work per run:
 *  1. Force-poll every active race that is past `endsAt` OR hasn't been polled
 *     in >60s. `pollActiveRace` resolves each — a solve wins, a timed-out race
 *     draws. Draws thus flow through the same verdict-aware path, so a
 *     last-second AC is never lost to a blind timeout draw.
 *  2. Abort `pending` races older than 24h.
 *  3. Purge `queue_entries` older than 5 minutes.
 */

import { NextResponse } from "next/server";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { queueEntries, races } from "@/lib/db/schema";
import { pollActiveRace } from "@/lib/race/poll";

/** Force-poll active races idle for longer than this many seconds. */
const STALE_POLL_SECONDS = 60;

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

  const now = new Date();

  // 1. Resolve stuck/overdue active races via the shared poll path.
  const stale = await db
    .select()
    .from(races)
    .where(
      and(
        eq(races.status, "active"),
        or(
          lt(races.endsAt, sql`now()`),
          isNull(races.lastPolledAt),
          lt(
            races.lastPolledAt,
            sql`now() - (${STALE_POLL_SECONDS} * interval '1 second')`,
          ),
        ),
      ),
    );

  let resolved = 0;
  for (const race of stale) {
    await db
      .update(races)
      .set({ lastPolledAt: sql`now()` })
      .where(eq(races.id, race.id));
    await pollActiveRace(race, now);
    resolved++;
  }

  // 2. Abort pending races that were never accepted within 24h.
  const abortedRows = await db
    .update(races)
    .set({ status: "aborted", outcome: "aborted", finishedAt: now })
    .where(
      and(
        eq(races.status, "pending"),
        lt(races.createdAt, sql`now() - interval '24 hours'`),
      ),
    )
    .returning({ id: races.id });

  // 3. Purge stale matchmaking queue entries.
  const purgedRows = await db
    .delete(queueEntries)
    .where(lt(queueEntries.enqueuedAt, sql`now() - interval '5 minutes'`))
    .returning({ userId: queueEntries.userId });

  return NextResponse.json({
    ok: true,
    polled: resolved,
    abortedPending: abortedRows.length,
    purgedQueue: purgedRows.length,
  });
}
