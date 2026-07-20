/**
 * POST /api/admin/tournament/create-races — create `ready` races for a round's
 * playable matches (issue #240).
 *
 * Body: `{ round: 1..6, ratingMin?, ratingMax? }`. `requireAdmin` runs first
 * (non-admins get 404). The optional rating bounds are the per-round difficulty
 * passthrough into problem selection.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/race/session";
import { TOURNAMENT_TOTAL_ROUNDS } from "@/lib/types";
import { createRacesForRound } from "@/lib/tournament/bracket-db";

const bodySchema = z.object({
  round: z.number().int().min(1).max(TOURNAMENT_TOTAL_ROUNDS),
  ratingMin: z.number().int().optional(),
  ratingMax: z.number().int().optional(),
});

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { round, ratingMin, ratingMax } = parsed.data;
  const result = await createRacesForRound(round, { ratingMin, ratingMax });
  return NextResponse.json(result);
}
