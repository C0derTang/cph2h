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
import { isParticipant } from "@/lib/race/machine";
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

  return NextResponse.json(await buildRaceSnapshot(race), { status: 200 });
}
