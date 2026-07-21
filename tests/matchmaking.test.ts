/**
 * Tests for src/lib/matchmaking.ts
 *
 * `bandForWait` is pure and exhaustively table-tested. `tryPair` is exercised
 * against a mocked `db.execute` to assert the SQL it builds (single statement,
 * FOR UPDATE SKIP LOCKED, correct bind params) and how it maps the result rows.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module before importing the code under test. `vi.mock` is hoisted
// above imports, so the mock fn is created via `vi.hoisted` to be in scope.
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { execute } }));

import {
  bandForWait,
  tryPair,
  BAND_BASE,
  BAND_STEP,
  BAND_STEP_SEC,
  BAND_MAX,
} from "@/lib/matchmaking";
import type { RaceProblemFilters } from "@/lib/types";

/** A fully unbounded filter set (all four columns null). */
const NO_FILTERS: RaceProblemFilters = {
  ratingMin: null,
  ratingMax: null,
  dateFrom: null,
  dateTo: null,
};

/** A queue row with no filters, for `RETURNING` mocks. */
function row(userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    rating_min: null,
    rating_max: null,
    date_from: null,
    date_to: null,
  };
}

describe("bandForWait", () => {
  it("returns the base band at zero / negative / non-finite wait", () => {
    expect(bandForWait(0)).toBe(BAND_BASE);
    expect(bandForWait(-5)).toBe(BAND_BASE);
    expect(bandForWait(NaN)).toBe(BAND_BASE);
    expect(bandForWait(Infinity)).toBe(BAND_BASE);
  });

  it("stays at the base band for the first step window", () => {
    expect(bandForWait(1)).toBe(100);
    expect(bandForWait(9)).toBe(100);
    expect(bandForWait(BAND_STEP_SEC - 1)).toBe(100);
  });

  it("widens by one step at each 10s boundary", () => {
    expect(bandForWait(10)).toBe(150);
    expect(bandForWait(19)).toBe(150);
    expect(bandForWait(20)).toBe(200);
    expect(bandForWait(30)).toBe(250);
    expect(bandForWait(60)).toBe(400);
  });

  it("matches the closed-form 100 + 50 * floor(w/10) below the cap", () => {
    for (const w of [0, 5, 10, 15, 33, 47, 99, 120]) {
      const expected = Math.min(
        BAND_BASE + BAND_STEP * Math.floor(w / BAND_STEP_SEC),
        BAND_MAX,
      );
      expect(bandForWait(w)).toBe(expected);
    }
  });

  it("caps at 800", () => {
    // 800 is reached at floor(w/10) = 14 -> w = 140.
    expect(bandForWait(140)).toBe(800);
    expect(bandForWait(150)).toBe(800);
    expect(bandForWait(10_000)).toBe(800);
    expect(bandForWait(140)).toBeLessThanOrEqual(BAND_MAX);
  });
});

describe("tryPair", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("enqueue mode: returns the opponent + filters when the opponent row is deleted", async () => {
    execute.mockResolvedValueOnce({
      rows: [{ ...row("opp-1"), rating_min: 1200, rating_max: 1600 }],
    });
    const matched = await tryPair({ userId: "me", elo: 1200, filters: NO_FILTERS }, 100, "enqueue");
    expect(matched).toEqual({
      opponentId: "opp-1",
      opponentFilters: { ratingMin: 1200, ratingMax: 1600, dateFrom: null, dateTo: null },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("poll mode: returns the opponent (picking the non-self row) only when BOTH rows were deleted", async () => {
    execute.mockResolvedValueOnce({ rows: [row("me"), row("opp-1")] });
    const matched = await tryPair({ userId: "me", elo: 1200, filters: NO_FILTERS }, 100, "poll");
    expect(matched?.opponentId).toBe("opp-1");
  });

  it("poll mode: refuses a race when only the opponent row was deleted (self not locked)", async () => {
    // Simulates the 3+ concurrent-poller hole: our own row was already claimed
    // by another pairing, so it never made it into `pair`/`deleted`.
    execute.mockResolvedValueOnce({ rows: [row("opp-1")] });
    const matched = await tryPair({ userId: "me", elo: 1200, filters: NO_FILTERS }, 100, "poll");
    expect(matched).toBeNull();
  });

  it("poll mode: returns null when nothing was deleted", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    const matched = await tryPair({ userId: "me", elo: 1200, filters: NO_FILTERS }, 200, "poll");
    expect(matched).toBeNull();
  });

  it("tolerates a result without a rows array", async () => {
    execute.mockResolvedValueOnce({});
    const matched = await tryPair({ userId: "me", elo: 1200, filters: NO_FILTERS }, 200, "enqueue");
    expect(matched).toBeNull();
  });

  it("issues a single locking statement with the caller's params", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await tryPair({ userId: "me-42", elo: 1337, filters: NO_FILTERS }, 250, "enqueue");

    expect(execute).toHaveBeenCalledTimes(1);
    const query = execute.mock.calls[0][0];

    // The drizzle `sql` object carries the literal chunks and the bound params;
    // JSON.stringify surfaces both so we can assert on the raw SQL shape.
    const text = JSON.stringify(query);
    expect(text).toContain("FOR UPDATE SKIP LOCKED");
    expect(text).toContain("queue_entries");
    expect(text).toContain("me-42");
    expect(text).toContain("1337");
    expect(text).toContain("250");
  });

  it("builds the four overlap conditions with explicit ::int/::timestamptz casts", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await tryPair(
      { userId: "me", elo: 1200, filters: { ratingMin: 1000, ratingMax: 1500, dateFrom: null, dateTo: null } },
      100,
      "enqueue",
    );
    const text = JSON.stringify(execute.mock.calls[0][0]);
    // Overlap predicate: candidate columns compared against the caller's bounds.
    expect(text).toContain("rating_min IS NULL OR");
    expect(text).toContain("::int IS NULL OR rating_min <= ");
    expect(text).toContain("rating_max IS NULL OR");
    expect(text).toContain("::int IS NULL OR rating_max >= ");
    expect(text).toContain("date_from IS NULL OR");
    expect(text).toContain("::timestamptz IS NULL OR date_from <= ");
    expect(text).toContain("date_to IS NULL OR");
    expect(text).toContain("::timestamptz IS NULL OR date_to >= ");
  });

  it("RETURNING carries the opponent's filter columns", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await tryPair({ userId: "me", elo: 1200, filters: NO_FILTERS }, 100, "enqueue");
    const text = JSON.stringify(execute.mock.calls[0][0]);
    expect(text).toContain("RETURNING user_id, rating_min, rating_max, date_from, date_to");
  });

  it("accepts all-null filter binds without erroring (the ::int/::timestamptz casts type them)", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    // All-null filters: every filter bind is null and is cast in SQL so
    // neon-http can type it; the statement builds and runs without throwing.
    await expect(
      tryPair({ userId: "me", elo: 1200, filters: NO_FILTERS }, 100, "poll"),
    ).resolves.toBeNull();
    const text = JSON.stringify(execute.mock.calls[0][0]);
    expect(text).toContain("::int IS NULL");
    expect(text).toContain("::timestamptz IS NULL");
  });

  it("poll mode includes the self-guard (self CTE + `me IN pair`)", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await tryPair({ userId: "me-99", elo: 1500, filters: NO_FILTERS }, 300, "poll");

    const text = JSON.stringify(execute.mock.calls[0][0]);
    // The non-locking self presence CTE ...
    expect(text).toContain("self AS");
    expect(text).toContain("EXISTS (SELECT 1 FROM self)");
    // ... and the "my own row must have been locked" gate on the delete.
    expect(text).toContain("IN (SELECT user_id FROM pair)");
    expect(text).toContain("me-99");
  });

  it("enqueue mode omits the self CTE (self is legitimately absent)", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await tryPair({ userId: "me-7", elo: 1100, filters: NO_FILTERS }, 100, "enqueue");

    const text = JSON.stringify(execute.mock.calls[0][0]);
    expect(text).not.toContain("self AS");
    expect(text).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("enqueue and poll share the identical overlap fragment", async () => {
    const filters: RaceProblemFilters = {
      ratingMin: 1100,
      ratingMax: 1700,
      dateFrom: "2024-01-01T00:00:00.000Z",
      dateTo: "2024-12-31T00:00:00.000Z",
    };
    execute.mockResolvedValueOnce({ rows: [] });
    await tryPair({ userId: "me", elo: 1200, filters }, 100, "enqueue");
    const enqueueText = JSON.stringify(execute.mock.calls[0][0]);

    execute.mockReset();
    execute.mockResolvedValueOnce({ rows: [] });
    await tryPair({ userId: "me", elo: 1200, filters }, 100, "poll");
    const pollText = JSON.stringify(execute.mock.calls[0][0]);

    const fragment = "rating_min IS NULL OR";
    const grab = (t: string) => t.slice(t.indexOf(fragment), t.indexOf(fragment) + 400);
    expect(grab(enqueueText)).toBe(grab(pollText));
  });
});
