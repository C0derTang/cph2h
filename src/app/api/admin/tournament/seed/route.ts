/**
 * POST /api/admin/tournament/seed — seed (or re-seed) the bracket (issue #240).
 *
 * Body: `{ force?: boolean }`. `requireAdmin` runs first (non-admins get 404).
 * 409 `bracket_exists` when a bracket already exists and `!force`; 400
 * `no_registrants` when nobody eligible is registered.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/race/session";
import { seedBracket } from "@/lib/tournament/bracket-db";

const bodySchema = z.object({ force: z.boolean().optional() });

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await seedBracket({ force: parsed.data.force ?? false });
  if (!result.ok) {
    const status = result.error === "bracket_exists" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.data);
}
