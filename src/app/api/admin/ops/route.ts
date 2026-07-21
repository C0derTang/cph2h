/**
 * GET /api/admin/ops — live-ops snapshot: queue depth, active races, and
 * recent races (issue #223).
 *
 * `requireAdmin` runs first: non-admins (and signed-out callers) get 404.
 */

import { NextResponse } from "next/server";
import { getAdminOps } from "@/lib/admin/ops";
import { requireAdmin } from "@/lib/race/session";
import { enforceAdminPolicy } from "@/lib/ratelimit/policies";

export async function GET() {
  const session = await requireAdmin();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const limited = await enforceAdminPolicy(session.user.id);
  if (limited) return limited;

  const ops = await getAdminOps();
  return NextResponse.json(ops, { status: 200 });
}
