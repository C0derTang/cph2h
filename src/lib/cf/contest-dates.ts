/**
 * Pure helpers for turning CF `contest.list` results into `contestStartedAt`
 * stamps on cached problem rows.
 *
 * `problemset.problems` (the payload the problem cache is built from) does
 * not carry contest start times, so this is a second, independent lookup:
 * build a `contestId -> start Date` map from `contest.list`, then stamp rows
 * with it. Contests without `startTimeSeconds` (e.g. not-yet-started
 * contests) are omitted from the map, and any problem whose contest is
 * missing from the map (omitted above, or `contest.list` itself failed) gets
 * a null `contestStartedAt` — never a leak of a "no filter" match onto a
 * wrong date.
 */

import type { CfContest } from "@/lib/cf/client";
import type { NewProblem } from "@/lib/db/schema";

/** A problem row not yet stamped with its contest start date. */
export type ProblemWithoutContestDate = Omit<NewProblem, "contestStartedAt">;

/**
 * Builds a `contestId -> start Date` map from `contest.list` results.
 * Contests without a numeric `startTimeSeconds` are omitted.
 */
export function buildContestDateMap(contests: CfContest[]): Map<number, Date> {
  const map = new Map<number, Date>();
  for (const contest of contests) {
    if (typeof contest.startTimeSeconds !== "number") {
      continue;
    }
    map.set(contest.id, new Date(contest.startTimeSeconds * 1000));
  }
  return map;
}

/**
 * Stamps each row's `contestStartedAt` from `contestDates`, keyed by the
 * row's `contestId`. Rows whose contest isn't in the map (unknown, gym, or
 * `contest.list` unavailable) get `null`.
 */
export function stampContestStartedAt(
  rows: ProblemWithoutContestDate[],
  contestDates: Map<number, Date>,
): NewProblem[] {
  return rows.map((row) => ({
    ...row,
    contestStartedAt: contestDates.get(row.contestId) ?? null,
  }));
}
