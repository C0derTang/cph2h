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
import { pollActiveRace } from "@/lib/race/poll";
import { POLL_MIN_INTERVAL_SEC } from "@/lib/types";

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

  // DB mutex: claim the poll only if the race is active and not polled within
  // the last POLL_MIN_INTERVAL_SEC seconds. Zero rows ⇒ someone polled recently
  // (or the race isn't active) — skip and let the client refetch the snapshot.
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
            sql`now() - (${POLL_MIN_INTERVAL_SEC} * interval '1 second')`,
          ),
        ),
      ),
    )
    .returning();

  if (!claimed) {
    return NextResponse.json({ skipped: true }, { status: 200 });
  }

  await pollActiveRace(claimed);

  const [current] = await db
    .select()
    .from(races)
    .where(eq(races.id, id))
    .limit(1);

  return NextResponse.json(await buildRaceSnapshot(current ?? claimed), {
    status: 200,
  });
}
