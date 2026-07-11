/**
 * GET /api/admin/reports/[id]/evidence — issue #175.
 *
 * The report plus its race's `race_submissions` timeline (the auto-attached
 * submit/solve evidence), oldest first. `requireAdmin` runs first: non-admins
 * get 404, same as an unmapped route.
 */

import { NextResponse } from "next/server";
import { getReportEvidence } from "@/lib/admin/reports";
import { requireAdmin } from "@/lib/race/session";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const { id } = await params;

  const evidence = await getReportEvidence(id);
  if (!evidence) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(evidence, { status: 200 });
}
