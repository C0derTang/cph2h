/**
 * GET /api/admin/growth — signups/day + tournament registrations/day (issue #222).
 *
 * `requireAdmin` runs first: non-admins (and signed-out callers) get 404.
 */

import { NextResponse } from "next/server";
import { getAdminGrowth } from "@/lib/admin/growth";
import { requireAdmin } from "@/lib/race/session";
import { enforceAdminPolicy } from "@/lib/ratelimit/policies";

export async function GET() {
  const session = await requireAdmin();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const limited = await enforceAdminPolicy(session.user.id);
  if (limited) return limited;

  const growth = await getAdminGrowth();
  return NextResponse.json(growth, { status: 200 });
}
