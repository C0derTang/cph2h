/**
 * GET /api/cron/sweep — race safety-net cron (issue #15).
 *
 * Runs daily (Vercel Hobby caps crons at once/day; see `vercel.json`).
 * Guarantees no race can get stuck when both participants close their tabs
 * (nobody polling) or a `pending` challenge is never accepted. Protected by
 * `CRON_SECRET` — `src/proxy.ts` exempts `/api/cron/*` from Clerk auth in favor
 * of this bearer check.
 *
 * Work per run:
 *  1. Force-poll every active race that is past `endsAt` OR hasn't been polled
 *     in >60s. `pollActiveRace` resolves each — a solve wins, a timed-out race
 *     draws. Draws thus flow through the same verdict-aware path, so a
 *     last-second AC is never lost to a blind timeout draw.
 *  2. Resolve matchmade lobbies whose ready deadline has passed (issue #275):
 *     walkover for the single ready player, abort when neither readied. Lazy
 *     enforcement on GET/ready is primary; this is the safety net for a lobby
 *     both players abandoned.
 *  3. Abort `pending` races older than 24h.
 *  4. Purge `queue_entries` whose heartbeat (`last_seen_at`) is >5 minutes
 *     stale — NOT by `enqueued_at`, so a still-polling user who has legitimately
 *     waited longer than 5 minutes is never purged out from under an active
 *     queue session.
 */

import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiRateLimits, queueEntries, races } from "@/lib/db/schema";
import { pollActiveRace } from "@/lib/race/poll";
import { resolveReadyTimeout } from "@/lib/race/ready-timeout";
import { refreshCfRatings } from "@/lib/cf/rating-refresh";

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
  let failed = 0;
  for (const race of stale) {
    try {
      // Poll first, then bump last_polled_at only on success — a throwing race
      // must not be marked "recently polled" (which would skip it for 60s).
      await pollActiveRace(race, now);
      await db
        .update(races)
        .set({ lastPolledAt: sql`now()` })
        .where(eq(races.id, race.id));
      resolved++;
    } catch (err) {
      // One race's failure must not abort the sweep — the pending-abort and
      // queue-purge steps below still need to run.
      console.error(`[sweep] poll failed for race ${race.id}`, err);
      failed++;
    }
  }

  // 2. Resolve matchmade lobbies whose ready deadline has passed (issue #275).
  //    Lazy enforcement on GET/ready is primary; this is the safety net for a
  //    lobby both players abandoned before the deadline. Each resolves via the
  //    shared atomic path (walkover through finishRace / abort claim), per-race
  //    try/catch so one failure never aborts the sweep.
  const expiredReadyLobbies = await db
    .select()
    .from(races)
    .where(
      and(
        eq(races.status, "ready"),
        isNotNull(races.readyDeadlineAt),
        lt(races.readyDeadlineAt, sql`now()`),
      ),
    );

  let resolvedReadyTimeouts = 0;
  for (const lobby of expiredReadyLobbies) {
    try {
      await resolveReadyTimeout(lobby, now);
      resolvedReadyTimeouts++;
    } catch (err) {
      console.error(`[sweep] ready-timeout resolve failed for race ${lobby.id}`, err);
    }
  }

  // 3. Abort pending races that were never accepted within 24h.
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

  // 4. Purge stale matchmaking queue entries by heartbeat staleness. Keyed off
  //    `last_seen_at` (stamped on every queue-status poll), NOT `enqueued_at`:
  //    a user actively polling has a fresh heartbeat and must survive even after
  //    legitimately waiting past the 5-minute window, while an abandoned entry
  //    (client stopped polling) goes stale and is purged.
  const purgedRows = await db
    .delete(queueEntries)
    .where(lt(queueEntries.lastSeenAt, sql`now() - interval '5 minutes'`))
    .returning({ userId: queueEntries.userId });

  // 5. Refresh linked CF ratings (daily snapshot re-read). Best-effort — a CF
  //    hiccup must not fail the safety-net sweep above, so swallow and report.
  let ratings = { checked: 0, updated: 0, failed: 0 };
  try {
    ratings = await refreshCfRatings();
  } catch (err) {
    console.error("[sweep] cf rating refresh failed", err);
  }

  // 6. Purge stale api_rate_limits rows (issue #256). Best-effort — a purge
  //    failure must not fail the safety-net sweep above; a stale row just
  //    keeps its window until the next sweep or its next natural rollover.
  let purgedRateLimits = 0;
  try {
    const purgedRateLimitRows = await db
      .delete(apiRateLimits)
      .where(lt(apiRateLimits.windowStart, sql`now() - interval '1 day'`))
      .returning({ key: apiRateLimits.key });
    purgedRateLimits = purgedRateLimitRows.length;
  } catch (err) {
    console.error("[sweep] api_rate_limits purge failed", err);
  }

  return NextResponse.json({
    ok: true,
    polled: resolved,
    pollFailed: failed,
    resolvedReadyTimeouts,
    abortedPending: abortedRows.length,
    purgedQueue: purgedRows.length,
    ratingsChecked: ratings.checked,
    ratingsUpdated: ratings.updated,
    ratingsFailed: ratings.failed,
    purgedRateLimits,
  });
}
