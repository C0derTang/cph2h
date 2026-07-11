/**
 * PATCH /api/admin/reports/[id] — resolve a report (issue #175).
 *
 * Body: `{ status: "resolved" }` (the only supported transition). The atomic
 * `WHERE status='open'` claim in `resolveReport` is the concurrency guard —
 * zero rows (already resolved, or the id doesn't exist) is a 409 per spec.
 * `requireAdmin` runs first in the handler: non-admins get 404.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveReport } from "@/lib/admin/reports";
import { requireAdmin } from "@/lib/race/session";

const resolveBodySchema = z.object({ status: z.literal("resolved") });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const { id } = await params;

  try {
    const raw = await req.json();
    resolveBodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const updated = await resolveReport(id);
  if (!updated) {
    return NextResponse.json({ error: "not_open" }, { status: 409 });
  }

  return NextResponse.json(updated, { status: 200 });
}
