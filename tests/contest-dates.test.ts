/**
 * Tests for src/lib/cf/contest-dates.ts
 */

import { describe, it, expect } from "vitest";
import {
  buildContestDateMap,
  stampContestStartedAt,
  type ProblemWithoutContestDate,
} from "../src/lib/cf/contest-dates";
import type { CfContest } from "../src/lib/cf/client";

function contest(id: number, startTimeSeconds?: number): CfContest {
  return { id, name: `Contest ${id}`, phase: "FINISHED", startTimeSeconds };
}

function problem(id: string, contestId: number): ProblemWithoutContestDate {
  return {
    id,
    contestId,
    index: id.slice(String(contestId).length),
    name: `Problem ${id}`,
    rating: 1500,
    tags: [],
    fetchedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

describe("buildContestDateMap", () => {
  it("maps contestId to a Date derived from startTimeSeconds", () => {
    const map = buildContestDateMap([contest(1794, 1673000000)]);

    expect(map.get(1794)).toEqual(new Date(1673000000 * 1000));
  });

  it("converts epoch seconds (not milliseconds) to Date", () => {
    const map = buildContestDateMap([contest(1, 0)]);

    expect(map.get(1)).toEqual(new Date(0));
  });

  it("omits contests without a numeric startTimeSeconds", () => {
    const map = buildContestDateMap([contest(1794), contest(4, 100)]);

    expect(map.has(1794)).toBe(false);
    expect(map.get(4)).toEqual(new Date(100 * 1000));
  });

  it("returns an empty map for an empty contest list", () => {
    const map = buildContestDateMap([]);

    expect(map.size).toBe(0);
  });
});

describe("stampContestStartedAt", () => {
  it("stamps contestStartedAt from the map on a hit", () => {
    const contestDates = new Map([[1794, new Date(1673000000 * 1000)]]);
    const rows = [problem("1794C", 1794)];

    const stamped = stampContestStartedAt(rows, contestDates);

    expect(stamped).toHaveLength(1);
    expect(stamped[0].contestStartedAt).toEqual(new Date(1673000000 * 1000));
    // Rest of the row is passed through unchanged.
    expect(stamped[0].id).toBe("1794C");
    expect(stamped[0].contestId).toBe(1794);
  });

  it("stamps null on a miss (contest not in the map)", () => {
    const contestDates = new Map<number, Date>();
    const rows = [problem("4A", 4)];

    const stamped = stampContestStartedAt(rows, contestDates);

    expect(stamped[0].contestStartedAt).toBeNull();
  });

  it("stamps null for every row when the map is empty (e.g. contest.list failed)", () => {
    const rows = [problem("1794C", 1794), problem("4A", 4)];

    const stamped = stampContestStartedAt(rows, new Map());

    expect(stamped.every((row) => row.contestStartedAt === null)).toBe(true);
  });

  it("handles an empty row list", () => {
    const stamped = stampContestStartedAt([], new Map([[1, new Date(0)]]));

    expect(stamped).toEqual([]);
  });
});
