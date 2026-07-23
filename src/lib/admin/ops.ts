/**
 * Admin live-ops (issue #223): queue depth, races active right now, and a
 * recent-races list.
 *
 * Follows `src/lib/admin/overview.ts`'s count-query shell (`sql<number>`
 * `count(*)``, wrapped in `Number()` — Neon's HTTP driver returns counts as
 * strings) and `src/lib/admin/reports.ts`'s batch-user-fetch pattern
 * (`inArray` + `Map`, with a pure DTO mapper unit-tested without a DB).
 */

import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { queueEntries, races, users, type Race, type User } from "@/lib/db/schema";

/** Cap on the recent-races list — newest first, no pagination beyond this. */
export const RECENT_RACES_CAP = 50;

export interface RecentRacePlayer {
  id: string;
  username: string;
}

export interface RecentRaceDTO {
  id: string;
  status: string; // any of the five RaceStatus values
  p1: RecentRacePlayer;
  p2: RecentRacePlayer | null;
  outcome: string | null;
  winnerId: string | null;
  eloDeltaP1: number | null;
  eloDeltaP2: number | null;
  startedAt: string | null; // ISO
  finishedAt: string | null; // ISO
  createdAt: string | null; // ISO
  /** Race settings surfaced for the ops panel + admin controls (issue #296). */
  ratingMin: number | null;
  ratingMax: number | null;
  problemDateFrom: string | null; // ISO
  problemDateTo: string | null; // ISO
  timeLimitSec: number;
  /**
   * The assigned problem id — but ONLY once the race has actually started
   * (`startedAt !== null && startedAt <= now`). It stays null during the
   * pre-start countdown so an admin who is themselves racing can't peek at
   * their own upcoming problem via the ops panel (never-leak-before-start).
   */
  problemId: string | null;
  /** Non-null → this race came from matchmaking (the "MM" discriminator). */
  readyDeadlineAt: string | null; // ISO
}

export interface AdminOps {
  queueDepth: number;
  activeRaces: number;
  recentRaces: RecentRaceDTO[];
}

/** Fallback when a race's player row is unexpectedly missing (deleted user). */
function placeholderPlayer(id: string): RecentRacePlayer {
  return { id, username: "unknown" };
}

function resolvePlayer(id: string, byId: Map<string, User>): RecentRacePlayer {
  const row = byId.get(id);
  return row ? { id: row.id, username: row.username } : placeholderPlayer(id);
}

/**
 * Pure DTO mapping given an already-fetched race row and its batched users.
 * `now` gates the problem-before-start invariant (see {@link RecentRaceDTO}).
 */
export function mapRecentRace(
  race: Race,
  usersById: Map<string, User>,
  now: Date,
): RecentRaceDTO {
  const problemVisible =
    race.startedAt !== null && race.startedAt.getTime() <= now.getTime();

  return {
    id: race.id,
    status: race.status,
    p1: resolvePlayer(race.p1Id, usersById),
    p2: race.p2Id ? resolvePlayer(race.p2Id, usersById) : null,
    outcome: race.outcome,
    winnerId: race.winnerId,
    eloDeltaP1: race.eloDeltaP1,
    eloDeltaP2: race.eloDeltaP2,
    startedAt: race.startedAt ? race.startedAt.toISOString() : null,
    finishedAt: race.finishedAt ? race.finishedAt.toISOString() : null,
    createdAt: race.createdAt ? race.createdAt.toISOString() : null,
    ratingMin: race.ratingMin,
    ratingMax: race.ratingMax,
    problemDateFrom: race.problemDateFrom ? race.problemDateFrom.toISOString() : null,
    problemDateTo: race.problemDateTo ? race.problemDateTo.toISOString() : null,
    timeLimitSec: race.timeLimitSec,
    problemId: problemVisible ? race.problemId : null,
    readyDeadlineAt: race.readyDeadlineAt ? race.readyDeadlineAt.toISOString() : null,
  };
}

/** Batch-fetch p1/p2 users for a set of race rows and map to DTOs. */
async function toRecentRaceDTOs(rows: Race[]): Promise<RecentRaceDTO[]> {
  if (rows.length === 0) return [];

  const userIds = Array.from(
    new Set(rows.flatMap((r) => (r.p2Id ? [r.p1Id, r.p2Id] : [r.p1Id]))),
  );
  const userRows = await db.select().from(users).where(inArray(users.id, userIds));
  const usersById = new Map(userRows.map((u) => [u.id, u]));

  // One clock for the whole batch — the problem-gating boundary is consistent
  // across every row in this response.
  const now = new Date();
  return rows.map((row) => mapRecentRace(row, usersById, now));
}

/** Fetch + assemble the admin live-ops payload. */
export async function getAdminOps(): Promise<AdminOps> {
  const [[queueDepthRow], [activeRacesRow], recentRaceRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(queueEntries),
    db
      .select({ count: sql<number>`count(*)` })
      .from(races)
      .where(eq(races.status, "active")),
    db
      .select()
      .from(races)
      .orderBy(desc(races.createdAt))
      .limit(RECENT_RACES_CAP),
  ]);

  return {
    queueDepth: Number(queueDepthRow?.count ?? 0),
    activeRaces: Number(activeRacesRow?.count ?? 0),
    recentRaces: await toRecentRaceDTOs(recentRaceRows),
  };
}
