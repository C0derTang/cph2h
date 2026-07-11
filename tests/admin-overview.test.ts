/**
 * Tests for the pure aggregation helpers in src/lib/admin/overview.ts
 * (issue #175) — histogram bucketing and per-day grouping given raw rows,
 * per the issue's unit-test requirement. No DB involved.
 */

import { describe, expect, it, vi } from "vitest";

// overview.ts also exports the `getAdminOverview` query shell, which imports
// `@/lib/db` — that module instantiates `neon(process.env.DATABASE_URL!)` at
// import time, which throws without a real connection string. Stub it out;
// these tests only exercise the pure bucketing/grouping functions below.
vi.mock("@/lib/db", () => ({ db: {} }));

import { bucketEloHistogram, countVerdicts, groupRacesPerDay } from "@/lib/admin/overview";

describe("bucketEloHistogram", () => {
  it("buckets elos into 100-wide floors", () => {
    const result = bucketEloHistogram([1205, 1290, 1301, 999, 1000]);
    expect(result).toEqual([
      { bucketFloor: 900, count: 1 },
      { bucketFloor: 1000, count: 1 },
      { bucketFloor: 1200, count: 2 },
      { bucketFloor: 1300, count: 1 },
    ]);
  });

  it("returns an empty array for no users", () => {
    expect(bucketEloHistogram([])).toEqual([]);
  });

  it("supports a custom bucket size", () => {
    expect(bucketEloHistogram([50, 99, 150], 50)).toEqual([
      { bucketFloor: 50, count: 2 },
      { bucketFloor: 150, count: 1 },
    ]);
  });

  it("buckets a floor-aligned elo into its own bucket, not the one below", () => {
    expect(bucketEloHistogram([1200])).toEqual([{ bucketFloor: 1200, count: 1 }]);
  });
});

describe("groupRacesPerDay", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");

  it("zero-fills every day in the window, newest last", () => {
    const result = groupRacesPerDay([], now, 5);
    expect(result).toEqual([
      { date: "2026-07-06", count: 0 },
      { date: "2026-07-07", count: 0 },
      { date: "2026-07-08", count: 0 },
      { date: "2026-07-09", count: 0 },
      { date: "2026-07-10", count: 0 },
    ]);
  });

  it("counts races on their UTC day", () => {
    const result = groupRacesPerDay(
      [
        new Date("2026-07-09T23:59:00.000Z"),
        new Date("2026-07-09T01:00:00.000Z"),
        new Date("2026-07-10T00:00:01.000Z"),
      ],
      now,
      5,
    );
    expect(result).toEqual([
      { date: "2026-07-06", count: 0 },
      { date: "2026-07-07", count: 0 },
      { date: "2026-07-08", count: 0 },
      { date: "2026-07-09", count: 2 },
      { date: "2026-07-10", count: 1 },
    ]);
  });

  it("drops races outside the window", () => {
    const result = groupRacesPerDay([new Date("2020-01-01T00:00:00.000Z")], now, 5);
    expect(result.reduce((sum, d) => sum + d.count, 0)).toBe(0);
  });
});

describe("countVerdicts", () => {
  it("counts non-null verdicts, most common first", () => {
    const result = countVerdicts(["OK", "WRONG_ANSWER", "OK", "OK", "WRONG_ANSWER"]);
    expect(result).toEqual([
      { verdict: "OK", count: 3 },
      { verdict: "WRONG_ANSWER", count: 2 },
    ]);
  });

  it("excludes pending (null) verdicts", () => {
    expect(countVerdicts(["OK", null, null])).toEqual([{ verdict: "OK", count: 1 }]);
  });

  it("returns an empty array for no submissions", () => {
    expect(countVerdicts([])).toEqual([]);
  });
});
