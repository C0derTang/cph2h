/**
 * POST /api/cf/verify/start — begin a compile-error handle-ownership challenge.
 *
 * Codeforces Cloudflare-blocks server-side login, so ownership can't be proven
 * by logging in. Instead we validate the handle via the public API, pick a
 * well-known easy problem, and ask the user to submit a solution that FAILS TO
 * COMPILE to it. `POST /api/cf/verify/check` then confirms the COMPILE_ERROR
 * verdict via the public API. NO password is ever collected.
 *
 * AUTH: the user is signed in but not yet linked, so `requireLinkedUser` is
 * wrong here — we use `ensureUser` (the same row-provisioning helper the
 * dashboard/settings use) to resolve/create the caller's `users` row.
 */

import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleVerifications, users } from "@/lib/db/schema";
import { getUserInfo, CfApiError } from "@/lib/cf/client";
import { ensureUser } from "@/lib/user";
import { problemUrl, type CfVerifyStartResponse } from "@/lib/types";

/** How long a pending challenge is valid before the user must restart. */
const VERIFY_WINDOW_MS = 60 * 1000;

/**
 * Curated, stable, famously-easy real Codeforces problems used as the
 * compile-error target. We deliberately do NOT pick an arbitrary row from the
 * `problems` catalogue: it can contain gym/seed/stale entries whose
 * `/problemset/problem/{contestId}/{index}` URL 404s ("invalid link"). Every id
 * here resolves to a real problem page.
 */
const VERIFY_PROBLEMS = [
  { id: "4A", contestId: 4, index: "A", name: "Watermelon" },
  { id: "1A", contestId: 1, index: "A", name: "Theatre Square" },
  { id: "71A", contestId: 71, index: "A", name: "Way Too Long Words" },
  { id: "158A", contestId: 158, index: "A", name: "Next Round" },
  { id: "231A", contestId: 231, index: "A", name: "Team" },
  { id: "282A", contestId: 282, index: "A", name: "Bit++" },
] as const;

const startSchema = z.object({
  handle: z.string().trim().min(1, "Handle is required.").max(64),
});

function json(body: CfVerifyStartResponse, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await ensureUser();
  if (!user) {
    return json({ ok: false, error: "You must be signed in." }, 401);
  }

  let parsed: z.infer<typeof startSchema>;
  try {
    parsed = startSchema.parse(await request.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? (err.issues[0]?.message ?? "Invalid request body.")
        : "Invalid request body.";
    return json({ ok: false, error: message }, 400);
  }

  // 1. Validate the handle exists via the public API + capture canonical casing.
  let canonicalHandle: string;
  try {
    const [info] = await getUserInfo(parsed.handle);
    if (!info) {
      return json({ ok: false, error: "That Codeforces handle does not exist." }, 404);
    }
    canonicalHandle = info.handle;
  } catch (err) {
    if (err instanceof CfApiError) {
      return json({ ok: false, error: "That Codeforces handle does not exist." }, 404);
    }
    return json({ ok: false, error: "Could not reach Codeforces. Try again shortly." }, 502);
  }

  // 2. Reject a handle already linked to a different account.
  const [conflict] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.cfHandle, canonicalHandle), ne(users.id, user.id)));
  if (conflict) {
    return json(
      { ok: false, error: "That Codeforces handle is already linked to another account." },
      409,
    );
  }

  // 3. Pick a curated, known-valid easy problem as the compile-error target.
  const target = VERIFY_PROBLEMS[Math.floor(Math.random() * VERIFY_PROBLEMS.length)];

  // 4. Store the pending challenge (one per user; upserted, window reset).
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VERIFY_WINDOW_MS);
  await db
    .insert(handleVerifications)
    .values({
      userId: user.id,
      handle: canonicalHandle,
      problemId: target.id,
      createdAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: handleVerifications.userId,
      set: {
        handle: canonicalHandle,
        problemId: target.id,
        createdAt: now,
        expiresAt,
      },
    });

  return json(
    {
      ok: true,
      handle: canonicalHandle,
      problemId: target.id,
      problemName: target.name,
      problemUrl: problemUrl(target),
      expiresAt: expiresAt.toISOString(),
    },
    200,
  );
}
