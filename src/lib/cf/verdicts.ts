/**
 * Pure verdict parsing over Codeforces submissions. No I/O.
 */

import type { CfSubmission, ProblemId } from "@/lib/types";
import { problemIdOf } from "@/lib/types";

/** Verdicts CF reports while a submission is still being judged. */
const NON_FINAL_VERDICTS = new Set([
  "TESTING",
  "COMPILING",
  "SUBMITTED",
  "QUEUED",
  "RUNNING",
]);

/**
 * Whether `verdict` represents a final judgement. Absent verdicts (still
 * testing, per the CF API) and known in-progress verdicts are not final.
 */
export function isFinalVerdict(verdict: string | undefined): boolean {
  if (!verdict) {
    return false;
  }
  return !NON_FINAL_VERDICTS.has(verdict);
}

export interface RaceVerdicts {
  /** Earliest submission with verdict "OK" for the race problem, or null. */
  accepted: CfSubmission | null;
  /** Final, non-OK verdicts for the race problem (still-judging submissions are skipped). */
  others: CfSubmission[];
}

/**
 * Finds the verdicts relevant to a race: submissions to `problemId` created
 * at or after `sinceEpochSec`. `accepted` is the earliest "OK" among those
 * (ties broken by earliest `creationTimeSeconds`, then lowest submission id).
 * `others` holds every other *final* verdict — submissions still testing
 * (absent or in-progress verdict) are skipped entirely.
 */
export function findRaceVerdicts(
  submissions: CfSubmission[],
  problemId: ProblemId,
  sinceEpochSec: number,
): RaceVerdicts {
  const relevant = submissions.filter(
    (submission) =>
      problemIdOf(submission.problem) === problemId &&
      submission.creationTimeSeconds >= sinceEpochSec,
  );

  let accepted: CfSubmission | null = null;
  for (const submission of relevant) {
    if (submission.verdict !== "OK") {
      continue;
    }
    if (
      accepted === null ||
      submission.creationTimeSeconds < accepted.creationTimeSeconds ||
      (submission.creationTimeSeconds === accepted.creationTimeSeconds &&
        submission.id < accepted.id)
    ) {
      accepted = submission;
    }
  }

  const others = relevant.filter(
    (submission) => submission.verdict !== "OK" && isFinalVerdict(submission.verdict),
  );

  return { accepted, others };
}
