/**
 * GET /api/races/[id] — race snapshot (issue #7).
 *
 * Returns the {@link RaceSnapshot}. Problem/statement fields are `null` until
 * the race has started (`now >= startedAt`) — enforced in the snapshot builder.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { races } from "@/lib/db/schema";
import { buildRaceSnapshot } from "@/lib/race/snapshot";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [race] = await db
    .select()
    .from(races)
    .where(eq(races.id, id))
    .limit(1);

  if (!race) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(await buildRaceSnapshot(race), { status: 200 });
}
