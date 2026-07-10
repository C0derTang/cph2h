/**
 * Inaugural cph2h tournament — display constants + registration queries.
 *
 * No Stripe import here: this module is imported by the server page and API
 * routes alike. `paid` rows are the source of truth for the registrants list
 * and the 128-player cap; a row is only `paid` after the Stripe webhook
 * confirms the Checkout session.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  tournamentRegistrations,
  users,
  type TournamentRegistration,
} from "@/lib/db/schema";

export const TOURNAMENT_CAP = 128;
export const ENTRY_USD = 5;
export const ENTRY_CENTS = 500;
export const PRIZE_USD = 500;

/** Discord invite. Set NEXT_PUBLIC_DISCORD_URL before launch; falls back to `#`. */
export const DISCORD_URL = process.env.NEXT_PUBLIC_DISCORD_URL ?? "#";

export interface Registrant {
  userId: string;
  username: string;
  cfHandle: string | null;
  cfRating: number | null;
  paidAt: Date | null;
}

/** Number of confirmed-paid registrants (counts against TOURNAMENT_CAP). */
export async function countPaid(): Promise<number> {
  const rows = await db
    .select({ userId: tournamentRegistrations.userId })
    .from(tournamentRegistrations)
    .where(eq(tournamentRegistrations.status, "paid"));
  return rows.length;
}

/** Public registrants list — paid entries joined to their user, oldest first
 *  (registration order, so index+1 is the player's seed number). */
export async function listPaidRegistrants(): Promise<Registrant[]> {
  return db
    .select({
      userId: tournamentRegistrations.userId,
      username: users.username,
      cfHandle: users.cfHandle,
      cfRating: users.cfRating,
      paidAt: tournamentRegistrations.paidAt,
    })
    .from(tournamentRegistrations)
    .innerJoin(users, eq(users.id, tournamentRegistrations.userId))
    .where(eq(tournamentRegistrations.status, "paid"))
    .orderBy(asc(tournamentRegistrations.paidAt));
}

/** This user's registration row, or null if they've never registered. */
export async function getRegistration(
  userId: string,
): Promise<TournamentRegistration | null> {
  const [row] = await db
    .select()
    .from(tournamentRegistrations)
    .where(eq(tournamentRegistrations.userId, userId))
    .limit(1);
  return row ?? null;
}
