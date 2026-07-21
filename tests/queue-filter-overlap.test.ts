/**
 * Tests for the pure filter algebra in src/lib/matchmaking.ts:
 * `filtersOverlap` (do two players' filters share any problem?) and
 * `intersectFilters` (the tighter range stored on a matchmade race).
 *
 * These mirror the SQL overlap predicate `tryPair` builds; they are pure so the
 * null=unbounded semantics and inclusive touching bounds are cheap to
 * table-test without the db.
 */

import { describe, it, expect, vi } from "vitest";

// matchmaking.ts imports the db module at load time (which constructs the neon
// client from DATABASE_URL); stub it so these pure-function tests load without
// a database env. None of these functions touch the db.
vi.mock("@/lib/db", () => ({ db: {} }));

import { filtersOverlap, intersectFilters } from "@/lib/matchmaking";
import type { RaceProblemFilters } from "@/lib/types";

const f = (
  ratingMin: number | null,
  ratingMax: number | null,
  dateFrom: string | null = null,
  dateTo: string | null = null,
): RaceProblemFilters => ({ ratingMin, ratingMax, dateFrom, dateTo });

describe("filtersOverlap", () => {
  it("null × null (both unbounded) overlaps", () => {
    expect(filtersOverlap(f(null, null), f(null, null))).toBe(true);
  });

  it("null × bounded overlaps (unbounded contains everything)", () => {
    expect(filtersOverlap(f(null, null), f(1200, 1600))).toBe(true);
    expect(filtersOverlap(f(1200, 1600), f(null, null))).toBe(true);
  });

  it("one-sided bounds: (null, 1200) meets (1200, null) at the shared point", () => {
    expect(filtersOverlap(f(null, 1200), f(1200, null))).toBe(true);
    expect(filtersOverlap(f(null, 1100), f(1200, null))).toBe(false);
  });

  it("disjoint rating ranges do not overlap", () => {
    expect(filtersOverlap(f(800, 1000), f(1200, 1600))).toBe(false);
    expect(filtersOverlap(f(1200, 1600), f(800, 1000))).toBe(false);
  });

  it("touching bounds (a.max === b.min) overlap (inclusive)", () => {
    expect(filtersOverlap(f(800, 1200), f(1200, 1600))).toBe(true);
    expect(filtersOverlap(f(1200, 1600), f(800, 1200))).toBe(true);
  });

  it("overlapping rating ranges overlap", () => {
    expect(filtersOverlap(f(1000, 1400), f(1200, 1600))).toBe(true);
  });

  it("rating-only vs date-only: constrained on different axes still overlap", () => {
    const ratingOnly = f(1200, 1600);
    const dateOnly = f(null, null, "2024-01-01T00:00:00.000Z", "2024-06-01T00:00:00.000Z");
    expect(filtersOverlap(ratingOnly, dateOnly)).toBe(true);
    expect(filtersOverlap(dateOnly, ratingOnly)).toBe(true);
  });

  it("requires BOTH axes to overlap: matching ratings but disjoint dates do not overlap", () => {
    const a = f(1200, 1600, "2024-01-01T00:00:00.000Z", "2024-03-01T00:00:00.000Z");
    const b = f(1200, 1600, "2024-06-01T00:00:00.000Z", "2024-09-01T00:00:00.000Z");
    expect(filtersOverlap(a, b)).toBe(false);
  });

  it("overlapping dates overlap; touching date bounds are inclusive", () => {
    const a = f(null, null, "2024-01-01T00:00:00.000Z", "2024-06-01T00:00:00.000Z");
    const b = f(null, null, "2024-06-01T00:00:00.000Z", "2024-12-01T00:00:00.000Z");
    expect(filtersOverlap(a, b)).toBe(true);
  });

  it("is symmetric across a table of pairs", () => {
    const cases: [RaceProblemFilters, RaceProblemFilters][] = [
      [f(800, 1000), f(1200, 1600)],
      [f(1000, 1400), f(1200, 1600)],
      [f(null, 1200), f(1200, null)],
      [f(null, 1100), f(1200, null)],
      [f(1200, 1600, "2024-01-01T00:00:00.000Z", "2024-03-01T00:00:00.000Z"), f(1200, 1600, "2024-06-01T00:00:00.000Z", "2024-09-01T00:00:00.000Z")],
    ];
    for (const [a, b] of cases) {
      expect(filtersOverlap(a, b)).toBe(filtersOverlap(b, a));
    }
  });
});

describe("intersectFilters", () => {
  it("null × null yields all-null (a bound is null only when both are)", () => {
    expect(intersectFilters(f(null, null), f(null, null))).toEqual(f(null, null));
  });

  it("null × bounded yields the bounded side", () => {
    expect(intersectFilters(f(null, null), f(1200, 1600))).toEqual(f(1200, 1600));
    expect(intersectFilters(f(1200, 1600), f(null, null))).toEqual(f(1200, 1600));
  });

  it("takes max of mins and min of maxes", () => {
    expect(intersectFilters(f(1000, 1600), f(1200, 1500))).toEqual(f(1200, 1500));
  });

  it("mixes: tighter min from one side, tighter max from the other", () => {
    expect(intersectFilters(f(1000, 1500), f(1200, 1800))).toEqual(f(1200, 1500));
  });

  it("one-sided bounds combine into a two-sided range", () => {
    expect(intersectFilters(f(1200, null), f(null, 1600))).toEqual(f(1200, 1600));
  });

  it("intersects dates: later `from`, earlier `to`", () => {
    const a = f(null, null, "2024-01-01T00:00:00.000Z", "2024-08-01T00:00:00.000Z");
    const b = f(null, null, "2024-03-01T00:00:00.000Z", "2024-06-01T00:00:00.000Z");
    expect(intersectFilters(a, b)).toEqual(
      f(null, null, "2024-03-01T00:00:00.000Z", "2024-06-01T00:00:00.000Z"),
    );
  });

  it("is symmetric", () => {
    const a = f(1000, 1600, "2024-01-01T00:00:00.000Z", "2024-08-01T00:00:00.000Z");
    const b = f(1200, 1500, "2024-03-01T00:00:00.000Z", "2024-06-01T00:00:00.000Z");
    expect(intersectFilters(a, b)).toEqual(intersectFilters(b, a));
  });
});
