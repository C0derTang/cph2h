/**
 * POST /api/tournament/register — register (or update) for the launch
 * tournament (issue #209).
 *
 * Thin shell mirroring `src/app/api/races/join/route.ts`: `requireLinkedUser`
 * gates on signed-in + linked CF account, zod validates the body, the pure
 * normalizers in `src/lib/tournament/registration.ts` validate the optional
 * profile URLs, and a single upsert statement writes the row (Neon HTTP
 * driver has no interactive transactions, so this must be one statement).
 *
 * `termsAcceptedAt` is deliberately absent from the upsert's `set` clause —
 * re-registering (editing links) does not re-stamp acceptance, it is
 * preserved from the original registration.
 *
 * No GET route: the tournament page reads the registration row directly
 * from the DB as part of rendering.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { tournamentRegistrations } from "@/lib/db/schema";
import { getUserRating } from "@/lib/cf/client";
import { requireLinkedUser } from "@/lib/race/session";
import { normalizeGithubUrl, normalizeLinkedinUrl } from "@/lib/tournament/registration";

/** Minimum rated Codeforces contests required to register (issue #217). */
const MIN_RATED_CONTESTS = 3;

const bodySchema = z.object({
  githubUrl: z.string().max(500).optional(),
  linkedinUrl: z.string().max(500).optional(),
  // Optional (rather than required) so a missing field falls through to the
  // explicit `!== true` check below and returns `terms_not_accepted` instead
  // of `invalid_body` — only a wrong-typed value should be a body error.
  termsAccepted: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await req.json().catch(() => undefined);
    body = bodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (body.termsAccepted !== true) {
    return NextResponse.json({ error: "terms_not_accepted" }, { status: 400 });
  }

  // Empty string means "clear this field" -> null; otherwise normalize.
  let githubUrl: string | null = null;
  if (body.githubUrl && body.githubUrl.length > 0) {
    githubUrl = normalizeGithubUrl(body.githubUrl);
    if (!githubUrl) {
      return NextResponse.json({ error: "invalid_github_url" }, { status: 400 });
    }
  }

  let linkedinUrl: string | null = null;
  if (body.linkedinUrl && body.linkedinUrl.length > 0) {
    linkedinUrl = normalizeLinkedinUrl(body.linkedinUrl);
    if (!linkedinUrl) {
      return NextResponse.json({ error: "invalid_linkedin_url" }, { status: 400 });
    }
  }

  // Eligibility gate (issue #217): at least MIN_RATED_CONTESTS rated CF
  // contests. Checked on every POST (edits too) — rated-contest count only
  // grows, so this never locks out an existing registrant. `cfHandle` is
  // non-null past `requireLinkedUser`, but guard defensively. Fail closed on
  // CF errors: registration is retryable.
  let ratedContests: number;
  try {
    const history = await getUserRating(session.user.cfHandle ?? "");
    ratedContests = history.length;
  } catch {
    return NextResponse.json({ error: "cf_unavailable" }, { status: 502 });
  }
  if (ratedContests < MIN_RATED_CONTESTS) {
    return NextResponse.json(
      { error: "not_enough_rated_contests", ratedContests },
      { status: 403 },
    );
  }

  const [registration] = await db
    .insert(tournamentRegistrations)
    .values({
      userId: session.user.id,
      githubUrl,
      linkedinUrl,
      termsAcceptedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tournamentRegistrations.userId,
      set: { githubUrl, linkedinUrl, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json(
    {
      githubUrl: registration.githubUrl,
      linkedinUrl: registration.linkedinUrl,
      createdAt: registration.createdAt,
      updatedAt: registration.updatedAt,
    },
    { status: 200 },
  );
}
