/**
 * POST /api/races/[id]/submit — submit the caller's code to Codeforces (#11).
 *
 * Guards: caller is a signed-in participant with a linked CF account and the
 * race is `active` with a problem assigned. On success the code is submitted to
 * CF, a `race_submissions` row is recorded (verdict left null for #15 polling)
 * and the submission id is returned.
 *
 * On any CF failure (not-logged-in / duplicate / captcha / API error) we still
 * persist the code with a null `cfSubmissionId` and return
 * `{ ok:false, error:'cf_error', message }` so the client can show a
 * manual-submit fallback; #15 verdict polling then detects the manual attempt.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { problems, raceSubmissions, races } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { isParticipant } from "@/lib/race/machine";
import { submitSolution } from "@/lib/cf/submit";
import { CF_LANGUAGE_ID, type SubmitResponse } from "@/lib/types";

const bodySchema = z.object({
  code: z.string().min(1).max(65536),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }
  const userId = session.user.id;

  let code: string;
  try {
    const raw = await req.json().catch(() => undefined);
    code = bodySchema.parse(raw).code;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const [race] = await db
    .select()
    .from(races)
    .where(eq(races.id, id))
    .limit(1);

  if (!race) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!isParticipant(race, userId)) {
    const body: SubmitResponse = {
      ok: false,
      error: "not_participant",
      message: "You are not a participant in this race.",
    };
    return NextResponse.json(body, { status: 403 });
  }

  if (race.status !== "active" || !race.problemId) {
    const body: SubmitResponse = {
      ok: false,
      error: "not_active",
      message: "This race is not accepting submissions.",
    };
    return NextResponse.json(body, { status: 409 });
  }

  const [problem] = await db
    .select()
    .from(problems)
    .where(eq(problems.id, race.problemId))
    .limit(1);

  if (!problem) {
    const body: SubmitResponse = {
      ok: false,
      error: "not_active",
      message: "This race has no problem assigned yet.",
    };
    return NextResponse.json(body, { status: 409 });
  }

  try {
    const { cfSubmissionId } = await submitSolution({
      userId,
      contestId: problem.contestId,
      index: problem.index,
      code,
      languageId: CF_LANGUAGE_ID,
    });

    await db.insert(raceSubmissions).values({
      raceId: race.id,
      userId,
      cfSubmissionId,
      code,
      verdict: null,
    });

    const body: SubmitResponse = { ok: true, cfSubmissionId };
    return NextResponse.json(body, { status: 200 });
  } catch (error) {
    // Persist the code so the user's attempt is not lost and #15 polling can
    // still reconcile a manual submission. Never surface internal detail beyond
    // the (safe) error message.
    await db.insert(raceSubmissions).values({
      raceId: race.id,
      userId,
      cfSubmissionId: null,
      code,
      verdict: null,
    });

    const message =
      error instanceof Error
        ? error.message
        : "Automatic submission to Codeforces failed.";
    const body: SubmitResponse = { ok: false, error: "cf_error", message };
    return NextResponse.json(body, { status: 200 });
  }
}
