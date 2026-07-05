/**
 * POST /api/races/[id]/abort — abort / forfeit a race (issue #7).
 *
 * Pre-active (pending/ready): the race is aborted (`status='aborted'`,
 * `outcome='aborted'`), no Elo.
 *
 * Active: the caller forfeits and the opponent wins. If the #15 finish hook is
 * available it owns the resolution (including Elo); otherwise we fall back to a
 * local finish that sets outcome/winner/finishedAt but leaves Elo deltas unset —
 * Elo application is exclusively #15's responsibility.
 *
 * All writes are `UPDATE ... WHERE id=$1 AND status='<expected>' RETURNING *`.
 */

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { races, type Race } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { canAbort } from "@/lib/race/machine";
import { buildRaceSnapshot } from "@/lib/race/snapshot";
import { finishRace, publishRaceEvent } from "@/lib/race/hooks";
import type { RaceOutcome } from "@/lib/types";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }
  const userId = session.user.id;

  const [race] = await db
    .select()
    .from(races)
    .where(eq(races.id, id))
    .limit(1);

  if (!race) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const guard = canAbort(race, userId);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason, race: await buildRaceSnapshot(race) },
      { status: 409 },
    );
  }

  const now = new Date();

  // --- Pre-active: plain abort, no Elo. -----------------------------------
  if (race.status === "pending" || race.status === "ready") {
    const [aborted] = await db
      .update(races)
      .set({ status: "aborted", outcome: "aborted", finishedAt: now })
      .where(and(eq(races.id, id), inArray(races.status, ["pending", "ready"])))
      .returning();

    if (!aborted) {
      // Race started between our read and write; retry resolution as active.
      return handleActiveOrCurrent(id, userId, race);
    }

    await publishRaceEvent(aborted.id, { type: "aborted", byUserId: userId });
    return NextResponse.json(await buildRaceSnapshot(aborted), { status: 200 });
  }

  // --- Active: forfeit; opponent wins. ------------------------------------
  return handleActiveOrCurrent(id, userId, race);
}

/**
 * Resolve an abort against an active race (forfeit). Delegates to the #15 finish
 * hook when present, otherwise applies a local finish without Elo.
 */
async function handleActiveOrCurrent(id: string, userId: string, prev: Race) {
  const opponentId = userId === prev.p1Id ? prev.p2Id : prev.p1Id;
  const outcome: RaceOutcome = userId === prev.p1Id ? "p2_win" : "p1_win";
  const now = new Date();

  if (finishRace) {
    // #15 owns the authoritative finish + Elo.
    await finishRace({
      raceId: id,
      outcome,
      winnerId: opponentId,
      reason: "forfeit",
    });
    const [current] = await db
      .select()
      .from(races)
      .where(eq(races.id, id))
      .limit(1);
    return NextResponse.json(await buildRaceSnapshot(current ?? prev), {
      status: 200,
    });
  }

  // Fallback finish — no Elo (left to #15).
  const [finished] = await db
    .update(races)
    .set({
      status: "finished",
      outcome,
      winnerId: opponentId,
      finishedAt: now,
    })
    .where(and(eq(races.id, id), eq(races.status, "active")))
    .returning();

  if (!finished) {
    // Already terminal (finished/aborted by someone else) — return current.
    const [current] = await db
      .select()
      .from(races)
      .where(eq(races.id, id))
      .limit(1);
    return NextResponse.json(await buildRaceSnapshot(current ?? prev), {
      status: 200,
    });
  }

  await publishRaceEvent(finished.id, { type: "aborted", byUserId: userId });
  await publishRaceEvent(finished.id, {
    type: "race_finished",
    outcome,
    winnerId: opponentId,
    eloDeltas: {},
  });

  return NextResponse.json(await buildRaceSnapshot(finished), { status: 200 });
}
