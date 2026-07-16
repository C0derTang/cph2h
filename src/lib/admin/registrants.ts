/**
 * Admin tournament registrants (issue #221).
 *
 * Same batch-fetch shape as `src/lib/admin/reports.ts`: fetch the
 * `tournament_registrations` rows, then batch-fetch the referenced `users`
 * rows via `inArray` into a `Map` keyed by id — no relational-query joins.
 * `mapRegistrantRow` is pure (DTO mapping given an already-fetched row + user)
 * and is unit-tested directly.
 *
 * `RegistrantDTO` deliberately lives here, not in `src/lib/types.ts` — that
 * file is master-owned, and this issue is new-files-only.
 */

import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  tournamentRegistrations,
  users,
  type TournamentRegistration,
  type User,
} from "@/lib/db/schema";

export interface RegistrantDTO {
  userId: string;
  username: string;
  cfHandle: string | null;
  cfRating: number | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  termsAcceptedAt: string; // ISO
  registeredAt: string; // ISO, from tournament_registrations.createdAt
}

/** Fallback when a registration's user row is unexpectedly missing (deleted user). */
const UNKNOWN_USERNAME = "unknown";

/** Pure DTO mapping given an already-fetched registration row and its user (if any). */
export function mapRegistrantRow(
  reg: TournamentRegistration,
  user: User | undefined,
): RegistrantDTO {
  return {
    userId: reg.userId,
    username: user ? user.username : UNKNOWN_USERNAME,
    cfHandle: user?.cfHandle ?? null,
    cfRating: user?.cfRating ?? null,
    githubUrl: reg.githubUrl,
    linkedinUrl: reg.linkedinUrl,
    termsAcceptedAt: reg.termsAcceptedAt.toISOString(),
    registeredAt: reg.createdAt.toISOString(),
  };
}

/** `GET /api/admin/registrations` — all rows, newest registration first. */
export async function listRegistrants(): Promise<RegistrantDTO[]> {
  const rows = await db
    .select()
    .from(tournamentRegistrations)
    .orderBy(desc(tournamentRegistrations.createdAt));

  if (rows.length === 0) return [];

  const userIds = Array.from(new Set(rows.map((r) => r.userId)));
  const userRows = await db.select().from(users).where(inArray(users.id, userIds));
  const byId = new Map(userRows.map((u) => [u.id, u]));

  return rows.map((row) => mapRegistrantRow(row, byId.get(row.userId)));
}
