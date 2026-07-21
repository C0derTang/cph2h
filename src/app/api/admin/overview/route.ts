/**
 * GET /api/admin/overview — aggregate dashboard stats (issue #175).
 *
 * `requireAdmin` runs first: non-admins (and signed-out callers) get 404.
 */

import { NextResponse } from "next/server";
import { getAdminOverview } from "@/lib/admin/overview";
import { requireAdmin } from "@/lib/race/session";
import { enforceAdminPolicy } from "@/lib/ratelimit/policies";

export async function GET() {
  const session = await requireAdmin();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const limited = await enforceAdminPolicy(session.user.id);
  if (limited) return limited;

  const overview = await getAdminOverview();
  return NextResponse.json(overview, { status: 200 });
}
