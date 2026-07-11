/**
 * Test-only DB seeding for the e2e race smoke test (issue #18).
 *
 * The real Codeforces-link flow (the OpenID Connect routes under
 * `/api/cf/oauth/*`) confirms ownership against codeforces.com, which e2e
 * cannot drive. Every race route gates on `requireLinkedUser()`
 * (src/lib/race/session.ts), which only checks `users.cf_linked_at` — so we
 * seed that column (and a fake `cf_handle`) directly instead of routing
 * through a live CF verification, matching the "seed directly in DB" option
 * called out in the issue #18 spec.
 *
 * Requires `DATABASE_URL` to point at the same (migrated) Postgres instance
 * the app under test uses, and `CLERK_SECRET_KEY` for the Clerk *development*
 * instance the two racer accounts already exist in (this module never
 * creates Clerk users — only resolves an existing one by email).
 */

import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";

export interface SeedRacerInput {
  /** Email of an existing user in the Clerk development instance under test. */
  email: string;
  username: string;
  cfHandle: string;
  elo: number;
}

/**
 * Resolve a test racer's Clerk id from their email, then upsert the matching
 * `users` row with a linked CF handle and a known starting Elo. Idempotent —
 * safe to call again on a later run against the same Clerk user.
 */
export async function seedRacer(input: SeedRacerInput): Promise<User> {
  const clerk = await clerkClient();
  const { data } = await clerk.users.getUserList({
    emailAddress: [input.email],
  });
  const clerkUser = data[0];
  if (!clerkUser) {
    throw new Error(
      `No Clerk user found for "${input.email}". Create it in the Clerk ` +
        "development instance backing E2E_BASE_URL first — see the env " +
        "requirements documented in e2e/race.spec.ts.",
    );
  }

  const [row] = await db
    .insert(users)
    .values({
      clerkId: clerkUser.id,
      username: input.username,
      cfHandle: input.cfHandle,
      cfLinkedAt: new Date(),
      elo: input.elo,
    })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: {
        username: input.username,
        cfHandle: input.cfHandle,
        cfLinkedAt: new Date(),
        elo: input.elo,
      },
    })
    .returning();

  return row;
}

/** Re-read a seeded racer's current row (e.g. to compare Elo before/after a race). */
export async function getUserById(id: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}
