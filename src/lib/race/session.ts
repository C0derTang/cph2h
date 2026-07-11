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

/**
 * Admin session gate (issue #175).
 *
 * Deliberately 404, not 401/403: a non-admin (including a signed-out caller)
 * must not learn that an admin surface exists at all.
 */
export type AdminSessionResult =
  | { ok: true; user: User }
  | { ok: false; status: 404; error: "not_found" };

/**
 * Pure decision given an already-resolved user row (or `null` for
 * signed-out). Split out from {@link requireAdmin} so the admin gate is
 * unit-testable without mocking `ensureUser`/Clerk.
 */
export function decideAdminAccess(user: User | null): AdminSessionResult {
  if (!user || !user.isAdmin) return { ok: false, status: 404, error: "not_found" };
  return { ok: true, user };
}

/**
 * Require a signed-in user with `users.isAdmin`. Returns the DB row on
 * success, or a structured 404 the caller maps to a response — non-admins
 * (and signed-out callers) get the same 404 an unmapped route would.
 */
export async function requireAdmin(): Promise<AdminSessionResult> {
  const user = await ensureUser();
  return decideAdminAccess(user);
}
