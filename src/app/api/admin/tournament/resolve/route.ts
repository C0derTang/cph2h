/**
 * POST /api/admin/tournament/resolve — pull-based resolution of a round from its
 * finished races (issue #240).
 *
 * Body: `{ round: 1..6 }`. `requireAdmin` runs first (non-admins get 404).
 * Idempotent: re-clicking a resolved round advances nothing further.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/race/session";
import { TOURNAMENT_TOTAL_ROUNDS } from "@/lib/types";
import { resolveRound } from "@/lib/tournament/bracket-db";

const bodySchema = z.object({
  round: z.number().int().min(1).max(TOURNAMENT_TOTAL_ROUNDS),
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

  const result = await resolveRound(parsed.data.round);
  return NextResponse.json(result);
}
