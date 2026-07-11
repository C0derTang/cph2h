/**
 * /api/queue — quick-match matchmaking queue (issue #14).
 *
 * All handlers require a signed-in user with a linked Codeforces account
 * (`requireLinkedUser`, gated on `cfLinkedAt`).
 *
 *  - POST   enqueue: blocks known cheaters (issue #184), else tries to pair
 *           immediately (band 100); on a hit create a `ready` race, else
 *           upsert the caller's queue row.
 *  - GET    status: if the caller's queue row is gone, report their newest
 *           ready/active race; otherwise widen the band by wait time, retry
 *           pairing, and report progress.
 *  - DELETE leave: remove the caller's queue row.
 *
 * Pairing atomicity is handled inside `tryPair` (single SQL statement with
 * `FOR UPDATE SKIP LOCKED`); see `src/lib/matchmaking.ts`.
 *
 * The cheater check is enqueue-only per issue #184 (not GET/DELETE) — a
 * blocked handle never gets a queue row in the first place, so there is
 * nothing to further gate on poll/leave.
 */

import { NextResponse } from "next/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { queueEntries, races } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { createRace } from "@/lib/race/create";
import { bandForWait, tryPair, BAND_BASE } from "@/lib/matchmaking";
import { getCheaterSet, isKnownCheater } from "@/lib/cf/cheaters";
import type { QueueStatusResponse } from "@/lib/types";

/** Create a `ready` quick-match race with the caller as p1. */
async function createReadyRace(meId: string, opponentId: string): Promise<string> {
  const race = await createRace({ p1Id: meId, p2Id: opponentId, status: "ready" });
  return race.id;
}

/** Newest race the caller is part of that is still ready/active, if any. */
async function findActiveRaceId(meId: string): Promise<string | null> {
  const [race] = await db
    .select({ id: races.id })
    .from(races)
    .where(
      and(
        or(eq(races.p1Id, meId), eq(races.p2Id, meId)),
        inArray(races.status, ["ready", "active"]),
      ),
    )
    .orderBy(desc(races.createdAt))
    .limit(1);
  return race?.id ?? null;
}

// ---------------------------------------------------------------------------
// POST — enqueue
// ---------------------------------------------------------------------------

export async function POST() {
  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const me = session.user;

  // Block known cheaters from entering the queue (issue #184). Fail-open: a
  // null set (list unavailable) always allows.
  const cheaterSet = await getCheaterSet();
  if (me.cfHandle && cheaterSet && isKnownCheater(me.cfHandle, cheaterSet)) {
    return NextResponse.json({ error: "cheater_blocked" }, { status: 403 });
  }

  // Pair-on-enqueue at the base band. `me` is not in the queue yet, so a hit
  // deletes only the opponent's row.
  const matchedId = await tryPair({ userId: me.id, elo: me.elo }, BAND_BASE, "enqueue");
  if (matchedId) {
    const raceId = await createReadyRace(me.id, matchedId);
    return NextResponse.json({ matched: true, raceId }, { status: 200 });
  }

  // No opponent — join (or refresh) the queue.
  await db
    .insert(queueEntries)
    .values({ userId: me.id, elo: me.elo })
    .onConflictDoUpdate({
      target: queueEntries.userId,
      set: { elo: me.elo, enqueuedAt: new Date() },
    });

  return NextResponse.json({ matched: false }, { status: 200 });
}

// ---------------------------------------------------------------------------
// GET — status (poll)
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const me = session.user;

  const [entry] = await db
    .select()
    .from(queueEntries)
    .where(eq(queueEntries.userId, me.id))
    .limit(1);

  // Not in the queue: either we were matched (by an opponent's pairing) or idle.
  if (!entry) {
    const raceId = await findActiveRaceId(me.id);
    const body: QueueStatusResponse = raceId
      ? { state: "matched", raceId, waitedSec: null, currentBand: null }
      : { state: "idle", raceId: null, waitedSec: null, currentBand: null };
    return NextResponse.json(body, { status: 200 });
  }

  const waitedSec = Math.max(
    0,
    Math.floor((Date.now() - entry.enqueuedAt.getTime()) / 1000),
  );
  const currentBand = bandForWait(waitedSec);

  const matchedId = await tryPair({ userId: me.id, elo: entry.elo }, currentBand, "poll");
  if (matchedId) {
    const raceId = await createReadyRace(me.id, matchedId);
    const body: QueueStatusResponse = {
      state: "matched",
      raceId,
      waitedSec,
      currentBand,
    };
    return NextResponse.json(body, { status: 200 });
  }

  const body: QueueStatusResponse = {
    state: "queued",
    raceId: null,
    waitedSec,
    currentBand,
  };
  return NextResponse.json(body, { status: 200 });
}

// ---------------------------------------------------------------------------
// DELETE — leave the queue
// ---------------------------------------------------------------------------

export async function DELETE() {
  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  await db.delete(queueEntries).where(eq(queueEntries.userId, session.user.id));
  return NextResponse.json({ ok: true }, { status: 200 });
}
