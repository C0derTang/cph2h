/**
 * POST /api/cf/link — link the signed-in user's Codeforces account.
 *
 * Flow: verify credentials by logging in to codeforces.com, resolve the
 * canonical handle + rating from the public API, upsert the user, store the
 * encrypted password and the fresh session, then import solve history.
 *
 * SECURITY: the password is read from the request body, passed straight into
 * `loginToCf`, and encrypted with `encryptSecret` before storage. It is never
 * logged.
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cfCredentials, problems, userProblems, users } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { getUserInfo, getUserStatus, CfApiError } from "@/lib/cf/client";
import {
  CfAuthError,
  getCredKey,
  loginToCf,
  persistCfSession,
} from "@/lib/cf/auth";
import type { CfLinkResponse } from "@/lib/types";

/** Page size for history import; walked via `from` until exhausted or capped. */
const HISTORY_PAGE_SIZE = 1000;
/** Safety cap on total pages fetched (HISTORY_PAGE_SIZE * MAX_PAGES rows). */
const MAX_HISTORY_PAGES = 20;
/** Batch size for `user_problems` upserts. */
const UPSERT_BATCH_SIZE = 500;

const linkSchema = z.object({
  handle: z.string().trim().min(1, "Handle is required.").max(64),
  password: z.string().min(1, "Password is required.").max(256),
});

function json(body: CfLinkResponse, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const { userId: clerkId, isAuthenticated } = await auth();
  if (!isAuthenticated || !clerkId) {
    return json({ ok: false, error: "You must be signed in." }, 401);
  }

  let parsed: z.infer<typeof linkSchema>;
  try {
    parsed = linkSchema.parse(await request.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? (err.issues[0]?.message ?? "Invalid request body.")
        : "Invalid request body.";
    return json({ ok: false, error: message }, 400);
  }
  const { handle, password } = parsed;

  // 1. Verify ownership by logging in to Codeforces.
  let login;
  try {
    login = await loginToCf(handle, password);
  } catch (err) {
    if (err instanceof CfAuthError) {
      const status = err.code === "invalid_credentials" ? 401 : 502;
      return json({ ok: false, error: err.message }, status);
    }
    return json(
      { ok: false, error: "Could not reach Codeforces. Try again shortly." },
      502,
    );
  }
  const canonicalHandle = login.handle;

  // 2. Resolve canonical handle casing + rating from the public API.
  let cfRating: number | null = null;
  try {
    const [info] = await getUserInfo(canonicalHandle);
    if (info) cfRating = info.rating ?? null;
  } catch (err) {
    // A public-API hiccup should not block linking; rating stays null.
    if (!(err instanceof CfApiError)) throw err;
  }

  // 3. Resolve (or create) the app user for this Clerk id.
  const user = await getOrCreateUser(clerkId, canonicalHandle);

  // 4. Reject if the handle is already linked to a different account.
  const [conflict] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.cfHandle, canonicalHandle), ne(users.id, user.id)));
  if (conflict) {
    return json(
      {
        ok: false,
        error: "That Codeforces handle is already linked to another account.",
      },
      409,
    );
  }

  // 5. Persist the link: user row, encrypted credentials, session.
  await db
    .update(users)
    .set({ cfHandle: canonicalHandle, cfRating, cfLinkedAt: new Date() })
    .where(eq(users.id, user.id));

  const encrypted = encryptSecret(password, getCredKey());
  await db
    .insert(cfCredentials)
    .values({
      userId: user.id,
      encryptedPassword: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: cfCredentials.userId,
      set: {
        encryptedPassword: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        updatedAt: new Date(),
      },
    });

  await persistCfSession(user.id, login);

  // 6. Import solve history (best-effort; failure does not fail the link).
  try {
    await importSolveHistory(user.id, canonicalHandle);
  } catch {
    // Swallow — the account is linked; history can be re-synced later.
  }

  return json({ ok: true, cfHandle: canonicalHandle, cfRating }, 200);
}

async function getOrCreateUser(clerkId: string, fallbackHandle: string) {
  const [found] = await db.select().from(users).where(eq(users.clerkId, clerkId));
  if (found) return found;

  let username = fallbackHandle;
  try {
    const clerkUser = await currentUser();
    username =
      clerkUser?.username ??
      clerkUser?.firstName ??
      clerkUser?.emailAddresses[0]?.emailAddress ??
      fallbackHandle;
  } catch {
    // Fall back to the handle if the Clerk backend user is unavailable.
  }

  const [created] = await db
    .insert(users)
    .values({ clerkId, username })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost a race with a concurrent insert — read the winner.
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId));
  return existing;
}

/**
 * Walk the user's full submission history and mark `user_problems.solved`.
 *
 * Only problems already present in the `problems` table are recorded, so the
 * `user_problems -> problems` foreign key is never violated (the problem
 * catalogue is populated by a separate sync job).
 */
async function importSolveHistory(userId: string, handle: string): Promise<void> {
  // problemId -> solved (any OK verdict wins over a non-OK attempt).
  const attempts = new Map<string, boolean>();

  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const from = page * HISTORY_PAGE_SIZE + 1;
    const submissions = await getUserStatus(handle, from, HISTORY_PAGE_SIZE);
    if (submissions.length === 0) break;

    for (const sub of submissions) {
      const problemId = `${sub.problem.contestId}${sub.problem.index}`;
      const solved = sub.verdict === "OK";
      attempts.set(problemId, (attempts.get(problemId) ?? false) || solved);
    }

    if (submissions.length < HISTORY_PAGE_SIZE) break;
  }

  if (attempts.size === 0) return;

  // Restrict to catalogued problems to satisfy the FK constraint.
  const ids = [...attempts.keys()];
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += UPSERT_BATCH_SIZE) {
    const chunk = ids.slice(i, i + UPSERT_BATCH_SIZE);
    const rows = await db
      .select({ id: problems.id })
      .from(problems)
      .where(inArray(problems.id, chunk));
    for (const row of rows) known.add(row.id);
  }

  const rows = [...attempts.entries()]
    .filter(([problemId]) => known.has(problemId))
    .map(([problemId, solved]) => ({ userId, problemId, solved }));

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    await db
      .insert(userProblems)
      .values(batch)
      .onConflictDoUpdate({
        target: [userProblems.userId, userProblems.problemId],
        // Once solved, always solved — even on re-import.
        set: { solved: sql`${userProblems.solved} OR excluded.solved` },
      });
  }
}
