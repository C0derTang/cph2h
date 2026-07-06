/**
 * POST /api/races/[id]/ready — mark caller ready (issue #7).
 *
 * Sets the caller's ready flag (conditional on `status='ready'`) and clears any
 * stale problem-selection failure reason. When both players are ready, it
 * selects a filter-conforming, unseen problem via the injected
 * {@link selectRaceProblem} hook BEFORE any transition (issue #66):
 * - On success it atomically transitions `ready -> active` with the concrete
 *   problem id and applies {@link nextOnBothReady} (startedAt = now + countdown,
 *   endsAt derived). The race can never enter `active` with a null problem.
 * - On failure (no conforming/unseen problem) it does NOT transition: a single
 *   atomic `UPDATE` resets both ready flags and persists the reason, and a
 *   `problem_selection_failed` event is published (a hint; the snapshot is the
 *   truth). Both players land back in the lobby with the reason.
 *
 * All writes are `UPDATE ... WHERE id=$1 AND status='ready' RETURNING *`; a lost
 * race (zero rows) re-reads and returns the current snapshot. This keeps the
 * no-match path safe and idempotent under concurrent double-ready. LiveKit
 * publishing is behind the {@link publishRaceEvent} hook.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { races, type Race } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { canReady, canStart, nextOnBothReady } from "@/lib/race/machine";
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

  // Clear any stale failure reason from a previous no-match attempt as this
  // ready attempt begins (conditional on the race still being in `ready`).
  const [afterReady] = await db
    .update(races)
    .set({ ...setReady, problemSelectionFailedReason: null })
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
  if (!canStart(afterReady).ok) {
    return NextResponse.json(await buildRaceSnapshot(afterReady), { status: 200 });
  }

  // Both ready: attempt to select a filter-conforming, unseen problem BEFORE
  // any transition — the race must never enter `active` with a null problem.
  const selection = await selectRaceProblem(afterReady);

  if (!selection.ok) {
    // No conforming problem: stay in the lobby. Atomically reset both ready
    // flags and persist the reason (single Neon-safe statement); do NOT
    // transition to active. Snapshot is the source of truth; the event is a
    // hint. The `status='ready' AND both-flags-still-set` guard makes this
    // safe under concurrent double-ready, never disturbs a race another
    // writer already started, and — like the transition below — is
    // invalidated by a concurrent PATCH /filters flag reset (whose cleared
    // reason/new filters must not be clobbered by this stale-filter result).
    const [reset] = await db
      .update(races)
      .set({
        p1Ready: false,
        p2Ready: false,
        problemSelectionFailedReason: selection.reason,
      })
      .where(
        and(
          eq(races.id, id),
          eq(races.status, "ready"),
          eq(races.p1Ready, true),
          eq(races.p2Ready, true),
        ),
      )
      .returning();

    if (!reset) {
      return currentSnapshot(id, afterReady);
    }

    await publishRaceEvent(reset.id, {
      type: "problem_selection_failed",
      reason: selection.reason,
    });

    return NextResponse.json(await buildRaceSnapshot(reset), { status: 200 });
  }

  // Success: transition ready -> active with a concrete, non-null problem.
  // The claim requires BOTH ready flags to still be set (not just
  // status='ready'): a concurrent PATCH /filters resets the flags without
  // changing status, and a start selected under the old filters must not fire
  // after the filters changed. Zero rows = claim lost, re-read.
  const now = new Date();
  const transition = nextOnBothReady(afterReady, now);

  const [started] = await db
    .update(races)
    .set({
      status: transition.status,
      startedAt: transition.startedAt,
      endsAt: transition.endsAt,
      problemId: selection.problemId,
      problemSelectionFailedReason: null,
    })
    .where(
      and(
        eq(races.id, id),
        eq(races.status, "ready"),
        eq(races.p1Ready, true),
        eq(races.p2Ready, true),
      ),
    )
    .returning();

  if (!started) {
    // Lost the claim: the opponent's concurrent ready won the start
    // transition, or a concurrent filter edit reset the ready flags.
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
