/**
 * POST /api/races/[id]/abort — abort / forfeit a race, or decline a challenge
 * (issue #7, decline path added in #60).
 *
 * Pre-active (pending/ready): the race is aborted (`status='aborted'`,
 * `outcome='aborted'`), no Elo.
 *
 * Active: the caller forfeits and the opponent wins. If the #15 finish hook is
 * available it owns the resolution (including Elo); otherwise we fall back to a
 * local finish that sets outcome/winner/finishedAt but leaves Elo deltas unset —
 * Elo application is exclusively #15's responsibility.
 *
 * Decline (#60): a non-participant holding the challenge's `challengeToken`
 * (the link recipient, pre-join) may also abort a still-`pending` race. This
 * is gated by its own pure guard (`canDecline`) and its own atomic,
 * pending-only claim — it must never fall through to the active/forfeit path.
 *
 * All writes are `UPDATE ... WHERE id=$1 AND status='<expected>' RETURNING *`.
 */

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { races, type Race } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { canAbort, canDecline, isParticipant } from "@/lib/race/machine";
import { buildRaceSnapshot } from "@/lib/race/snapshot";
import { finishRace, publishRaceEvent } from "@/lib/race/hooks";
import type { RaceOutcome } from "@/lib/types";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => null);
  const challengeToken =
    typeof body?.challengeToken === "string" ? body.challengeToken : null;

  const [race] = await db
    .select()
    .from(races)
    .where(eq(races.id, id))
    .limit(1);

  if (!race) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!isParticipant(race, userId) && challengeToken !== null) {
    return handleDecline(id, userId, race, challengeToken);
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
 * Resolve an abort against an active race (forfeit). The #15 finish hook owns
 * the authoritative finish + Elo (idempotent — it self-guards on `status`), so
 * we delegate and re-read the resulting snapshot.
 */
async function handleActiveOrCurrent(id: string, userId: string, prev: Race) {
  const opponentId = userId === prev.p1Id ? prev.p2Id : prev.p1Id;
  const outcome: RaceOutcome = userId === prev.p1Id ? "p2_win" : "p1_win";

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

/**
 * Resolve a challenge-link decline from a non-participant (#60). Gated by the
 * pure `canDecline` guard, then an atomic **pending-only** claim: on a lost
 * race (the race moved to ready/active between our read and write) this MUST
 * return 409 and MUST NOT fall through to {@link handleActiveOrCurrent} — a
 * stale decline must never forfeit a live race.
 */
async function handleDecline(
  id: string,
  userId: string,
  race: Race,
  challengeToken: string,
) {
  const guard = canDecline(race, challengeToken);
  if (!guard.ok) {
    if (guard.reason === "invalid_token") {
      return NextResponse.json({ error: guard.reason }, { status: 403 });
    }
    return NextResponse.json(
      { error: guard.reason, race: await buildRaceSnapshot(race) },
      { status: 409 },
    );
  }

  const now = new Date();
  const [aborted] = await db
    .update(races)
    .set({ status: "aborted", outcome: "aborted", finishedAt: now })
    .where(and(eq(races.id, id), eq(races.status, "pending")))
    .returning();

  if (!aborted) {
    // TOCTOU: the race left `pending` between our read and write. Re-read and
    // report the conflict — never forfeit on a stale decline.
    const [current] = await db
      .select()
      .from(races)
      .where(eq(races.id, id))
      .limit(1);
    return NextResponse.json(
      { error: "not_pending", race: await buildRaceSnapshot(current ?? race) },
      { status: 409 },
    );
  }

  await publishRaceEvent(aborted.id, { type: "aborted", byUserId: userId });
  return NextResponse.json(await buildRaceSnapshot(aborted), { status: 200 });
}
