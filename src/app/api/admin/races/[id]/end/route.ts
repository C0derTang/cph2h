/**
 * POST /api/admin/races/[id]/end — admin forcibly ends a race (issue #296).
 *
 * Mirrors `src/app/api/admin/reports/[id]/route.ts`: `requireAdmin` (404-shaped
 * failure) → `enforceAdminPolicy` (429) → zod body parse (400) → load race
 * (404) → pure `decideAdminRaceEnd` → apply.
 *
 * Two terminal actions:
 * - **abort** — one atomic claim `WHERE id=$1 AND status IN (pending,ready,
 *   active)`; zero rows → 409. Applies NO Elo by design (the claim is mutually
 *   exclusive with `finishRace`'s `status='active'` claim, so no double/half
 *   Elo). Publishes an `aborted` hint like the player abort route.
 * - **declare_winner** — delegates to `finishRace` (the sole idempotent Elo
 *   mutex; publishes `race_finished` itself). Re-reads: `finished` → 200, else
 *   409 (lost a TOCTOU to a concurrent abort/finish). `reason:"forfeit"` is
 *   informational and never persisted.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { races } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/race/session";
import { enforceAdminPolicy } from "@/lib/ratelimit/policies";
import { decideAdminRaceEnd } from "@/lib/admin/race-end";
import { finishRace, publishRaceEvent } from "@/lib/race/hooks";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("abort") }),
  z.object({ action: z.literal("declare_winner"), winnerId: z.string().min(1) }),
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const limited = await enforceAdminPolicy(session.user.id);
  if (limited) return limited;

  const { id } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const [race] = await db.select().from(races).where(eq(races.id, id)).limit(1);
  if (!race) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const decision = decideAdminRaceEnd(race, body);

  if (decision.kind === "reject") {
    return NextResponse.json({ error: decision.reason }, { status: decision.http });
  }

  // --- Abort: atomic claim over the non-terminal statuses, no Elo. ---------
  if (decision.kind === "abort") {
    const now = new Date();
    const [aborted] = await db
      .update(races)
      .set({ status: "aborted", outcome: "aborted", finishedAt: now })
      .where(
        and(
          eq(races.id, id),
          inArray(races.status, ["pending", "ready", "active"]),
        ),
      )
      .returning();

    if (!aborted) {
      return NextResponse.json({ error: "conflict" }, { status: 409 });
    }

    await publishRaceEvent(id, { type: "aborted", byUserId: session.user.id });

    return NextResponse.json(
      {
        id: aborted.id,
        status: aborted.status,
        outcome: aborted.outcome,
        winnerId: aborted.winnerId,
        finishedAt: aborted.finishedAt?.toISOString() ?? null,
      },
      { status: 200 },
    );
  }

  // --- Declare winner: finishRace owns the finish + Elo (idempotent). ------
  await finishRace({
    raceId: id,
    outcome: decision.outcome,
    winnerId: decision.winnerId,
    reason: "forfeit",
  });

  const [current] = await db.select().from(races).where(eq(races.id, id)).limit(1);
  if (!current || current.status !== "finished") {
    // Lost the claim to a concurrent abort/finish between decision and re-read.
    return NextResponse.json({ error: "conflict" }, { status: 409 });
  }

  return NextResponse.json(
    {
      id: current.id,
      status: current.status,
      outcome: current.outcome,
      winnerId: current.winnerId,
      finishedAt: current.finishedAt?.toISOString() ?? null,
    },
    { status: 200 },
  );
}
