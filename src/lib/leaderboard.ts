import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { desc, gte, sql } from "drizzle-orm";
import type { LeaderboardEntry, PublicUser } from "@/lib/types";

export const LEADERBOARD_DEFAULT_LIMIT = 50;
export const LEADERBOARD_MAX_LIMIT = 100;

export interface LeaderboardPage {
  entries: LeaderboardEntry[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/**
 * Parse a query param into a positive integer, falling back to `fallback`
 * for missing / non-numeric / out-of-range values.
 */
export function parsePositiveInt(
  value: string | null | undefined,
  fallback: number,
): number {
  if (value == null) return fallback;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
}

/**
 * Fetch a page of the global leaderboard: users with racesPlayed >= 1,
 * ordered by Elo descending. Rank = offset + index + 1.
 */
export async function getLeaderboardPage(
  page: number,
  limit: number,
): Promise<LeaderboardPage> {
  const safeLimit = Math.min(LEADERBOARD_MAX_LIMIT, Math.max(1, limit));
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * safeLimit;

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(gte(users.racesPlayed, 1));

  const total = Number(countResult[0]?.count ?? 0);

  const rows = await db
    .select()
    .from(users)
    .where(gte(users.racesPlayed, 1))
    .orderBy(desc(users.elo))
    .limit(safeLimit)
    .offset(offset);

  const entries: LeaderboardEntry[] = rows.map((row, index) => {
    const user: PublicUser = {
      id: row.id,
      username: row.username,
      cfHandle: row.cfHandle,
      cfRating: row.cfRating,
      elo: row.elo,
      racesPlayed: row.racesPlayed,
    };
    return { rank: offset + index + 1, user };
  });

  return {
    entries,
    total,
    page: safePage,
    limit: safeLimit,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}
