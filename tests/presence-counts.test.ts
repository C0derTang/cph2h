/**
 * Tests for src/lib/presence-counts.ts — the queue page's queued/playing
 * counters. Verifies distinct counting across both players of active races
 * (with a null p2), and that `queued` counts only fresh queue rows (it is
 * not unioned with active-race participants).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { racesWhereMock, queueWhereMock } = vi.hoisted(() => ({
  racesWhereMock: vi.fn(),
  queueWhereMock: vi.fn(),
}));

// Conditions are irrelevant to the assertions — stub the query builders.
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: () => ({}),
  gt: () => ({}),
  isNull: () => ({}),
  or: (...a: unknown[]) => a,
  sql: () => ({}),
}));

vi.mock("@/lib/db/schema", () => ({
  races: { __table: "races", p1Id: "p1", p2Id: "p2", status: "status", endsAt: "endsAt" },
  queueEntries: { __table: "queue", userId: "userId", enqueuedAt: "enqueuedAt" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __table: string }) => ({
        where: table.__table === "races" ? racesWhereMock : queueWhereMock,
      }),
    }),
  },
}));

import { getPresenceCounts } from "../src/lib/presence-counts";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPresenceCounts", () => {
  it("counts distinct players and fresh queue rows independently", async () => {
    racesWhereMock.mockResolvedValue([
      { p1: "a", p2: "b" },
      { p1: "c", p2: null }, // solo/abandoned side — p2 null must not throw or count
    ]);
    queueWhereMock.mockResolvedValue([
      { userId: "d" },
      { userId: "e" },
    ]);

    const result = await getPresenceCounts();

    // playing = {a,b,c} ; queued = {d,e}
    expect(result).toEqual({ queued: 2, playing: 3 });
  });

  it("returns zeros when nobody is racing or queued", async () => {
    racesWhereMock.mockResolvedValue([]);
    queueWhereMock.mockResolvedValue([]);

    const result = await getPresenceCounts();

    expect(result).toEqual({ queued: 0, playing: 0 });
  });

  it("counts queued-only users with zero playing", async () => {
    racesWhereMock.mockResolvedValue([]);
    queueWhereMock.mockResolvedValue([{ userId: "x" }, { userId: "y" }]);

    const result = await getPresenceCounts();

    expect(result).toEqual({ queued: 2, playing: 0 });
  });
});
