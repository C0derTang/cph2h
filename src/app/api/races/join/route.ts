/**
 * POST /api/races/join — join a pending challenge race as p2 (issue #7).
 *
 * Body: `{ token }`. Rejects self-join, already-joined, and non-pending races.
 * On success the race moves `pending -> ready` via a conditional update guarded
 * on `status='pending'`; a lost race (zero rows updated) re-reads and returns
 * the current snapshot.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { races } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { canJoin } from "@/lib/race/machine";
import { buildRaceSnapshot, toPublicUser } from "@/lib/race/snapshot";
import { publishRaceEvent } from "@/lib/race/hooks";

const bodySchema = z.object({ token: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  let token: string;
  try {
    ({ token } = bodySchema.parse(await req.json()));
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const [race] = await db
    .select()
    .from(races)
    .where(eq(races.challengeToken, token))
    .limit(1);

  if (!race) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const guard = canJoin(race, session.user.id);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason, race: await buildRaceSnapshot(race) },
      { status: 409 },
    );
  }

  const [joined] = await db
    .update(races)
    .set({ p2Id: session.user.id, status: "ready" })
    .where(
      and(
        eq(races.id, race.id),
        eq(races.status, "pending"),
        isNull(races.p2Id),
      ),
    )
    .returning();

  if (!joined) {
    // Lost the race — someone else joined first. Return current state.
    const [current] = await db
      .select()
      .from(races)
      .where(eq(races.id, race.id))
      .limit(1);
    return NextResponse.json(
      { error: "conflict", race: await buildRaceSnapshot(current ?? race) },
      { status: 409 },
    );
  }

  await publishRaceEvent(joined.id, {
    type: "opponent_joined",
    user: toPublicUser(session.user),
  });

  return NextResponse.json(await buildRaceSnapshot(joined), { status: 200 });
}
