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
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { queueEntries, races } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { createRace } from "@/lib/race/create";
import { bandForWait, tryPair, intersectFilters, BAND_BASE } from "@/lib/matchmaking";
import { getCheaterSet, isKnownCheater } from "@/lib/cf/cheaters";
import { countAvailableProblems } from "@/lib/cf/problem-availability";
import { hasAnyFilter, raceFiltersSchema, toRaceProblemFilters } from "@/lib/race/filters";
import { READY_DEADLINE_SEC, type QueueStatusResponse, type RaceProblemFilters } from "@/lib/types";
import { enforcePolicy } from "@/lib/ratelimit/policies";

/**
 * Create a `ready` quick-match race with the caller as p1, storing the
 * intersection of both players' filters and a ready deadline (now +
 * READY_DEADLINE_SEC) that marks the race as matchmade.
 */
async function createMatchedRace(
  meId: string,
  opponentId: string,
  filters: RaceProblemFilters,
): Promise<string> {
  const race = await createRace({
    p1Id: meId,
    p2Id: opponentId,
    status: "ready",
    filters,
    readyDeadlineAt: new Date(Date.now() + READY_DEADLINE_SEC * 1000),
  });
  return race.id;
}

/** Queue-row column values for `filters` (dates as `Date` for timestamp cols). */
function filterColumns(filters: RaceProblemFilters) {
  return {
    ratingMin: filters.ratingMin,
    ratingMax: filters.ratingMax,
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : null,
    dateTo: filters.dateTo ? new Date(filters.dateTo) : null,
  };
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

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  const limited = await enforcePolicy(req, "queueWrite", clerkId);
  if (limited) return limited;

  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const me = session.user;

  // (1) Single-instance guard: a user already in a ready/active race must not
  // queue for a second one.
  const existingRaceId = await findActiveRaceId(me.id);
  if (existingRaceId) {
    return NextResponse.json(
      { error: "already_in_race", raceId: existingRaceId },
      { status: 409 },
    );
  }

  // Block known cheaters from entering the queue (issue #184). Fail-open: a
  // null set (list unavailable) always allows.
  const cheaterSet = await getCheaterSet();
  if (me.cfHandle && cheaterSet && isKnownCheater(me.cfHandle, cheaterSet)) {
    return NextResponse.json({ error: "cheater_blocked" }, { status: 403 });
  }

  // (2) Parse optional problem filters. Missing/empty body = no filters.
  let filters: RaceProblemFilters;
  try {
    const raw = (await req.json().catch(() => undefined)) ?? {};
    filters = toRaceProblemFilters(raceFiltersSchema.parse(raw));
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // (3) With any filter set, require at least one matching problem (parity with
  // POST /api/races).
  if (hasAnyFilter(filters)) {
    const available = await countAvailableProblems(filters);
    if (available === 0) {
      return NextResponse.json({ error: "no_problems_in_range" }, { status: 422 });
    }
  }

  // (4) Pair-on-enqueue at the base band. `me` is not in the queue yet, so a hit
  // deletes only the opponent's row. Only overlapping-filter opponents match.
  const match = await tryPair({ userId: me.id, elo: me.elo, filters }, BAND_BASE, "enqueue");
  if (match) {
    const raceId = await createMatchedRace(
      me.id,
      match.opponentId,
      intersectFilters(filters, match.opponentFilters),
    );
    return NextResponse.json({ matched: true, raceId }, { status: 200 });
  }

  // (5) No opponent — join (or refresh) the queue, persisting filters + heartbeat.
  const now = new Date();
  await db
    .insert(queueEntries)
    .values({ userId: me.id, elo: me.elo, ...filterColumns(filters), lastSeenAt: now })
    .onConflictDoUpdate({
      target: queueEntries.userId,
      set: { elo: me.elo, enqueuedAt: now, ...filterColumns(filters), lastSeenAt: now },
    });

  return NextResponse.json({ matched: false }, { status: 200 });
}

// ---------------------------------------------------------------------------
// GET — status (poll)
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const { userId: clerkId } = await auth();
  const limited = await enforcePolicy(req, "queueGet", clerkId);
  if (limited) return limited;

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
      ? { state: "matched", raceId, waitedSec: null, currentBand: null, filters: null }
      : { state: "idle", raceId: null, waitedSec: null, currentBand: null, filters: null };
    return NextResponse.json(body, { status: 200 });
  }

  const now = new Date();

  // Heartbeat: the sweep purges rows by `lastSeenAt` staleness (client stopped
  // polling), not by wait time — so stamp it on every poll.
  await db
    .update(queueEntries)
    .set({ lastSeenAt: now })
    .where(eq(queueEntries.userId, me.id));

  const myFilters: RaceProblemFilters = {
    ratingMin: entry.ratingMin,
    ratingMax: entry.ratingMax,
    dateFrom: entry.dateFrom ? entry.dateFrom.toISOString() : null,
    dateTo: entry.dateTo ? entry.dateTo.toISOString() : null,
  };

  const waitedSec = Math.max(
    0,
    Math.floor((now.getTime() - entry.enqueuedAt.getTime()) / 1000),
  );
  const currentBand = bandForWait(waitedSec);

  const match = await tryPair(
    { userId: me.id, elo: entry.elo, filters: myFilters },
    currentBand,
    "poll",
  );
  if (match) {
    const raceId = await createMatchedRace(
      me.id,
      match.opponentId,
      intersectFilters(myFilters, match.opponentFilters),
    );
    const body: QueueStatusResponse = {
      state: "matched",
      raceId,
      waitedSec,
      currentBand,
      filters: null,
    };
    return NextResponse.json(body, { status: 200 });
  }

  const body: QueueStatusResponse = {
    state: "queued",
    raceId: null,
    waitedSec,
    currentBand,
    // Echo the caller's filters so a remounting client rehydrates its form;
    // null when no filter constrains selection.
    filters: hasAnyFilter(myFilters) ? myFilters : null,
  };
  return NextResponse.json(body, { status: 200 });
}

// ---------------------------------------------------------------------------
// DELETE — leave the queue
// ---------------------------------------------------------------------------

export async function DELETE(req: Request) {
  const { userId: clerkId } = await auth();
  const limited = await enforcePolicy(req, "queueWrite", clerkId);
  if (limited) return limited;

  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  await db.delete(queueEntries).where(eq(queueEntries.userId, session.user.id));
  return NextResponse.json({ ok: true }, { status: 200 });
}
