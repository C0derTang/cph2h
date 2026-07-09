/**
 * Tests for src/lib/cf/rating-refresh.ts — the daily CF-rating refresh run
 * from the sweep cron. Covers: only-changed rows are written, unchanged and
 * absent handles are left alone, and a CF-level batch failure falls back to
 * per-handle lookups so one bad handle doesn't sink the rest.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectWhereMock, updateWhereMock, getUserInfoMock } = vi.hoisted(() => ({
  selectWhereMock: vi.fn(),
  updateWhereMock: vi.fn((_call?: { id: string; value: unknown }) => Promise.resolve()),
  getUserInfoMock: vi.fn(),
}));

// Capture the update target id via a stubbed `eq` (real drizzle SQL objects
// aren't introspectable). isNotNull is irrelevant to the assertions.
vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, val: unknown) => ({ __id: val }),
  isNotNull: () => ({ __isNotNull: true }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: selectWhereMock }) }),
    update: () => ({ set: (value: unknown) => ({ where: (cond: { __id: string }) => updateWhereMock({ id: cond.__id, value }) }) }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "users.id", cfHandle: "users.cf_handle", cfRating: "users.cf_rating" },
}));

vi.mock("@/lib/cf/client", () => {
  class CfApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CfApiError";
    }
  }
  return { CfApiError, getUserInfo: getUserInfoMock };
});

import { refreshCfRatings } from "../src/lib/cf/rating-refresh";
import { CfApiError } from "../src/lib/cf/client";

beforeEach(() => {
  vi.clearAllMocks();
  updateWhereMock.mockImplementation(() => Promise.resolve());
});

describe("refreshCfRatings", () => {
  it("updates only rows whose rating changed and reports counts", async () => {
    selectWhereMock.mockResolvedValue([
      { id: "user-1", cfHandle: "Alice", cfRating: 1500 },
      { id: "user-2", cfHandle: "bob", cfRating: null },
      { id: "user-3", cfHandle: "carol", cfRating: 1200 },
    ]);
    getUserInfoMock.mockResolvedValue([
      { handle: "alice", rating: 1600 }, // changed 1500 -> 1600
      { handle: "Bob", rating: 1300 }, // changed null -> 1300 (case-insensitive match)
      { handle: "carol", rating: 1200 }, // unchanged
    ]);

    const result = await refreshCfRatings();

    // One batched call for all three handles.
    expect(getUserInfoMock).toHaveBeenCalledTimes(1);
    expect(getUserInfoMock).toHaveBeenCalledWith("Alice;bob;carol");

    // Only the two changed rows written.
    expect(updateWhereMock).toHaveBeenCalledTimes(2);
    expect(updateWhereMock).toHaveBeenCalledWith({ id: "user-1", value: { cfRating: 1600 } });
    expect(updateWhereMock).toHaveBeenCalledWith({ id: "user-2", value: { cfRating: 1300 } });

    expect(result).toEqual({ checked: 3, updated: 2, failed: 0 });
  });

  it("no-ops with zero counts when no handles are linked", async () => {
    selectWhereMock.mockResolvedValue([]);

    const result = await refreshCfRatings();

    expect(getUserInfoMock).not.toHaveBeenCalled();
    expect(updateWhereMock).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, updated: 0, failed: 0 });
  });

  it("counts an unrated handle (no rating field) without writing", async () => {
    selectWhereMock.mockResolvedValue([
      { id: "user-1", cfHandle: "newbie", cfRating: null },
    ]);
    getUserInfoMock.mockResolvedValue([{ handle: "newbie" }]); // never rated -> undefined

    const result = await refreshCfRatings();

    // null === (undefined ?? null) -> unchanged, no write.
    expect(updateWhereMock).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, updated: 0, failed: 0 });
  });

  it("falls back to per-handle lookups when a batch fails, isolating the bad handle", async () => {
    selectWhereMock.mockResolvedValue([
      { id: "user-1", cfHandle: "good", cfRating: 1400 },
      { id: "user-2", cfHandle: "ghost", cfRating: 1100 },
    ]);
    getUserInfoMock.mockImplementation((handles: string) => {
      if (handles === "good;ghost") throw new CfApiError("handles: User ghost not found");
      if (handles === "good") return Promise.resolve([{ handle: "good", rating: 1450 }]);
      throw new CfApiError("handles: User ghost not found");
    });

    const result = await refreshCfRatings();

    // Batch, then two per-handle retries.
    expect(getUserInfoMock).toHaveBeenCalledTimes(3);
    expect(updateWhereMock).toHaveBeenCalledTimes(1);
    expect(updateWhereMock).toHaveBeenCalledWith({ id: "user-1", value: { cfRating: 1450 } });
    expect(result).toEqual({ checked: 2, updated: 1, failed: 1 });
  });
});
