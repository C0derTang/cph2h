/**
 * Tests for the pure helpers in src/components/race/FilterEditor.tsx
 * (extracted from Lobby.tsx in issue #276 — previously untestable since
 * nothing in the module was exported).
 */

import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTERS,
  RATING_OPTIONS,
  presetDateFrom,
  dayStartIso,
  dayEndIso,
  isoToDateInput,
  filterSummary,
} from "../src/components/race/FilterEditor";
import { PROBLEM_RATING_CEIL, PROBLEM_RATING_FLOOR } from "../src/lib/types";
import type { RaceProblemFilters } from "../src/lib/types";

describe("RATING_OPTIONS", () => {
  it("spans every multiple of 100 from floor to ceil, inclusive", () => {
    expect(RATING_OPTIONS[0]).toBe(PROBLEM_RATING_FLOOR);
    expect(RATING_OPTIONS[RATING_OPTIONS.length - 1]).toBe(PROBLEM_RATING_CEIL);
    expect(RATING_OPTIONS.every((r) => r % 100 === 0)).toBe(true);
  });
});

describe("presetDateFrom", () => {
  it("returns null for 'any' and 'custom'", () => {
    expect(presetDateFrom("any")).toBeNull();
    expect(presetDateFrom("custom")).toBeNull();
  });

  it("returns an ISO string N years before now for 1y/2y/5y", () => {
    const now = new Date();
    for (const [preset, years] of [
      ["1y", 1],
      ["2y", 2],
      ["5y", 5],
    ] as const) {
      const iso = presetDateFrom(preset);
      expect(iso).not.toBeNull();
      const d = new Date(iso!);
      expect(d.getUTCFullYear()).toBe(now.getUTCFullYear() - years);
    }
  });
});

describe("dayStartIso / dayEndIso", () => {
  it("returns null for an empty string", () => {
    expect(dayStartIso("")).toBeNull();
    expect(dayEndIso("")).toBeNull();
  });

  it("returns null for an invalid date string", () => {
    expect(dayStartIso("not-a-date")).toBeNull();
    expect(dayEndIso("not-a-date")).toBeNull();
  });

  it("anchors to the start/end of the given UTC day", () => {
    expect(dayStartIso("2026-03-15")).toBe("2026-03-15T00:00:00.000Z");
    expect(dayEndIso("2026-03-15")).toBe("2026-03-15T23:59:59.999Z");
  });
});

describe("isoToDateInput", () => {
  it("returns an empty string for null", () => {
    expect(isoToDateInput(null)).toBe("");
  });

  it("truncates an ISO string to yyyy-mm-dd", () => {
    expect(isoToDateInput("2026-03-15T12:34:56.000Z")).toBe("2026-03-15");
  });
});

describe("filterSummary", () => {
  it("reports 'no filters' for the empty filter set", () => {
    expect(filterSummary(EMPTY_FILTERS)).toBe("No filters — any problem");
  });

  it("fills in the floor/ceil defaults for a one-sided rating range", () => {
    const filters: RaceProblemFilters = { ...EMPTY_FILTERS, ratingMin: 1200 };
    expect(filterSummary(filters)).toBe(`Rating 1200–${PROBLEM_RATING_CEIL}`);
  });

  it("renders a full rating range", () => {
    const filters: RaceProblemFilters = { ...EMPTY_FILTERS, ratingMin: 1200, ratingMax: 1900 };
    expect(filterSummary(filters)).toBe("Rating 1200–1900");
  });

  it("renders a contest-date range alongside a rating range", () => {
    const filters: RaceProblemFilters = {
      ratingMin: 1200,
      ratingMax: 1900,
      dateFrom: "2024-01-01T00:00:00.000Z",
      dateTo: "2024-12-31T23:59:59.999Z",
    };
    expect(filterSummary(filters)).toBe("Rating 1200–1900 · Contest 2024-01-01 → 2024-12-31");
  });

  it("uses 'any' for a one-sided date range", () => {
    const filters: RaceProblemFilters = {
      ...EMPTY_FILTERS,
      dateFrom: "2024-01-01T00:00:00.000Z",
    };
    expect(filterSummary(filters)).toBe("Contest 2024-01-01 → any");
  });
});
