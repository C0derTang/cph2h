/**
 * Admin overview stats (issue #175): `GET /api/admin/overview`.
 *
 * The three grouped stats (per-day race counts, verdict distribution, elo
 * histogram) are computed in JS from raw rows rather than SQL `GROUP BY`, so
 * the bucketing/grouping logic is pure and unit-testable without a DB.
 * `getAdminOverview` is the thin I/O shell that fetches rows and wires them
 * together.
 */

import { eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { races, raceSubmissions, reports, users } from "@/lib/db/schema";
import type { AdminOverview } from "@/lib/types";

const ELO_BUCKET_SIZE = 100;
const RACES_PER_DAY_WINDOW_DAYS = 30;
const RACES_7D_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Elo distribution bucketed into fixed-width buckets (default 100-wide). */
export function bucketEloHistogram(
  elos: number[],
  bucketSize: number = ELO_BUCKET_SIZE,
): { bucketFloor: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const elo of elos) {
    const bucketFloor = Math.floor(elo / bucketSize) * bucketSize;
    counts.set(bucketFloor, (counts.get(bucketFloor) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a - b)
    .map(([bucketFloor, count]) => ({ bucketFloor, count }));
}

/** `YYYY-MM-DD` for a `Date`, in UTC (matches `races.createdAt`'s tz-aware storage). */
function isoDateUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Zero-filled per-day race counts for the `days`-day window ending on `now`
 * (inclusive), given the raw `createdAt` timestamps of races in that window.
 */
export function groupRacesPerDay(
  createdAts: Date[],
  now: Date = new Date(),
  days: number = RACES_PER_DAY_WINDOW_DAYS,
): { date: string; count: number }[] {
  const end = startOfUTCDay(now);
  const counts = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(end.getTime() - i * MS_PER_DAY);
    counts.set(isoDateUTC(day), 0);
  }

  for (const createdAt of createdAts) {
    const key = isoDateUTC(startOfUTCDay(createdAt));
    if (counts.has(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries()).map(([date, count]) => ({ date, count }));
}

/**
 * Verdict distribution, most common first. Submissions still pending (no
 * verdict yet) are excluded — `verdictDist` describes observed CF verdicts.
 */
export function countVerdicts(
  verdicts: (string | null)[],
): { verdict: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const verdict of verdicts) {
    if (verdict == null) continue;
    counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([verdict, count]) => ({ verdict, count }));
}

/** Fetch + assemble the full admin overview. */
export async function getAdminOverview(now: Date = new Date()): Promise<AdminOverview> {
  const sevenDaysAgo = new Date(now.getTime() - RACES_7D_WINDOW_DAYS * MS_PER_DAY);
  const thirtyDaysAgo = new Date(now.getTime() - RACES_PER_DAY_WINDOW_DAYS * MS_PER_DAY);

  const [
    [totalUsersRow],
    [totalRacesRow],
    [races7dRow],
    [openReportsRow],
    recentRaces,
    verdictRows,
    eloRows,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(users),
    db.select({ count: sql<number>`count(*)` }).from(races),
    db
      .select({ count: sql<number>`count(*)` })
      .from(races)
      .where(gte(races.createdAt, sevenDaysAgo)),
    db
      .select({ count: sql<number>`count(*)` })
      .from(reports)
      .where(eq(reports.status, "open")),
    db
      .select({ createdAt: races.createdAt })
      .from(races)
      .where(gte(races.createdAt, thirtyDaysAgo)),
    db.select({ verdict: raceSubmissions.verdict }).from(raceSubmissions),
    db.select({ elo: users.elo }).from(users),
  ]);

  return {
    totalUsers: Number(totalUsersRow?.count ?? 0),
    totalRaces: Number(totalRacesRow?.count ?? 0),
    races7d: Number(races7dRow?.count ?? 0),
    openReports: Number(openReportsRow?.count ?? 0),
    racesPerDay: groupRacesPerDay(
      recentRaces
        .map((r) => r.createdAt)
        .filter((d): d is Date => d !== null),
      now,
    ),
    verdictDist: countVerdicts(verdictRows.map((r) => r.verdict)),
    eloHistogram: bucketEloHistogram(eloRows.map((r) => r.elo)),
  };
}
