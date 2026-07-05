/**
 * POST /api/races — create a challenge race (issue #7).
 *
 * Creates a `pending` race owned by the caller with a nanoid challenge token,
 * returning a {@link CreateRaceResponse} (token + shareable join URL). Requires
 * a signed-in user with a linked Codeforces account.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createRace, generateChallengeToken } from "@/lib/race/create";
import { requireLinkedUser } from "@/lib/race/session";
import {
  DEFAULT_TIME_LIMIT_SEC,
  type CreateRaceResponse,
} from "@/lib/types";

const bodySchema = z
  .object({
    timeLimitSec: z.number().int().positive().max(24 * 3600).optional(),
  })
  .optional();

export async function POST(req: NextRequest) {
  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  let timeLimitSec = DEFAULT_TIME_LIMIT_SEC;
  try {
    const raw = await req.json().catch(() => undefined);
    const parsed = bodySchema.parse(raw ?? undefined);
    if (parsed?.timeLimitSec) timeLimitSec = parsed.timeLimitSec;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const challengeToken = generateChallengeToken();
  const race = await createRace({
    p1Id: session.user.id,
    status: "pending",
    timeLimitSec,
    challengeToken,
  });

  const joinUrl = new URL(`/challenge/${challengeToken}`, req.nextUrl.origin).toString();

  const response: CreateRaceResponse = {
    raceId: race.id,
    challengeToken,
    joinUrl,
  };
  return NextResponse.json(response, { status: 201 });
}
