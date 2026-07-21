/**
 * POST /api/races/[id]/draw — mutual-consent draw offers (issue #53).
 *
 * Body `{ action: "offer" | "accept" | "decline" }`.
 *  - offer:   set `draw_offer_by = me` (active only); publish `draw_offered`.
 *             Re-offering by the same player is a no-op-ok.
 *  - accept:  requires an outstanding offer from the *opponent*; delegates the
 *             actual finish to `finishRace` (idempotent — see `finish.ts`), so
 *             a lost race to a concurrent finisher/abort is a safe no-op.
 *  - decline: clears `draw_offer_by` (either side may clear — the opponent
 *             declines, or the offerer withdraws); publishes `draw_declined`.
 *
 * All state-changing writes are atomic
 * `UPDATE ... WHERE id=$1 AND status='active' RETURNING *`, consistent with
 * the rest of the race lifecycle. A lone offer never finishes the race — only
 * a mutual accept does, via `finishRace`.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { races, type Race } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import {
  canAcceptDraw,
  canDeclineDraw,
  canOfferDraw,
  type GuardResult,
} from "@/lib/race/machine";
import { buildRaceSnapshot } from "@/lib/race/snapshot";
import { finishRace } from "@/lib/race/hooks";
import { publishRaceEvent } from "@/lib/livekit";
import { enforcePolicy } from "@/lib/ratelimit/policies";

const bodySchema = z.object({
  action: z.enum(["offer", "accept", "decline"]),
});

/** Guard failures are 403 for a non-participant, 409 for any other reason. */
function statusForGuard(guard: Extract<GuardResult, { ok: false }>): number {
  return guard.reason === "not_participant" ? 403 : 409;
}

async function loadRace(id: string): Promise<Race | undefined> {
  const [race] = await db.select().from(races).where(eq(races.id, id)).limit(1);
  return race;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { userId: clerkId } = await auth();
  const limited = await enforcePolicy(req, "raceDraw", clerkId);
  if (limited) return limited;

  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }
  const userId = session.user.id;

  let action: "offer" | "accept" | "decline";
  try {
    const raw = await req.json().catch(() => undefined);
    action = bodySchema.parse(raw).action;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const race = await loadRace(id);
  if (!race) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (action === "offer") {
    const guard = canOfferDraw(race, userId);
    if (!guard.ok) {
      return NextResponse.json(
        { error: guard.reason, race: await buildRaceSnapshot(race) },
        { status: statusForGuard(guard) },
      );
    }

    const [updated] = await db
      .update(races)
      .set({ drawOfferBy: userId })
      .where(and(eq(races.id, id), eq(races.status, "active")))
      .returning();

    if (!updated) {
      // Lost the race between our read and write (e.g. it just finished).
      const current = (await loadRace(id)) ?? race;
      return NextResponse.json(
        { error: "not_active", race: await buildRaceSnapshot(current) },
        { status: 409 },
      );
    }

    await publishRaceEvent(updated.livekitRoom, {
      type: "draw_offered",
      byUserId: userId,
    });
    return NextResponse.json(await buildRaceSnapshot(updated), { status: 200 });
  }

  if (action === "accept") {
    const guard = canAcceptDraw(race, userId);
    if (!guard.ok) {
      return NextResponse.json(
        { error: guard.reason, race: await buildRaceSnapshot(race) },
        { status: statusForGuard(guard) },
      );
    }

    // The `canAcceptDraw` check above is only a fast, friendly rejection: it
    // read `race` once at the top of the handler, so between that read and now
    // the offerer could have withdrawn (decline → draw_offer_by = NULL, still
    // active) or the race could have ended. `finishRace`'s only atomic
    // condition is `status='active'` — it never re-checks `draw_offer_by`, so
    // finishing off the stale read would finalize a draw (and Elo) on consent
    // that no longer exists. Atomically *consume* the opponent's specific offer
    // as the real gate: only a row that still has THIS opponent's outstanding
    // offer in an active race clears it and proceeds to finish.
    const opponentId = userId === race.p1Id ? race.p2Id : race.p1Id;
    const [claimed] = await db
      .update(races)
      .set({ drawOfferBy: null })
      .where(
        and(
          eq(races.id, id),
          eq(races.status, "active"),
          eq(races.drawOfferBy, opponentId as string),
        ),
      )
      .returning();

    if (!claimed) {
      // Offer was withdrawn/declined, or the race is no longer active — the
      // consent we saw is gone. Do NOT finish.
      const current = (await loadRace(id)) ?? race;
      const reason = current.status === "active" ? "no_draw_offer" : "not_active";
      return NextResponse.json(
        { error: reason, race: await buildRaceSnapshot(current) },
        { status: 409 },
      );
    }

    // We consumed a still-valid offer. finishRace is idempotent (its own
    // active -> finished claim), so a concurrent solve/timeout finish is safe.
    await finishRace({
      raceId: id,
      outcome: "draw",
      winnerId: null,
      reason: "agreement",
    });

    const current = (await loadRace(id)) ?? claimed;
    return NextResponse.json(await buildRaceSnapshot(current), { status: 200 });
  }

  // action === "decline"
  const guard = canDeclineDraw(race, userId);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason, race: await buildRaceSnapshot(race) },
      { status: statusForGuard(guard) },
    );
  }

  const [updated] = await db
    .update(races)
    .set({ drawOfferBy: null })
    .where(and(eq(races.id, id), eq(races.status, "active")))
    .returning();

  if (!updated) {
    const current = (await loadRace(id)) ?? race;
    return NextResponse.json(
      { error: "not_active", race: await buildRaceSnapshot(current) },
      { status: 409 },
    );
  }

  await publishRaceEvent(updated.livekitRoom, {
    type: "draw_declined",
    byUserId: userId,
  });
  return NextResponse.json(await buildRaceSnapshot(updated), { status: 200 });
}
