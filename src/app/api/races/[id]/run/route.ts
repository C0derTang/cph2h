/**
 * POST /api/races/[id]/run — run submitted C++ against a race problem's
 * cached sample tests via Judge0 CE (issue #13).
 *
 * This is a convenience/practice endpoint, not the scoring path: the
 * authoritative verdict comes from a real Codeforces submission (#11). Guards:
 * caller must be signed in with a linked CF account and a participant of the
 * race. Samples are read from `problem_statements` (cached per problem by
 * #9) — never re-scraped here.
 *
 * Per-user rate limit ({@link RUN_RATE_LIMIT_SEC}) is tracked in an
 * in-memory map keyed by userId, per the issue spec (acceptable for this
 * non-authoritative, best-effort endpoint).
 *
 * Samples run sequentially through Judge0. A compilation error is identical
 * for every sample (the same source is recompiled each time), so we
 * short-circuit after the first one rather than re-submitting unchanged
 * source `samples.length` times.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { problemStatements, races } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { isParticipant } from "@/lib/race/machine";
import {
  JUDGE0_STATUS_ACCEPTED,
  JUDGE0_STATUS_COMPILE_ERROR,
  outputsMatch,
  runCode,
} from "@/lib/judge0";
import {
  RUN_RATE_LIMIT_SEC,
  type RunResponse,
  type RunSampleResult,
} from "@/lib/types";

const bodySchema = z.object({
  code: z.string().min(1),
});

/** userId -> ms epoch of the last accepted run. Module-scoped by design. */
const lastRunAt = new Map<string, number>();

function json(body: RunResponse, status: number) {
  return NextResponse.json(body, { status });
}

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

  const rawBody = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const [race] = await db.select().from(races).where(eq(races.id, id)).limit(1);
  if (!race) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!isParticipant(race, userId)) {
    return NextResponse.json({ error: "not_participant" }, { status: 403 });
  }

  const now = Date.now();
  const last = lastRunAt.get(userId);
  if (last !== undefined && now - last < RUN_RATE_LIMIT_SEC * 1000) {
    return json(
      {
        ok: false,
        error: "rate_limited",
        message: `Wait ${RUN_RATE_LIMIT_SEC}s between runs.`,
      },
      429,
    );
  }

  if (!race.problemId) {
    return json(
      { ok: false, error: "no_samples", message: "No problem assigned to this race yet." },
      409,
    );
  }

  const [statementRow] = await db
    .select()
    .from(problemStatements)
    .where(eq(problemStatements.problemId, race.problemId))
    .limit(1);

  const samples = statementRow?.samples ?? [];
  if (samples.length === 0) {
    return json(
      { ok: false, error: "no_samples", message: "This problem has no cached sample tests." },
      409,
    );
  }

  // Only mark the rate-limit clock once we're actually about to spend a
  // Judge0 call — guard failures above (not found / not participant /
  // no samples) don't count against the caller.
  lastRunAt.set(userId, now);

  try {
    const results: RunSampleResult[] = [];
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const result = await runCode({ code: parsed.data.code, stdin: sample.input });
      results.push({
        sampleIndex: i,
        passed:
          result.statusId === JUDGE0_STATUS_ACCEPTED &&
          outputsMatch(result.stdout, sample.output),
        actualOutput: result.stdout,
        stderr: result.stderr,
        status: result.status,
        compileOutput: result.compileOutput,
        timeSec: result.timeSec,
      });

      if (result.statusId === JUDGE0_STATUS_COMPILE_ERROR) {
        break;
      }
    }

    return json({ ok: true, results }, 200);
  } catch (err) {
    return json(
      {
        ok: false,
        error: "judge0_error",
        message: err instanceof Error ? err.message : "Judge0 request failed.",
      },
      502,
    );
  }
}
