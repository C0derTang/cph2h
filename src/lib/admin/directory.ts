/**
 * Admin user directory (issue #224): searchable table of all users.
 *
 * `mapDirectoryUser` is pure DTO mapping. `filterDirectory` is the pure
 * client-side search predicate — case-insensitive substring match on
 * username OR cfHandle, following the "component fetches once, filters
 * client-side" pattern already used elsewhere in the admin surface.
 *
 * Client-side search is fine at current scale (a few hundred users). Past
 * ~2000 users, move to a server-side `?query=` ILIKE search instead of
 * shipping the whole capped list to the client — that's a follow-up, not in
 * scope here.
 */

import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";

/** Cap on `GET /api/admin/users` — newest first, no pagination beyond this. */
export const DIRECTORY_LIST_CAP = 500;

export interface DirectoryUserDTO {
  id: string;
  username: string;
  cfHandle: string | null;
  cfRating: number | null;
  elo: number;
  racesPlayed: number;
  cfLinked: boolean;
  isAdmin: boolean;
  createdAt: string | null;
}

/** Pure DTO mapping given an already-fetched user row. */
export function mapDirectoryUser(user: User): DirectoryUserDTO {
  return {
    id: user.id,
    username: user.username,
    cfHandle: user.cfHandle,
    cfRating: user.cfRating,
    elo: user.elo,
    racesPlayed: user.racesPlayed,
    cfLinked: user.cfLinkedAt != null,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt ? user.createdAt.toISOString() : null,
  };
}

/**
 * Case-insensitive substring match on username OR cfHandle. Trims and
 * lowercases the query; an empty (or whitespace-only) query returns every
 * user unchanged.
 */
export function filterDirectory(
  users: DirectoryUserDTO[],
  query: string,
): DirectoryUserDTO[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return users;

  return users.filter((u) => {
    const username = u.username.toLowerCase();
    const cfHandle = u.cfHandle?.toLowerCase() ?? "";
    return username.includes(needle) || cfHandle.includes(needle);
  });
}

/** `GET /api/admin/users` — newest first, capped at {@link DIRECTORY_LIST_CAP}. */
export async function listDirectoryUsers(): Promise<DirectoryUserDTO[]> {
  const rows = await db
    .select()
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(DIRECTORY_LIST_CAP);

  return rows.map(mapDirectoryUser);
}
