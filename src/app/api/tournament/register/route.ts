/**
 * POST /api/tournament/register — register (or update) for the launch
 * tournament (issue #209).
 *
 * Thin shell mirroring `src/app/api/races/join/route.ts`: `requireLinkedUser`
 * gates on signed-in + linked CF account, zod validates the body, the pure
 * normalizers in `src/lib/tournament/registration.ts` validate firstName,
 * lastName, email (required — issue #239), location, and the optional
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
import { enforceDbRateLimit, TOURNAMENT_REGISTER_POLICY } from "@/lib/ratelimit/policies";
import {
  normalizeEmail,
  normalizeGithubUrl,
  normalizeLinkedinUrl,
  normalizeLocation,
  normalizeName,
} from "@/lib/tournament/registration";

/** Minimum peak Codeforces rating required to register — Candidate Master
 *  threshold (issue #280). */
const MIN_PEAK_RATING = 1900;

const bodySchema = z.object({
  // Required identity fields (issue #239). Required on every POST, including
  // edits — existing registrants must fill them in on their next edit.
  firstName: z.string().max(500),
  lastName: z.string().max(500),
  email: z.string().max(500),
  location: z.string().max(500).optional(),
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

  const limited = await enforceDbRateLimit(
    req,
    "tournament_register",
    session.user.id,
    TOURNAMENT_REGISTER_POLICY,
  );
  if (limited) return limited;

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

  // Required identity fields (issue #239).
  const firstName = normalizeName(body.firstName);
  if (!firstName) {
    return NextResponse.json({ error: "invalid_first_name" }, { status: 400 });
  }

  const lastName = normalizeName(body.lastName);
  if (!lastName) {
    return NextResponse.json({ error: "invalid_last_name" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  // Optional; empty string means "clear this field" -> null, same as the
  // profile URLs below.
  let location: string | null = null;
  if (body.location && body.location.length > 0) {
    location = normalizeLocation(body.location);
    if (!location) {
      return NextResponse.json({ error: "invalid_location" }, { status: 400 });
    }
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

  // Eligibility gate (issue #280): peak rating must be at least
  // MIN_PEAK_RATING (Candidate Master). Checked on every POST (edits too) —
  // peak rating only grows, so this never locks out an existing registrant.
  // `cfHandle` is non-null past `requireLinkedUser`, but guard defensively.
  // Fail closed on CF errors: registration is retryable.
  let peakRating: number | null;
  try {
    const history = await getUserRating(session.user.cfHandle ?? "");
    peakRating = history.length ? Math.max(...history.map((h) => h.newRating)) : null;
  } catch {
    return NextResponse.json({ error: "cf_unavailable" }, { status: 502 });
  }
  if (peakRating === null || peakRating < MIN_PEAK_RATING) {
    return NextResponse.json(
      { error: "rating_too_low", peakRating },
      { status: 403 },
    );
  }

  const [registration] = await db
    .insert(tournamentRegistrations)
    .values({
      userId: session.user.id,
      firstName,
      lastName,
      email,
      location,
      githubUrl,
      linkedinUrl,
      termsAcceptedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tournamentRegistrations.userId,
      set: {
        firstName,
        lastName,
        email,
        location,
        githubUrl,
        linkedinUrl,
        updatedAt: new Date(),
      },
    })
    .returning();

  return NextResponse.json(
    {
      firstName: registration.firstName,
      lastName: registration.lastName,
      email: registration.email,
      location: registration.location,
      githubUrl: registration.githubUrl,
      linkedinUrl: registration.linkedinUrl,
      createdAt: registration.createdAt,
      updatedAt: registration.updatedAt,
    },
    { status: 200 },
  );
}
