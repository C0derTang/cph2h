/**
 * GET /api/problems/availability — live problem-count feedback for the
 * challenge-creation filter form (issue #64).
 *
 * Thin authed route (same gate as `POST /api/races`): validates the query
 * params against `raceFiltersSchema` (after coercing the numeric rating
 * params, since query params always arrive as strings) and returns
 * `{ count }` from `countAvailableProblems`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { countAvailableProblems } from "@/lib/cf/problem-availability";
import { raceFiltersSchema, toRaceProblemFilters } from "@/lib/race/filters";
import { requireLinkedUser } from "@/lib/race/session";

export async function GET(req: NextRequest) {
  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const params = req.nextUrl.searchParams;
  const raw: Record<string, unknown> = {};
  const ratingMin = params.get("ratingMin");
  const ratingMax = params.get("ratingMax");
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  if (ratingMin !== null) raw.ratingMin = Number(ratingMin);
  if (ratingMax !== null) raw.ratingMax = Number(ratingMax);
  if (dateFrom !== null) raw.dateFrom = dateFrom;
  if (dateTo !== null) raw.dateTo = dateTo;

  const parsed = raceFiltersSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const count = await countAvailableProblems(toRaceProblemFilters(parsed.data));
  return NextResponse.json({ count });
}
