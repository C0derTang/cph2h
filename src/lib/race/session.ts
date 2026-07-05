/**
 * Route auth helper (issue #7).
 *
 * Resolves the Clerk-authenticated user to their `users` row and gates race
 * actions on a linked Codeforces account (`cfLinkedAt` set). Create/join/ready
 * all require a linked account per the spec.
 *
 * The row itself is provisioned by `ensureUser` (issue #48) on first
 * authenticated access, so a signed-in user always resolves to a row here —
 * only a truly-unauthenticated caller gets 401.
 */

import type { User } from "@/lib/db/schema";
import { ensureUser } from "@/lib/user";

export type SessionResult =
  | { ok: true; user: User }
  | { ok: false; status: 401 | 403; error: "unauthorized" | "cf_not_linked" };

/**
 * Require a signed-in user whose Codeforces account is linked. Returns the DB
 * row on success, or a structured 401/403 the caller maps to a response.
 */
export async function requireLinkedUser(): Promise<SessionResult> {
  const user = await ensureUser();

  if (!user) return { ok: false, status: 401, error: "unauthorized" };
  if (!user.cfLinkedAt) return { ok: false, status: 403, error: "cf_not_linked" };

  return { ok: true, user };
}
