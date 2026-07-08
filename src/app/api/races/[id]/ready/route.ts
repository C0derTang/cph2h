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
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { races, users, type Race } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { canReady, canStart, nextOnBothReady } from "@/lib/race/machine";
import { buildRaceSnapshot } from "@/lib/race/snapshot";
import { publishRaceEvent, refreshSeenProblems, selectRaceProblem } from "@/lib/race/hooks";

/**
 * Soft timeout (ms) for the best-effort solve-history refresh (issue #69)
 * run for both players before problem selection. The refresh itself never
 * throws, but CF can be slow — this bounds how long the ready path waits on
 * it regardless, so a slow/down CF never stalls the race from starting.
 */
const HISTORY_REFRESH_TIMEOUT_MS = 3500;

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

  // Both ready: best-effort, unconditional refresh of each player's CF solve
  // history (issue #69, always-refresh fix #98) so problems solved since
  // their last sync — including moments ago, with a still-fresh `syncedAt`
  // — are excluded from this selection. Never allowed to fail or stall the
  // ready path past the soft timeout above — CF being slow or down still
  // lets the race start.
  await refreshBothPlayersSeenProblems(afterReady);

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

/**
 * Best-effort, parallel refresh of both players' CF solve history before
 * problem selection (issue #69). Wrapped in try/catch and a `Promise.race`
 * soft timeout: this must never throw out of the ready path, and must never
 * hold up problem selection past {@link HISTORY_REFRESH_TIMEOUT_MS} even if
 * CF is slow or unreachable — the in-flight refresh(es) may keep running in
 * the background, but the ready request stops waiting on them.
 */
async function refreshBothPlayersSeenProblems(race: Race): Promise<void> {
  const playerIds = [race.p1Id, race.p2Id].filter(
    (id): id is string => id !== null,
  );

  try {
    const players = await db
      .select({
        id: users.id,
        cfHandle: users.cfHandle,
        solveHistorySyncedAt: users.solveHistorySyncedAt,
        solveHistoryImportCursor: users.solveHistoryImportCursor,
      })
      .from(users)
      .where(inArray(users.id, playerIds));

    const refreshAll = Promise.all(
      players.map((player) => refreshSeenProblems(player)),
    ).then(() => undefined);

    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, HISTORY_REFRESH_TIMEOUT_MS);
    });
    try {
      await Promise.race([refreshAll, timeout]);
    } finally {
      clearTimeout(timeoutId!);
    }
  } catch (err) {
    // Best-effort: a lookup or refresh failure must never block the ready
    // path or fail this request (selection just runs against a stale/partial
    // exclusion set).
    console.error("[race] solve-history refresh before selection failed", err);
  }
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
