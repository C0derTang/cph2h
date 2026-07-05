/**
 * POST /api/races/[id]/ready — mark caller ready (issue #7).
 *
 * Sets the caller's ready flag (conditional on `status='ready'`). When both
 * players are ready, atomically transitions `ready -> active`: picks the problem
 * (via the injected {@link selectRaceProblem} hook — stubbed until #6) and
 * applies {@link nextOnBothReady} (startedAt = now + countdown, endsAt derived).
 *
 * All writes are `UPDATE ... WHERE id=$1 AND status='ready' RETURNING *`; a lost
 * race (zero rows) re-reads and returns the current snapshot. LiveKit publishing
 * is behind the {@link publishRaceEvent} hook (no-op until #8/#17).
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { races, type Race } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { canReady, nextOnBothReady } from "@/lib/race/machine";
import { buildRaceSnapshot } from "@/lib/race/snapshot";
import { publishRaceEvent, selectRaceProblem } from "@/lib/race/hooks";

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

  const guard = canReady(race, session.user.id);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason, race: await buildRaceSnapshot(race) },
      { status: 409 },
    );
  }

  const setReady =
    session.user.id === race.p1Id ? { p1Ready: true } : { p2Ready: true };

  const [afterReady] = await db
    .update(races)
    .set(setReady)
    .where(and(eq(races.id, id), eq(races.status, "ready")))
    .returning();

  if (!afterReady) {
    return currentSnapshot(id, race);
  }

  await publishRaceEvent(afterReady.id, {
    type: "ready_state",
    p1Ready: afterReady.p1Ready,
    p2Ready: afterReady.p2Ready,
  });

  // Not both ready yet — nothing more to do.
  if (!(afterReady.p1Ready && afterReady.p2Ready)) {
    return NextResponse.json(await buildRaceSnapshot(afterReady), { status: 200 });
  }

  // Both ready: transition ready -> active.
  const now = new Date();
  const transition = nextOnBothReady(afterReady, now);
  const problemId = await selectRaceProblem(afterReady); // #6 hook (stub -> null)

  const [started] = await db
    .update(races)
    .set({
      status: transition.status,
      startedAt: transition.startedAt,
      endsAt: transition.endsAt,
      problemId,
    })
    .where(and(eq(races.id, id), eq(races.status, "ready")))
    .returning();

  if (!started) {
    // Opponent's concurrent ready won the start transition.
    return currentSnapshot(id, afterReady);
  }

  await publishRaceEvent(started.id, {
    type: "countdown",
    startsAt: transition.startedAt.toISOString(),
    endsAt: transition.endsAt.toISOString(),
  });

  return NextResponse.json(await buildRaceSnapshot(started, now), { status: 200 });
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
