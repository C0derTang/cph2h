/**
 * GET /api/admin/reports?status=open|resolved|all — issue #175.
 *
 * `requireAdmin` runs first: non-admins (and signed-out callers) get 404, not
 * 401/403, so the admin surface isn't advertised.
 */

import { NextResponse } from "next/server";
import { listReports, parseReportStatusFilter } from "@/lib/admin/reports";
import { requireAdmin } from "@/lib/race/session";
import { enforceAdminPolicy } from "@/lib/ratelimit/policies";

export async function GET(request: Request) {
  const session = await requireAdmin();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const limited = await enforceAdminPolicy(session.user.id);
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const status = parseReportStatusFilter(searchParams.get("status"));

  const reports = await listReports(status);
  return NextResponse.json(reports, { status: 200 });
}
