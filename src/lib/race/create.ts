/**
 * Race creation (issue #7).
 *
 * `createRace` is the single insertion point shared by the challenge route
 * (this issue) and the matchmaking pairing (#14). It stamps
 * `livekitRoom = 'race-' + id`; to compute the room name in the same round-trip
 * we generate the UUID here rather than relying on the DB default.
 *
 * - Challenge races: `status: 'pending'` + a `challengeToken` (nanoid), p2 unset.
 * - Quick-match races: `status: 'ready'` with both players and no token.
 */

import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { races, type Race } from "@/lib/db/schema";
import { DEFAULT_TIME_LIMIT_SEC, type RaceStatus } from "@/lib/types";

export interface CreateRaceInput {
  p1Id: string;
  p2Id?: string;
  status: RaceStatus;
  timeLimitSec?: number;
  challengeToken?: string;
}

/** URL-safe challenge token. */
export function generateChallengeToken(): string {
  return nanoid();
}

/**
 * Insert a race, computing `livekitRoom` from the generated id. Returns the
 * inserted row.
 */
export async function createRace(input: CreateRaceInput): Promise<Race> {
  const id = crypto.randomUUID();
  const [race] = await db
    .insert(races)
    .values({
      id,
      p1Id: input.p1Id,
      p2Id: input.p2Id ?? null,
      status: input.status,
      timeLimitSec: input.timeLimitSec ?? DEFAULT_TIME_LIMIT_SEC,
      challengeToken: input.challengeToken ?? null,
      livekitRoom: `race-${id}`,
    })
    .returning();
  return race;
}
