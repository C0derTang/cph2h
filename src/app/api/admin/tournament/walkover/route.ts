/**
 * POST /api/admin/tournament/walkover — force a pending match done in favor of
 * one of its players (issue #240).
 *
 * Body: `{ matchId: uuid, winnerId: uuid }`. `requireAdmin` runs first
 * (non-admins get 404). 400 `invalid_winner` when the winner is not a player of
 * the match; 409 `match_not_pending` when the match is missing or already done.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/race/session";
import { applyWalkover } from "@/lib/tournament/bracket-db";

const bodySchema = z.object({
  matchId: z.string().uuid(),
  winnerId: z.string().uuid(),
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

  const result = await applyWalkover(parsed.data.matchId, parsed.data.winnerId);
  if (!result.ok) {
    const status = result.error === "invalid_winner" ? 400 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true });
}
