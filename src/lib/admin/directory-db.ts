/**
 * DB-touching half of the admin user directory (issue #224). Split from
 * `directory.ts` because that module is imported by the client component
 * `UserDirectory.tsx` — a value import of `@/lib/db` there puts the Neon
 * client in the browser bundle, where its module-scope `neon()` call throws
 * (no DATABASE_URL) and crashes the whole admin dashboard. Server-side
 * callers (the API route) import from here instead.
 */

import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  DIRECTORY_LIST_CAP,
  mapDirectoryUser,
  type DirectoryUserDTO,
} from "@/lib/admin/directory";

/** `GET /api/admin/users` — newest first, capped at {@link DIRECTORY_LIST_CAP}. */
export async function listDirectoryUsers(): Promise<DirectoryUserDTO[]> {
  const rows = await db
    .select()
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(DIRECTORY_LIST_CAP);

  return rows.map(mapDirectoryUser);
}
