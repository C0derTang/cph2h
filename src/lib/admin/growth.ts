/**
 * Admin growth stats (issue #222): signups/day + tournament registrations/day.
 *
 * Reuses `groupRacesPerDay` from `src/lib/admin/overview.ts` unchanged — it's
 * already generic over `Date[]` and zero-fills the window, so bucketing both
 * series is just two calls with different raw timestamps. This DTO
 * deliberately lives here rather than in `src/lib/types.ts` (master-owned
 * contract) — a deviation from the `ReportDTO` precedent, per the issue spec.
 */

import { gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { tournamentRegistrations, users } from "@/lib/db/schema";
import { groupRacesPerDay } from "@/lib/admin/overview";

const GROWTH_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AdminGrowth {
  signupsPerDay: { date: string; count: number }[];
  registrationsPerDay: { date: string; count: number }[];
}

/** Fetch + bucket the last `GROWTH_WINDOW_DAYS` days of signups and tournament registrations. */
export async function getAdminGrowth(now: Date = new Date()): Promise<AdminGrowth> {
  const windowStart = new Date(now.getTime() - GROWTH_WINDOW_DAYS * MS_PER_DAY);

  const [userRows, registrationRows] = await Promise.all([
    db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(gte(users.createdAt, windowStart)),
    db
      .select({ createdAt: tournamentRegistrations.createdAt })
      .from(tournamentRegistrations)
      .where(gte(tournamentRegistrations.createdAt, windowStart)),
  ]);

  return {
    // users.createdAt is nullable — filter nulls before bucketing (see overview.ts:128).
    signupsPerDay: groupRacesPerDay(
      userRows.map((r) => r.createdAt).filter((d): d is Date => d !== null),
      now,
    ),
    registrationsPerDay: groupRacesPerDay(
      registrationRows.map((r) => r.createdAt),
      now,
    ),
  };
}
