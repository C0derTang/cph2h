/**
 * Race snapshot builder (issue #7).
 *
 * Assembles the client-facing {@link RaceSnapshot} from a race row. The
 * problem/statement fields stay `null` until the race has actually started
 * (`now >= startedAt`) — enforced via {@link isProblemVisible} — so the
 * upcoming problem can never leak during the pre-start countdown.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  problems,
  problemStatements,
  raceSubmissions,
  users,
  type Race,
  type User,
} from "@/lib/db/schema";
import {
  problemUrl,
  type ProblemRef,
  type ProblemSelectionFailureReason,
  type ProblemStatement,
  type PublicUser,
  type RaceProblemFilters,
  type RaceSnapshot,
  type RaceSubmissionInfo,
} from "@/lib/types";
import { isProblemVisible } from "@/lib/race/machine";

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    cfHandle: user.cfHandle,
    cfRating: user.cfRating,
    elo: user.elo,
    racesPlayed: user.racesPlayed,
  };
}

/** Build the full snapshot for a race row. `now` is injected for testability. */
export async function buildRaceSnapshot(
  race: Race,
  now: Date = new Date(),
): Promise<RaceSnapshot> {
  const playerIds = [race.p1Id, race.p2Id].filter(
    (id): id is string => id !== null,
  );

  const playerRows = await db
    .select()
    .from(users)
    .where(inArray(users.id, playerIds));
  const byId = new Map(playerRows.map((u) => [u.id, u]));

  const p1Row = byId.get(race.p1Id);
  const p1: PublicUser = p1Row ? toPublicUser(p1Row) : placeholderUser(race.p1Id);
  const p2Row = race.p2Id ? byId.get(race.p2Id) : undefined;
  const p2: PublicUser | null = p2Row ? toPublicUser(p2Row) : null;

  const submissionRows = await db
    .select()
    .from(raceSubmissions)
    .where(eq(raceSubmissions.raceId, race.id));

  const submissions: RaceSubmissionInfo[] = submissionRows.map((s) => ({
    userId: s.userId,
    cfSubmissionId: s.cfSubmissionId ?? null,
    verdict: s.verdict ?? null,
    submittedAt: s.submittedAt.toISOString(),
  }));

  let problem: ProblemRef | null = null;
  let statement: ProblemStatement | null = null;

  if (race.problemId && isProblemVisible(race, now)) {
    const [problemRow] = await db
      .select()
      .from(problems)
      .where(eq(problems.id, race.problemId))
      .limit(1);

    if (problemRow) {
      problem = {
        id: problemRow.id,
        contestId: problemRow.contestId,
        index: problemRow.index,
        name: problemRow.name,
        rating: problemRow.rating,
        url: problemUrl(problemRow),
      };

      const [statementRow] = await db
        .select()
        .from(problemStatements)
        .where(eq(problemStatements.problemId, race.problemId))
        .limit(1);

      if (statementRow) {
        statement = {
          problemId: statementRow.problemId,
          html: statementRow.html,
          samples: statementRow.samples,
        };
      }
    }
  }

  const hasFilters =
    race.ratingMin !== null ||
    race.ratingMax !== null ||
    race.problemDateFrom !== null ||
    race.problemDateTo !== null;
  const filters: RaceProblemFilters | null = hasFilters
    ? {
        ratingMin: race.ratingMin,
        ratingMax: race.ratingMax,
        dateFrom: race.problemDateFrom?.toISOString() ?? null,
        dateTo: race.problemDateTo?.toISOString() ?? null,
      }
    : null;

  return {
    id: race.id,
    now: now.toISOString(),
    status: race.status,
    p1,
    p2,
    p1Ready: race.p1Ready,
    p2Ready: race.p2Ready,
    timeLimitSec: race.timeLimitSec,
    startedAt: race.startedAt?.toISOString() ?? null,
    endsAt: race.endsAt?.toISOString() ?? null,
    finishedAt: race.finishedAt?.toISOString() ?? null,
    outcome: race.outcome,
    winnerId: race.winnerId,
    eloDeltaP1: race.eloDeltaP1,
    eloDeltaP2: race.eloDeltaP2,
    problem,
    statement,
    submissions,
    livekitRoom: race.livekitRoom,
    challengeToken: race.challengeToken,
    drawOfferBy: race.drawOfferBy ?? null,
    p1LastSeenAt: race.p1LastSeenAt?.toISOString() ?? null,
    p2LastSeenAt: race.p2LastSeenAt?.toISOString() ?? null,
    filters,
    problemSelectionFailedReason:
      (race.problemSelectionFailedReason as ProblemSelectionFailureReason | null) ??
      null,
  };
}

/** Fallback when a player row is unexpectedly missing (should not happen). */
function placeholderUser(id: string): PublicUser {
  return {
    id,
    username: "unknown",
    cfHandle: null,
    cfRating: null,
    elo: 0,
    racesPlayed: 0,
  };
}
