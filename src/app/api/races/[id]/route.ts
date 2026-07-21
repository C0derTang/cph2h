/**
 * GET /api/races/[id] — race snapshot (issue #7).
 *
 * Clerk-authed and gated on a linked Codeforces account, like the mutating
 * routes. Access is further restricted to participants: a caller who is neither
 * p1 nor p2 gets 403 (spectator mode is out of scope — a non-participant must
 * not pull another race's full snapshot).
 *
 * Problem/statement fields are `null` until the race has started
 * (`now >= startedAt`) — enforced in the snapshot builder.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { races } from "@/lib/db/schema";
import { buildRaceSnapshot } from "@/lib/race/snapshot";
import { requireLinkedUser } from "@/lib/race/session";
import { isParticipant, readyTimeoutAction } from "@/lib/race/machine";
import { resolveReadyTimeout } from "@/lib/race/ready-timeout";
import { enforcePolicy } from "@/lib/ratelimit/policies";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Rate-limit first thing, keyed off the cheap Clerk userId (no DB lookup) —
  // an over-limit refetch never reaches `requireLinkedUser`'s DB call below.
  const { userId: clerkId } = await auth();
  const limited = await enforcePolicy(req, "raceSnapshot", clerkId);
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

  if (!isParticipant(race, session.user.id)) {
    return NextResponse.json({ error: "not_participant" }, { status: 403 });
  }

  // Lazy matchmade ready-deadline enforcement (issue #275). This GET is the
  // primary polling path, so it doubles as the safety net: a past-deadline
  // matchmade lobby resolves here (walkover / abort), then we RE-READ so a
  // claim loser still returns the winner's terminal snapshot. Mutation-on-GET
  // is pattern-consistent (the verdict poll already mutates on read). Challenge
  // races (null deadline) return `none` and are untouched.
  const now = new Date();
  if (readyTimeoutAction(race, now).kind !== "none") {
    await resolveReadyTimeout(race, now);
    const [resolved] = await db
      .select()
      .from(races)
      .where(eq(races.id, id))
      .limit(1);
    return NextResponse.json(await buildRaceSnapshot(resolved ?? race), {
      status: 200,
    });
  }

  return NextResponse.json(await buildRaceSnapshot(race), { status: 200 });
}
