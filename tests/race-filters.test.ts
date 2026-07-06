/**
 * Tests for issue #64 (challenge-creation problem filters) — the pure /
 * near-pure pieces:
 *  - `raceFiltersSchema` (src/lib/race/filters.ts) accept/reject matrix.
 *  - `buildAvailabilityWhere` (src/lib/cf/problem-availability.ts) — a pure
 *    where-clause builder, asserted directly against manually-built drizzle
 *    conditions on the real `problems` table.
 *  - `countAvailableProblems` against a mocked `db`.
 *
 * Route-level behavior (POST /api/races, GET /api/problems/availability) is
 * covered in `tests/race-create-filters-route.test.ts` and
 * `tests/problem-availability-route.test.ts` — kept in separate files because
 * each mocks `@/lib/cf/problem-availability` / `@/lib/db` differently than
 * this file does, and `vi.mock` is hoisted per-module-path per file.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, gte, isNotNull, lte } from "drizzle-orm";
import { problems } from "../src/lib/db/schema";
import { raceFiltersSchema, toRaceProblemFilters, hasAnyFilter } from "../src/lib/race/filters";
import type { RaceProblemFilters } from "../src/lib/types";

// Only `countAvailableProblems` (below) touches `@/lib/db`; `raceFiltersSchema`
// and `buildAvailabilityWhere` are exercised unmocked.
const { whereMock } = vi.hoisted(() => ({ whereMock: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => {
          whereMock(...args);
          return Promise.resolve([{ count: 3 }]);
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve([{ count: 3 }]).then(resolve),
      }),
    }),
  },
}));

// ---------------------------------------------------------------------------
// raceFiltersSchema — pure, no mocking needed.
// ---------------------------------------------------------------------------

describe("raceFiltersSchema", () => {
  it("accepts an empty body (no filters)", () => {
    const parsed = raceFiltersSchema.parse({});
    expect(parsed).toEqual({});
  });

  it("accepts valid rating bounds that are multiples of 100 within [800, 3500]", () => {
    expect(() => raceFiltersSchema.parse({ ratingMin: 800, ratingMax: 3500 })).not.toThrow();
    expect(() => raceFiltersSchema.parse({ ratingMin: 1200, ratingMax: 1200 })).not.toThrow();
  });

  it("accepts a single-sided rating bound", () => {
    expect(() => raceFiltersSchema.parse({ ratingMin: 1500 })).not.toThrow();
    expect(() => raceFiltersSchema.parse({ ratingMax: 1500 })).not.toThrow();
  });

  it("rejects a rating below the floor or above the ceiling", () => {
    expect(() => raceFiltersSchema.parse({ ratingMin: 700 })).toThrow();
    expect(() => raceFiltersSchema.parse({ ratingMax: 3600 })).toThrow();
  });

  it("rejects a rating that isn't a multiple of 100", () => {
    expect(() => raceFiltersSchema.parse({ ratingMin: 850 })).toThrow();
  });

  it("rejects ratingMin > ratingMax", () => {
    expect(() => raceFiltersSchema.parse({ ratingMin: 2000, ratingMax: 1000 })).toThrow();
  });

  it("accepts valid ISO datetime strings with dateFrom <= dateTo", () => {
    expect(() =>
      raceFiltersSchema.parse({
        dateFrom: "2020-01-01T00:00:00.000Z",
        dateTo: "2021-01-01T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("accepts equal dateFrom and dateTo", () => {
    const iso = "2020-06-15T12:00:00.000Z";
    expect(() => raceFiltersSchema.parse({ dateFrom: iso, dateTo: iso })).not.toThrow();
  });

  it("rejects a non-ISO date string", () => {
    expect(() => raceFiltersSchema.parse({ dateFrom: "2020-01-01" })).toThrow();
    expect(() => raceFiltersSchema.parse({ dateFrom: "not-a-date" })).toThrow();
  });

  it("rejects dateFrom > dateTo", () => {
    expect(() =>
      raceFiltersSchema.parse({
        dateFrom: "2021-01-01T00:00:00.000Z",
        dateTo: "2020-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("toRaceProblemFilters maps undefined -> null", () => {
    const parsed = raceFiltersSchema.parse({ ratingMin: 1000 });
    expect(toRaceProblemFilters(parsed)).toEqual({
      ratingMin: 1000,
      ratingMax: null,
      dateFrom: null,
      dateTo: null,
    } satisfies RaceProblemFilters);
  });

  it("hasAnyFilter is false only when every field is null", () => {
    expect(hasAnyFilter({ ratingMin: null, ratingMax: null, dateFrom: null, dateTo: null })).toBe(
      false,
    );
    expect(hasAnyFilter({ ratingMin: 1000, ratingMax: null, dateFrom: null, dateTo: null })).toBe(
      true,
    );
    expect(
      hasAnyFilter({
        ratingMin: null,
        ratingMax: null,
        dateFrom: "2020-01-01T00:00:00.000Z",
        dateTo: null,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildAvailabilityWhere — pure where-clause builder (real module, no mocks).
// ---------------------------------------------------------------------------

const NO_FILTERS: RaceProblemFilters = {
  ratingMin: null,
  ratingMax: null,
  dateFrom: null,
  dateTo: null,
};

describe("buildAvailabilityWhere", () => {
  it("returns undefined when no filter is set (matches every cached problem)", async () => {
    const { buildAvailabilityWhere } = await import("../src/lib/cf/problem-availability");
    expect(buildAvailabilityWhere(NO_FILTERS)).toBeUndefined();
  });

  it("builds a rating-only condition", async () => {
    const { buildAvailabilityWhere } = await import("../src/lib/cf/problem-availability");
    const where = buildAvailabilityWhere({ ...NO_FILTERS, ratingMin: 800, ratingMax: 1200 });
    expect(where).toEqual(and(gte(problems.rating, 800), lte(problems.rating, 1200)));
  });

  it("builds a single-sided rating condition", async () => {
    const { buildAvailabilityWhere } = await import("../src/lib/cf/problem-availability");
    const where = buildAvailabilityWhere({ ...NO_FILTERS, ratingMin: 1500 });
    expect(where).toEqual(and(gte(problems.rating, 1500)));
  });

  it("excludes null contest_started_at whenever a date bound is set", async () => {
    const { buildAvailabilityWhere } = await import("../src/lib/cf/problem-availability");
    const dateFrom = "2020-01-01T00:00:00.000Z";
    const where = buildAvailabilityWhere({ ...NO_FILTERS, dateFrom });
    expect(where).toEqual(
      and(isNotNull(problems.contestStartedAt), gte(problems.contestStartedAt, new Date(dateFrom))),
    );
  });

  it("combines rating and date bounds", async () => {
    const { buildAvailabilityWhere } = await import("../src/lib/cf/problem-availability");
    const dateFrom = "2020-01-01T00:00:00.000Z";
    const dateTo = "2021-01-01T00:00:00.000Z";
    const where = buildAvailabilityWhere({ ratingMin: 800, ratingMax: 1200, dateFrom, dateTo });
    expect(where).toEqual(
      and(
        gte(problems.rating, 800),
        lte(problems.rating, 1200),
        isNotNull(problems.contestStartedAt),
        gte(problems.contestStartedAt, new Date(dateFrom)),
        lte(problems.contestStartedAt, new Date(dateTo)),
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// countAvailableProblems — thin DB call, mocked db.
// ---------------------------------------------------------------------------

describe("countAvailableProblems", () => {
  beforeEach(() => {
    whereMock.mockClear();
  });

  it("returns the count row's value, calling .where() when a filter is set", async () => {
    const { countAvailableProblems } = await import("../src/lib/cf/problem-availability");
    const count = await countAvailableProblems({ ...NO_FILTERS, ratingMin: 1000 });
    expect(count).toBe(3);
    expect(whereMock).toHaveBeenCalledTimes(1);
  });

  it("skips .where() entirely when there is no filter", async () => {
    const { countAvailableProblems } = await import("../src/lib/cf/problem-availability");
    const count = await countAvailableProblems(NO_FILTERS);
    expect(count).toBe(3);
    expect(whereMock).not.toHaveBeenCalled();
  });
});
