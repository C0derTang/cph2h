/**
 * Ensure the Clerk-authenticated caller has a corresponding `users` row.
 *
 * Historically the `users` row was only created inside the old CF-link route,
 * so a brand-new signup (any auth method) had a Clerk identity but no DB row
 * until they linked Codeforces — dead-ending them on `/dashboard` with
 * "User not found" (issue #48). `ensureUser` provisions the row on first
 * authenticated access instead, so any signed-in user always resolves to a
 * row; only truly-unauthenticated callers get `null`.
 */

import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";

/** Fallback username when Clerk has no username, first name, or email. */
const DEFAULT_USERNAME = "racer";

/**
 * Resolve the signed-in Clerk user to their `users` row, creating it on
 * first authenticated access. Returns `null` only when there is no
 * signed-in user — never throws on a Clerk lookup failure.
 *
 * Safe under concurrent calls: the insert uses `onConflictDoNothing`, and if
 * a concurrent request wins the race, this re-selects and returns that row.
 */
export async function ensureUser(): Promise<User | null> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (existing) return existing;

  const username = await deriveUsername();

  const [created] = await db
    .insert(users)
    .values({ clerkId, username })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost a race with a concurrent insert for the same clerkId — read the
  // winner instead of failing.
  const [winner] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  return winner ?? null;
}

/**
 * Best-effort username derivation from the Clerk backend user. Never
 * throws — a Clerk API hiccup should not block provisioning the row.
 */
async function deriveUsername(): Promise<string> {
  try {
    const clerkUser = await currentUser();
    return (
      clerkUser?.username ??
      clerkUser?.firstName ??
      clerkUser?.emailAddresses[0]?.emailAddress ??
      DEFAULT_USERNAME
    );
  } catch {
    return DEFAULT_USERNAME;
  }
}
