/**
 * POST /api/livekit/token
 *
 * Mints a LiveKit room-join token for a race participant. Only p1/p2 of the
 * race may join its room; everyone else gets 403.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { races, users } from "@/lib/db/schema";
import { ensureRoom, mintToken } from "@/lib/livekit";
import { enforcePolicy } from "@/lib/ratelimit/policies";

const bodySchema = z.object({
  raceId: z.uuid(),
});

export async function POST(req: Request) {
  const { isAuthenticated, userId: clerkId } = await auth();

  const limited = await enforcePolicy(req, "livekitToken", clerkId ?? null);
  if (limited) return limited;

  if (!isAuthenticated || !clerkId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [race] = await db
    .select()
    .from(races)
    .where(eq(races.id, parsed.data.raceId))
    .limit(1);
  if (!race) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (race.p1Id !== user.id && race.p2Id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Pin an explicit empty-room timeout before the client connects, so the room
  // self-destructs once both players leave the post-race call (issue #121)
  // instead of inheriting LiveKit's implicit-on-join default. Best-effort.
  await ensureRoom(race.livekitRoom);

  const token = await mintToken({
    room: race.livekitRoom,
    identity: user.id,
    name: user.username,
  });

  return NextResponse.json({ token, url: process.env.LIVEKIT_URL });
}
