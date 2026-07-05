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

  it("enqueue mode: returns the opponent id when the opponent row is deleted", async () => {
    execute.mockResolvedValueOnce({ rows: [{ user_id: "opp-1" }] });
    const matched = await tryPair({ userId: "me", elo: 1200 }, 100, "enqueue");
    expect(matched).toBe("opp-1");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("poll mode: returns the opponent id only when BOTH rows were deleted", async () => {
    execute.mockResolvedValueOnce({ rows: [{ user_id: "me" }, { user_id: "opp-1" }] });
    const matched = await tryPair({ userId: "me", elo: 1200 }, 100, "poll");
    expect(matched).toBe("opp-1");
  });

  it("poll mode: refuses a race when only the opponent row was deleted (self not locked)", async () => {
    // Simulates the 3+ concurrent-poller hole: our own row was already claimed
    // by another pairing, so it never made it into `pair`/`deleted`.
    execute.mockResolvedValueOnce({ rows: [{ user_id: "opp-1" }] });
    const matched = await tryPair({ userId: "me", elo: 1200 }, 100, "poll");
    expect(matched).toBeNull();
  });

  it("poll mode: returns null when nothing was deleted", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    const matched = await tryPair({ userId: "me", elo: 1200 }, 200, "poll");
    expect(matched).toBeNull();
  });

  it("tolerates a result without a rows array", async () => {
    execute.mockResolvedValueOnce({});
    const matched = await tryPair({ userId: "me", elo: 1200 }, 200, "enqueue");
    expect(matched).toBeNull();
  });

  it("issues a single locking statement with the caller's params", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await tryPair({ userId: "me-42", elo: 1337 }, 250, "enqueue");

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

  it("poll mode includes the self-guard (self CTE + `me IN pair`)", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await tryPair({ userId: "me-99", elo: 1500 }, 300, "poll");

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
    await tryPair({ userId: "me-7", elo: 1100 }, 100, "enqueue");

    const text = JSON.stringify(execute.mock.calls[0][0]);
    expect(text).not.toContain("self AS");
    expect(text).toContain("FOR UPDATE SKIP LOCKED");
  });
});
