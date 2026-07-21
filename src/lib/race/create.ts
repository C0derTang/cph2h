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
import {
  DEFAULT_TIME_LIMIT_SEC,
  type RaceProblemFilters,
  type RaceStatus,
} from "@/lib/types";

export interface CreateRaceInput {
  p1Id: string;
  p2Id?: string;
  status: RaceStatus;
  timeLimitSec?: number;
  challengeToken?: string;
  /**
   * Problem filters. Challenge flow: the challenger's picks (issue #64).
   * Matchmaking (`src/app/api/queue/route.ts`): the intersection of both
   * players' queue filters. Omitted = all four columns null.
   */
  filters?: RaceProblemFilters;
  /**
   * Matchmade races only: ready deadline (pairing time + READY_DEADLINE_SEC).
   * Omitted for challenge races — non-null marks the race as matchmade.
   */
  readyDeadlineAt?: Date;
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
  const filters = input.filters;
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
      ratingMin: filters?.ratingMin ?? null,
      ratingMax: filters?.ratingMax ?? null,
      problemDateFrom: filters?.dateFrom ? new Date(filters.dateFrom) : null,
      problemDateTo: filters?.dateTo ? new Date(filters.dateTo) : null,
      readyDeadlineAt: input.readyDeadlineAt ?? null,
    })
    .returning();
  return race;
}
