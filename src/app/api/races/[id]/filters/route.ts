/**
 * PATCH /api/races/[id]/filters — challenger edits the problem filters in the
 * lobby (issue #66).
 *
 * Only the challenger (p1) may edit, and only while the race is still in the
 * lobby (`pending` or `ready`). The body is validated exactly like
 * `POST /api/races` (`raceFiltersSchema`: multiples of 100 in [800,3500],
 * min<=max, from<=to; an empty body clears all filters). On success a single
 * atomic statement writes the new filter columns, resets both ready flags, and
 * clears any stale `problem_selection_failed_reason`; a `filters_updated` event
 * is published (a hint — the snapshot is the source of truth).
 *
 * Guard order: 404 not found -> 403 non-challenger -> 409 wrong status -> 400
 * invalid body. The `status IN (pending, ready)` claim keeps the write from
 * disturbing a race that started concurrently (zero rows -> re-read snapshot).
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { races, type Race } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { raceFiltersSchema, toRaceProblemFilters } from "@/lib/race/filters";
import { buildRaceSnapshot } from "@/lib/race/snapshot";
import { publishRaceEvent } from "@/lib/race/hooks";
import { enforcePolicy } from "@/lib/ratelimit/policies";

const EDITABLE_STATUSES = ["pending", "ready"] as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { userId: clerkId } = await auth();
  const limited = await enforcePolicy(req, "raceFilters", clerkId);
  if (limited) return limited;

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

  // Challenger-only: p1 owns the filters.
  if (session.user.id !== race.p1Id) {
    return NextResponse.json(
      { error: "not_challenger", race: await buildRaceSnapshot(race) },
      { status: 403 },
    );
  }

  // Matchmade races have no editable filters (issue #275): the ratings are the
  // intersection of both players' queue filters and are fixed at pairing. A
  // filter PATCH resets both ready flags, which on a matchmade lobby could be
  // weaponized to keep resetting the deadline race — lock it out entirely. A
  // non-null `readyDeadlineAt` is the "came from matchmaking" discriminator.
  // Reuses the existing `not_editable` code (the client map already handles it).
  if (race.readyDeadlineAt !== null) {
    return NextResponse.json(
      { error: "not_editable", race: await buildRaceSnapshot(race) },
      { status: 409 },
    );
  }

  // Only editable while still in the lobby.
  if (race.status !== "pending" && race.status !== "ready") {
    return NextResponse.json(
      { error: "not_editable", race: await buildRaceSnapshot(race) },
      { status: 409 },
    );
  }

  let filters;
  try {
    const raw = (await req.json().catch(() => undefined)) ?? {};
    filters = toRaceProblemFilters(raceFiltersSchema.parse(raw));
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Single atomic statement: rewrite filter columns, reset ready flags, clear
  // the stale failure reason. Guarded so a concurrently-started race is untouched.
  const [updated] = await db
    .update(races)
    .set({
      ratingMin: filters.ratingMin,
      ratingMax: filters.ratingMax,
      problemDateFrom: filters.dateFrom ? new Date(filters.dateFrom) : null,
      problemDateTo: filters.dateTo ? new Date(filters.dateTo) : null,
      p1Ready: false,
      p2Ready: false,
      problemSelectionFailedReason: null,
    })
    .where(and(eq(races.id, id), inArray(races.status, [...EDITABLE_STATUSES])))
    .returning();

  if (!updated) {
    // Lost the claim — race left the lobby between the guard and the write.
    return currentSnapshot(id, race);
  }

  await publishRaceEvent(updated.id, { type: "filters_updated" });

  return NextResponse.json(await buildRaceSnapshot(updated), { status: 200 });
}

/** Re-read the row after a lost conditional update and return its snapshot. */
async function currentSnapshot(id: string, fallback: Race) {
  const [current] = await db
    .select()
    .from(races)
    .where(eq(races.id, id))
    .limit(1);
  return NextResponse.json(await buildRaceSnapshot(current ?? fallback), {
    status: 200,
  });
}
