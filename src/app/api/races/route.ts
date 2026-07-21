/**
 * POST /api/races — create a challenge race (issue #7).
 *
 * Creates a `pending` race owned by the caller with a nanoid challenge token,
 * returning a {@link CreateRaceResponse} (token + shareable join URL). Requires
 * a signed-in user with a linked Codeforces account.
 *
 * Issue #64 extends the body with optional problem filters (`ratingMin`,
 * `ratingMax`, `dateFrom`, `dateTo`; validated by `raceFiltersSchema`). When
 * any filter is present, the race is only created if at least one cached
 * problem matches (`countAvailableProblems`) — otherwise the request is
 * rejected with 422 `no_problems_in_range` and nothing is persisted.
 * Filterless requests behave exactly as before this issue.
 *
 * Issue #184: after `requireLinkedUser`, a caller whose linked handle is on
 * the community cheater blocklist gets 403 `cheater_blocked` and no race is
 * created. Fail-open on list unavailability — see `src/lib/cf/cheaters.ts`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCheaterSet, isKnownCheater } from "@/lib/cf/cheaters";
import { countAvailableProblems } from "@/lib/cf/problem-availability";
import { createRace, generateChallengeToken } from "@/lib/race/create";
import { hasAnyFilter, raceFiltersSchema, toRaceProblemFilters } from "@/lib/race/filters";
import { requireLinkedUser } from "@/lib/race/session";
import { enforceDbRateLimit, RACES_CREATE_POLICY } from "@/lib/ratelimit/policies";
import {
  DEFAULT_TIME_LIMIT_SEC,
  type CreateRaceResponse,
  type RaceProblemFilters,
} from "@/lib/types";

const timeLimitSchema = z.object({
  timeLimitSec: z.number().int().positive().max(24 * 3600).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const limited = await enforceDbRateLimit(req, "races_create", session.user.id, RACES_CREATE_POLICY);
  if (limited) return limited;

  // Block known cheaters from creating a challenge (issue #184). Fail-open: a
  // null set (list unavailable) always allows.
  const cheaterSet = await getCheaterSet();
  if (session.user.cfHandle && cheaterSet && isKnownCheater(session.user.cfHandle, cheaterSet)) {
    return NextResponse.json({ error: "cheater_blocked" }, { status: 403 });
  }

  let timeLimitSec = DEFAULT_TIME_LIMIT_SEC;
  let filters: RaceProblemFilters;
  try {
    const raw = (await req.json().catch(() => undefined)) ?? {};
    const parsedTime = timeLimitSchema.parse(raw);
    if (parsedTime.timeLimitSec) timeLimitSec = parsedTime.timeLimitSec;
    filters = toRaceProblemFilters(raceFiltersSchema.parse(raw));
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (hasAnyFilter(filters)) {
    const available = await countAvailableProblems(filters);
    if (available === 0) {
      return NextResponse.json({ error: "no_problems_in_range" }, { status: 422 });
    }
  }

  const challengeToken = generateChallengeToken();
  const race = await createRace({
    p1Id: session.user.id,
    status: "pending",
    timeLimitSec,
    challengeToken,
    filters,
  });

  const joinUrl = new URL(`/challenge/${challengeToken}`, req.nextUrl.origin).toString();

  const response: CreateRaceResponse = {
    raceId: race.id,
    challengeToken,
    joinUrl,
  };
  return NextResponse.json(response, { status: 201 });
}
