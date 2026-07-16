/**
 * GET /api/admin/growth — signups/day + tournament registrations/day (issue #222).
 *
 * `requireAdmin` runs first: non-admins (and signed-out callers) get 404.
 */

import { NextResponse } from "next/server";
import { getAdminGrowth } from "@/lib/admin/growth";
import { requireAdmin } from "@/lib/race/session";

export async function GET() {
  const session = await requireAdmin();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const growth = await getAdminGrowth();
  return NextResponse.json(growth, { status: 200 });
}
