/**
 * POST /api/races/[id]/heartbeat — freeze-beacon presence stamp (issue #303).
 *
 * Fired by `navigator.sendBeacon` from the race room when the tab is about to
 * be backgrounded or frozen (`visibilitychange` → hidden / Page Lifecycle
 * `freeze`): sendBeacon survives tab freeze/unload and carries cookies, so
 * Clerk auth works and the player's `pN_last_seen_at` gets one last stamp
 * before their timers stop. This narrows the false-absence window when Chrome
 * throttles/freezes the backgrounded tab while its player submits on
 * codeforces.com.
 *
 * Deliberately minimal: no body parsing (sendBeacon payloads are opaque and
 * unneeded), no snapshot build, 204 on success. `stampHeartbeat` no-ops
 * unless the race is `active`, and only the authenticated participant's OWN
 * side is ever stamped — this route can never touch the opponent's heartbeat
 * and never makes any forfeit decision.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { races } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { isParticipant } from "@/lib/race/machine";
import { stampHeartbeat } from "@/lib/race/poll";
import { enforcePolicy } from "@/lib/ratelimit/policies";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Rate-limit first thing, keyed off the cheap Clerk userId (no DB lookup) —
  // an over-limit caller never reaches `requireLinkedUser`'s DB call below.
  // Shares the poll route's `racePoll` policy: beacons are rare (a handful of
  // hide/freeze transitions per race) next to the ~10/min poll cadence, so
  // one shared per-user bucket comfortably covers both.
  const { userId: clerkId } = await auth();
  const limited = await enforcePolicy(req, "racePoll", clerkId);
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

  await stampHeartbeat(id, race.p1Id === session.user.id);
  return new NextResponse(null, { status: 204 });
}
