/**
 * POST /api/reports — file a report against your race opponent (issue #174).
 *
 * Auth: signed-in linked user (`requireLinkedUser`). Body: `CreateReportRequest`
 * (`src/lib/types.ts`) — `{ raceId, reason, note? }`. `reportedId` is derived
 * server-side by the pure `validateReportRequest` guard (`src/lib/race/report.ts`)
 * as the OTHER participant of the race — never taken from the client. Filing a
 * report changes nothing about the race itself; this route only inserts a row.
 *
 * One report per (race, reporter) — enforced by the `reports` table's unique
 * index — collapses to 409 `{ error: "already_reported" }` on a unique-
 * violation (Postgres code 23505, surfaced by the Neon HTTP driver as `.code`
 * on the thrown error, same shape as `pg`).
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { races, reports } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { statusForReportGuard, validateReportRequest } from "@/lib/race/report";

const bodySchema = z.object({
  raceId: z.string().min(1),
  reason: z.string().min(1),
  note: z.string().optional(),
});

/** Postgres unique_violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export async function POST(req: Request) {
  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await req.json().catch(() => undefined);
    body = bodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const [race] = await db
    .select()
    .from(races)
    .where(eq(races.id, body.raceId))
    .limit(1);

  if (!race) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const guard = validateReportRequest(race, session.user.id, {
    reason: body.reason,
    note: body.note,
  });
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason },
      { status: statusForReportGuard(guard.reason) },
    );
  }

  try {
    const [created] = await db
      .insert(reports)
      .values({
        raceId: race.id,
        reporterId: session.user.id,
        reportedId: guard.reportedId,
        reason: body.reason,
        note: body.note ?? null,
      })
      .returning({ id: reports.id });

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "already_reported" }, { status: 409 });
    }
    throw err;
  }
}
