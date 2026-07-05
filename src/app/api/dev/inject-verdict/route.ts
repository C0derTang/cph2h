/**
 * POST /api/dev/inject-verdict — test-mode CF verdict simulator (issue #15).
 *
 * Enabled only when `RACE_TEST_MODE=1`; otherwise the route 404s so it can
 * never fire in production. It lets e2e tests drive a race to completion (or
 * exercise the verdict path) without hitting the real Codeforces API.
 *
 * Body: `{ raceId, userId, verdict }`.
 *  - `verdict === "OK"` ⇒ finish the race with `userId` as the winner (idempotent
 *    finish + Elo, exactly like a real solve).
 *  - otherwise ⇒ record the verdict on the user's `race_submissions` rows and
 *    publish a `verdict` hint, mirroring a non-OK final verdict from a poll.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { raceSubmissions, races } from "@/lib/db/schema";
import { finishRace } from "@/lib/race/finish";
import { publishRaceEvent as publishToRoom } from "@/lib/livekit";
import { buildRaceSnapshot } from "@/lib/race/snapshot";

const bodySchema = z.object({
  raceId: z.uuid(),
  userId: z.uuid(),
  verdict: z.string().min(1),
});

export async function POST(req: Request) {
  if (process.env.RACE_TEST_MODE !== "1") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { raceId, userId, verdict } = parsed.data;

  const [race] = await db
    .select()
    .from(races)
    .where(eq(races.id, raceId))
    .limit(1);
  if (!race) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (verdict === "OK") {
    await finishRace({
      raceId,
      outcome: userId === race.p1Id ? "p1_win" : "p2_win",
      winnerId: userId,
      reason: "solved",
    });
  } else {
    await db
      .update(raceSubmissions)
      .set({ verdict })
      .where(
        and(
          eq(raceSubmissions.raceId, raceId),
          eq(raceSubmissions.userId, userId),
        ),
      );
    await publishToRoom(race.livekitRoom, {
      type: "verdict",
      userId,
      verdict,
      cfSubmissionId: 0,
      submittedAt: new Date().toISOString(),
    });
  }

  const [current] = await db
    .select()
    .from(races)
    .where(eq(races.id, raceId))
    .limit(1);

  return NextResponse.json(await buildRaceSnapshot(current ?? race), {
    status: 200,
  });
}
