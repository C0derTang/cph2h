/**
 * POST /api/races/[id]/poll — participant-driven verdict poll (issue #15).
 *
 * Clients poll this while a race is active. A DB mutex keeps the CF API traffic
 * bounded regardless of how many tabs poll: only one request per
 * `POLL_MIN_INTERVAL_SEC` window actually reaches Codeforces; the rest get
 * `{ skipped: true }` and fall back to their periodic snapshot refetch.
 *
 * The winning claim runs the shared {@link pollActiveRace} logic (fetch each
 * player's status, apply verdicts, finish on OK or draw on timeout) and returns
 * the refreshed {@link RaceSnapshot}.
 */

import { NextResponse } from "next/server";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { races } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { isParticipant } from "@/lib/race/machine";
import { buildRaceSnapshot } from "@/lib/race/snapshot";
import {
  pollActiveRace,
  stampHeartbeat,
  maybeAbsenceForfeit,
} from "@/lib/race/poll";
import { POLL_MIN_INTERVAL_SEC } from "@/lib/types";
import { SECONDS_PER_ACTIVE_RACE } from "@/lib/race/poll-interval";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const [race] = await db
    .select()
    .from(races)
    .where(eq(races.id, id))
    .limit(1);

  if (!race) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!isParticipant(race, session.user.id)) {
    return NextResponse.json({ error: "not_participant" }, { status: 403 });
  }

  const callerIsP1 = race.p1Id === session.user.id;

  // Presence heartbeat (issue #105): stamp the caller BEFORE and independent of
  // the poll mutex, so mutex-skipped polls (the majority) still prove presence.
  // A no-op unless the race is active.
  await stampHeartbeat(id, callerIsP1);

  // DB mutex: claim the poll only if the race is active and not polled within
  // the dynamic window. The window scales with the current count of `active`
  // races — `GREATEST(POLL_MIN_INTERVAL_SEC, count(active) * SECONDS_PER_ACTIVE_RACE)`
  // seconds — so aggregate CF demand stays within the serialized ~2s/request
  // budget under tournament load (issue #238). The count is a scalar subquery
  // inside this single atomic UPDATE (Neon HTTP has no transactions), so the
  // window is evaluated against a consistent snapshot as the claim runs. Zero
  // rows ⇒ someone polled recently (or the race isn't active) — skip and let the
  // client refetch the snapshot.
  const [claimed] = await db
    .update(races)
    .set({ lastPolledAt: sql`now()` })
    .where(
      and(
        eq(races.id, id),
        eq(races.status, "active"),
        or(
          isNull(races.lastPolledAt),
          lt(
            races.lastPolledAt,
            sql`now() - (GREATEST(${POLL_MIN_INTERVAL_SEC}, (SELECT count(*) FROM ${races} WHERE ${races.status} = 'active') * ${SECONDS_PER_ACTIVE_RACE}) * interval '1 second')`,
          ),
        ),
      ),
    )
    .returning();

  if (!claimed) {
    return NextResponse.json({ skipped: true }, { status: 200 });
  }

  await pollActiveRace(claimed);

  let [current] = await db
    .select()
    .from(races)
    .where(eq(races.id, id))
    .limit(1);

  // Absence forfeit (issue #105): verdicts already had precedence inside
  // pollActiveRace above (a solve/timeout finish flips status away from
  // 'active'). Only if the race is still active do we check whether the OTHER
  // player has been absent past the grace window — the caller just stamped
  // their own heartbeat, so this can only ever forfeit the opponent, never the
  // caller. finishRace is idempotent, so a concurrent finisher is safe.
  const race2 = current ?? claimed;
  if (race2.status === "active") {
    const forfeited = await maybeAbsenceForfeit(race2, callerIsP1);
    if (forfeited) {
      [current] = await db
        .select()
        .from(races)
        .where(eq(races.id, id))
        .limit(1);
    }
  }

  return NextResponse.json(await buildRaceSnapshot(current ?? claimed), {
    status: 200,
  });
}
