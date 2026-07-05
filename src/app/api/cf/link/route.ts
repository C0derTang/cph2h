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
 *
 * RATE LIMITING: without a cap this endpoint forwards any POSTed
 * handle+password straight to codeforces.com, making it an unthrottled
 * credential-testing proxy. `checkLinkRateLimit` enforces a per-Clerk-user
 * cooldown and rolling-window attempt cap, tracked in an in-memory Map —
 * the same per-instance-only pattern used by the run-route rate limiter
 * (src/app/api/races/[id]/run/route.ts). This resets on redeploy/restart and
 * does not coordinate across serverless instances; a durable store (Redis or
 * a DB-backed counter) would be needed for cross-instance enforcement, but is
 * out of scope here (see issue #32).
 *
 * OUT OF SCOPE (tracked on issue #32, deferred — need infra/schema changes):
 *  - Moving `importSolveHistory` off the request path onto a background
 *    job/queue so a function timeout can't abort mid-import.
 *  - Allowing provisional `user_problems` rows for problems not yet in the
 *    `problems` catalogue (the unseen-problem FK limitation).
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

/** Minimum spacing between two attempts from the same Clerk user. */
const LINK_ATTEMPT_COOLDOWN_MS = 5 * 1000;
/** Rolling window over which attempts are capped. */
const LINK_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
/** Max attempts allowed within the rolling window. */
const LINK_ATTEMPT_MAX = 5;

/** Postgres error code for a unique-constraint violation. */
const PG_UNIQUE_VIOLATION = "23505";
/** Name of the unique constraint on `users.cf_handle` (see 0000_init.sql). */
const CF_HANDLE_UNIQUE_CONSTRAINT = "users_cf_handle_unique";

const linkSchema = z.object({
  handle: z.string().trim().min(1, "Handle is required.").max(64),
  password: z.string().min(1, "Password is required.").max(256),
});

function json(body: CfLinkResponse, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/**
 * Per-Clerk-user attempt history for `/api/cf/link`, keyed by Clerk id.
 *
 * In-memory Map — per-instance only, resets on redeploy/restart, and does
 * not coordinate across serverless instances. Acceptable for this
 * hardening pass; see the RATE LIMITING note above.
 */
const linkAttempts = new Map<string, number[]>();

type RateLimitResult = { limited: false } | { limited: true; retryAfterSec: number };

/**
 * Enforce a per-user cooldown and rolling-window attempt cap.
 *
 * Only call this once a request is about to actually spend a Codeforces
 * login attempt (i.e. after body validation), and only record an attempt
 * when it is allowed through — malformed requests should not burn the cap.
 */
function checkLinkRateLimit(clerkId: string): RateLimitResult {
  const now = Date.now();
  const timestamps = (linkAttempts.get(clerkId) ?? []).filter(
    (t) => now - t < LINK_ATTEMPT_WINDOW_MS,
  );

  const last = timestamps[timestamps.length - 1];
  if (last !== undefined && now - last < LINK_ATTEMPT_COOLDOWN_MS) {
    linkAttempts.set(clerkId, timestamps);
    return {
      limited: true,
      retryAfterSec: Math.ceil((LINK_ATTEMPT_COOLDOWN_MS - (now - last)) / 1000),
    };
  }

  if (timestamps.length >= LINK_ATTEMPT_MAX) {
    linkAttempts.set(clerkId, timestamps);
    return {
      limited: true,
      retryAfterSec: Math.ceil((LINK_ATTEMPT_WINDOW_MS - (now - timestamps[0])) / 1000),
    };
  }

  timestamps.push(now);
  linkAttempts.set(clerkId, timestamps);
  return { limited: false };
}

/** True when `err` is a Postgres unique-violation, optionally for a specific constraint. */
function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code !== PG_UNIQUE_VIOLATION) return false;
  if (!constraint) return true;
  return (err as { constraint?: unknown }).constraint === constraint;
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

  // Rate-limit before spending a Codeforces login attempt: a bad body above
  // does not count against the cap, but every real attempt from here on does.
  const rateLimit = checkLinkRateLimit(clerkId);
  if (rateLimit.limited) {
    return json(
      {
        ok: false,
        error: `Too many link attempts. Try again in ${rateLimit.retryAfterSec}s.`,
      },
      429,
    );
  }

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
  //
  // The pre-check above (step 4) narrows the common case, but it and this
  // update are not in one transaction: two concurrent links for the same
  // handle can both pass the pre-check. The `users.cf_handle` unique
  // constraint is still the source of truth — map its violation to the same
  // friendly 409 rather than letting it surface as a 500.
  try {
    await db
      .update(users)
      .set({ cfHandle: canonicalHandle, cfRating, cfLinkedAt: new Date() })
      .where(eq(users.id, user.id));
  } catch (err) {
    if (isUniqueViolation(err, CF_HANDLE_UNIQUE_CONSTRAINT)) {
      return json(
        {
          ok: false,
          error: "That Codeforces handle is already linked to another account.",
        },
        409,
      );
    }
    throw err;
  }

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
