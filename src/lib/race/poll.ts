/**
 * CF verdict polling for a single active race (issue #15).
 *
 * Shared by the participant-driven poll route and the sweep-cron force-poll so
 * the two never diverge. The caller is responsible for the DB mutex (the poll
 * route claims `last_polled_at`; the cron bumps it) — `pollActiveRace` assumes
 * it holds the right to poll and just does the CF work + resolution:
 *
 *  - Fetch each player's recent submissions sequentially (the CF client spaces
 *    requests ~2s apart on its own).
 *  - `findRaceVerdicts` (#3) over the race problem since `startedAt`.
 *  - An OK submission finishes the race (earliest OK across both players wins).
 *  - Every observed final verdict (OK and non-OK) is UPSERTed into
 *    `race_submissions` and the latest non-OK is published as a `verdict` hint.
 *    Since users now submit on codeforces.com themselves (issue #55) there are
 *    no pre-inserted rows, so the poll is the sole writer of the feed.
 *  - No OK and `now > endsAt` ⇒ draw.
 *
 * All finishes go through {@link finishRace}, which is idempotent, so a
 * concurrent participant poll and cron force-poll resolving the same race is
 * safe.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { raceSubmissions, users, type Race } from "@/lib/db/schema";
import { getUserStatus } from "@/lib/cf/client";
import { findRaceVerdicts } from "@/lib/cf/verdicts";
import { publishRaceEvent as publishToRoom } from "@/lib/livekit";
import type { CfSubmission } from "@/lib/types";
import { finishRace } from "@/lib/race/finish";

interface AcceptedHit {
  userId: string;
  submission: CfSubmission;
}

/**
 * Poll CF for `race` (assumed `active`, mutex held by the caller) and resolve it
 * if a verdict or the time limit warrants. Best-effort: CF/LiveKit failures for
 * one player never abort the whole poll.
 */
export async function pollActiveRace(
  race: Race,
  now: Date = new Date(),
): Promise<void> {
  const timedOut =
    race.endsAt !== null && now.getTime() > race.endsAt.getTime();

  // No problem assigned yet — the only thing that can resolve the race is the
  // clock running out.
  if (!race.problemId) {
    if (timedOut) {
      await finishRace({
        raceId: race.id,
        outcome: "draw",
        winnerId: null,
        reason: "timeout",
      });
    }
    return;
  }

  const problemId = race.problemId;
  const sinceEpochSec = race.startedAt
    ? Math.floor(race.startedAt.getTime() / 1000)
    : 0;

  const playerIds = [race.p1Id, race.p2Id].filter(
    (id): id is string => id !== null,
  );
  const playerRows = await db
    .select()
    .from(users)
    .where(inArray(users.id, playerIds));
  const byId = new Map(playerRows.map((u) => [u.id, u]));

  const accepted: AcceptedHit[] = [];

  for (const userId of playerIds) {
    const user = byId.get(userId);
    if (!user?.cfHandle) continue;

    let submissions: CfSubmission[];
    try {
      submissions = await getUserStatus(user.cfHandle, 1, 20);
    } catch {
      // CF hiccup for this player — skip; the next poll retries.
      continue;
    }

    const verdicts = findRaceVerdicts(submissions, problemId, sinceEpochSec);

    // Surface every observed final verdict — including a manual OK — by
    // upserting a row, then publish the latest non-OK as a hint.
    const finals = verdicts.accepted
      ? [...verdicts.others, verdicts.accepted]
      : verdicts.others;
    await recordVerdicts(race, userId, finals);

    if (verdicts.accepted) {
      accepted.push({ userId, submission: verdicts.accepted });
    }
  }

  // A solve resolves the race — earliest OK submission wins (ties by lowest id).
  if (accepted.length > 0) {
    accepted.sort((a, b) => {
      const dt =
        a.submission.creationTimeSeconds - b.submission.creationTimeSeconds;
      return dt !== 0 ? dt : a.submission.id - b.submission.id;
    });
    const winner = accepted[0];
    await finishRace({
      raceId: race.id,
      outcome: winner.userId === race.p1Id ? "p1_win" : "p2_win",
      winnerId: winner.userId,
      winningSubmissionId: winner.submission.id,
      reason: "solved",
    });
    return;
  }

  // Nobody solved and the clock ran out ⇒ draw.
  if (timedOut) {
    await finishRace({
      raceId: race.id,
      outcome: "draw",
      winnerId: null,
      reason: "timeout",
    });
  }
}

/**
 * Persist final verdicts (OK and non-OK) into `race_submissions`, upserting per
 * CF submission id, then publish the most recent non-OK one as a `verdict`
 * hint. Users submit on codeforces.com themselves now, so there is never a
 * pre-inserted row — the poll inserts the row on first sighting (code is empty:
 * the source lives on Codeforces) and updates the verdict on later polls.
 */
async function recordVerdicts(
  race: Race,
  userId: string,
  submissions: CfSubmission[],
): Promise<void> {
  if (submissions.length === 0) return;

  for (const submission of submissions) {
    if (!submission.verdict) continue;
    await upsertRaceSubmission(race.id, userId, submission);
  }

  const nonOk = submissions.filter((s) => s.verdict && s.verdict !== "OK");
  if (nonOk.length === 0) return;

  const latest = nonOk.reduce((a, b) =>
    b.creationTimeSeconds > a.creationTimeSeconds ? b : a,
  );
  if (!latest.verdict) return;

  await publishToRoom(race.livekitRoom, {
    type: "verdict",
    userId,
    verdict: latest.verdict,
    cfSubmissionId: latest.id,
    submittedAt: new Date(latest.creationTimeSeconds * 1000).toISOString(),
  });
}

/**
 * Insert-or-update the `race_submissions` row for one CF submission. There is
 * no unique constraint on `(race_id, cf_submission_id)` (schema is frozen), so
 * we check-then-write; the caller holds the poll mutex, so a racing double
 * insert is not a concern here.
 */
async function upsertRaceSubmission(
  raceId: string,
  userId: string,
  submission: CfSubmission,
): Promise<void> {
  const verdict = submission.verdict ?? null;

  const [existing] = await db
    .select({ id: raceSubmissions.id })
    .from(raceSubmissions)
    .where(
      and(
        eq(raceSubmissions.raceId, raceId),
        eq(raceSubmissions.cfSubmissionId, submission.id),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(raceSubmissions)
      .set({ verdict })
      .where(eq(raceSubmissions.id, existing.id));
    return;
  }

  await db.insert(raceSubmissions).values({
    raceId,
    userId,
    cfSubmissionId: submission.id,
    code: "",
    verdict,
    submittedAt: new Date(submission.creationTimeSeconds * 1000),
  });
}
