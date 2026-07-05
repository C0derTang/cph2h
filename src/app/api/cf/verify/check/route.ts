/**
 * POST /api/cf/verify/check — confirm a pending compile-error challenge.
 *
 * Loads the caller's `handle_verifications` row and looks for a COMPILE_ERROR
 * submission to the target problem, created within the challenge window, via
 * the public `user.status` API. On success it links the handle (sets
 * `users.cfHandle/cfRating/cfLinkedAt`), imports solve history, and clears the
 * pending row. NO password is involved.
 *
 * AUTH: same as verify/start — the user isn't linked yet, so `ensureUser`
 * resolves/creates the row rather than `requireLinkedUser`.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { handleVerifications, users } from "@/lib/db/schema";
import { getUserInfo, getUserStatus, CfApiError } from "@/lib/cf/client";
import { hasCompileErrorSince } from "@/lib/cf/verdicts";
import { importSolveHistory } from "@/lib/cf/history";
import { ensureUser } from "@/lib/user";
import type { CfLinkResponse } from "@/lib/types";

/** How many recent submissions to scan for the compile-error confirmation. */
const READBACK_COUNT = 30;

/**
 * Tolerance (seconds) subtracted from the challenge `createdAt` when computing
 * the lower bound, to absorb client/CF clock skew. Small on purpose — large
 * enough to never miss the compile-error the user just made, small enough not
 * to re-admit a pre-existing COMPILE_ERROR from before the challenge started.
 */
const CLOCK_SKEW_SEC = 60;

/** Postgres error code for a unique-constraint violation. */
const PG_UNIQUE_VIOLATION = "23505";
/** Name of the unique constraint on `users.cf_handle` (see 0000_init.sql). */
const CF_HANDLE_UNIQUE_CONSTRAINT = "users_cf_handle_unique";

function json(body: CfLinkResponse, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/** True when `err` is a Postgres unique-violation for the given constraint. */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { code?: unknown }).code !== PG_UNIQUE_VIOLATION) return false;
  return (err as { constraint?: unknown }).constraint === constraint;
}

export async function POST(): Promise<NextResponse> {
  const user = await ensureUser();
  if (!user) {
    return json({ ok: false, error: "You must be signed in." }, 401);
  }

  const [verification] = await db
    .select()
    .from(handleVerifications)
    .where(eq(handleVerifications.userId, user.id));
  if (!verification) {
    return json({ ok: false, error: "No pending verification. Start one first." }, 404);
  }
  if (verification.expiresAt.getTime() < Date.now()) {
    await db.delete(handleVerifications).where(eq(handleVerifications.userId, user.id));
    return json({ ok: false, error: "Verification expired. Start again." }, 410);
  }

  const { handle, problemId } = verification;

  // 1. Look for the compile-error submission via the public API.
  let submissions;
  try {
    submissions = await getUserStatus(handle, 1, READBACK_COUNT);
  } catch {
    return json({ ok: false, error: "Could not reach Codeforces. Try again shortly." }, 502);
  }

  const sinceEpochSec = Math.floor(verification.createdAt.getTime() / 1000) - CLOCK_SKEW_SEC;
  if (!hasCompileErrorSince(submissions, problemId, sinceEpochSec)) {
    // Not observed yet — the client can retry (200 so it reads the body).
    return NextResponse.json({ ok: false, error: "not_found_yet" }, { status: 200 });
  }

  // 2. Resolve the current rating (best-effort; a hiccup leaves it null).
  let cfRating: number | null = null;
  try {
    const [info] = await getUserInfo(handle);
    if (info) cfRating = info.rating ?? null;
  } catch (err) {
    if (!(err instanceof CfApiError)) throw err;
  }

  // 3. Link the handle. The unique constraint on `users.cf_handle` is the
  //    source of truth — map its violation to a friendly 409 (a concurrent
  //    link of the same handle can slip past the verify/start pre-check).
  try {
    await db
      .update(users)
      .set({ cfHandle: handle, cfRating, cfLinkedAt: new Date() })
      .where(eq(users.id, user.id));
  } catch (err) {
    if (isUniqueViolation(err, CF_HANDLE_UNIQUE_CONSTRAINT)) {
      return json(
        { ok: false, error: "That Codeforces handle is already linked to another account." },
        409,
      );
    }
    throw err;
  }

  // 4. Import solve history (best-effort; failure does not fail the link).
  try {
    await importSolveHistory(user.id, handle);
  } catch {
    // Swallow — the account is linked; history can be re-synced later.
  }

  // 5. Clear the pending challenge.
  await db.delete(handleVerifications).where(eq(handleVerifications.userId, user.id));

  return json({ ok: true, cfHandle: handle, cfRating }, 200);
}
