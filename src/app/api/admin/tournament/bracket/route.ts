/**
 * GET /api/admin/tournament/bracket — full bracket for the admin view (issue #240).
 *
 * `requireAdmin` runs first: non-admins (and signed-out callers) get 404.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/race/session";
import { getBracket } from "@/lib/tournament/bracket-db";

export async function GET() {
  const session = await requireAdmin();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  return NextResponse.json(await getBracket());
}
