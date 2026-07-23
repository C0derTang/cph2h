/**
 * Tests for src/lib/admin/ops.ts (issue #223).
 *
 * `mapRecentRace` is pure and tested directly. `getAdminOps` is tested
 * against a mocked `@/lib/db`, following the `db.select().from().where()...`
 * stub pattern used in tests/admin-reports.test.ts — generalized here so a
 * chain can be awaited at any point (`.from()`, `.where()`, or `.limit()`),
 * matching the different call shapes `ops.ts` uses (bare count query, count +
 * `.where()`, and the full `.where().orderBy().limit()` recent-races query).
 * The load-bearing bits: `Number()` coercion of Neon's string count results,
 * and that the recent-races query results feed a single batched user fetch.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Race, User } from "@/lib/db/schema";

const { dbState } = vi.hoisted(() => {
  const dbState = {
    selectResults: [] as unknown[][],
    selectIndex: 0,
  };
  return { dbState };
});

function nextResult(): unknown[] {
  return dbState.selectResults[dbState.selectIndex++] ?? [];
}

/**
 * A chain that stays unresolved (and doesn't touch `selectResults`) until
 * something actually awaits it — mirrors real drizzle builders, where
 * `.from()`/`.where()`/`.limit()` just build the query and execution only
 * happens at `await`/`.then()` time.
 */
function makeChain() {
  const resolveThenable = (
    resolve: (v: unknown) => void,
    reject?: (e: unknown) => void,
  ) => {
    try {
      resolve(nextResult());
    } catch (e) {
      reject?.(e);
    }
  };
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => ({ then: resolveThenable }),
    then: resolveThenable,
  };
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => makeChain(),
  },
}));

import { getAdminOps, mapRecentRace } from "@/lib/admin/ops";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    clerkId: "clerk-1",
    username: "tourist",
    cfHandle: "tourist_cf",
    cfRating: 3500,
    cfLinkedAt: new Date(),
    elo: 2400,
    racesPlayed: 10,
    cppTemplate: "",
    solveHistorySyncedAt: null,
    solveHistoryImportCursor: null,
    createdAt: null,
    isAdmin: false,
    ...overrides,
  };
}

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: "race-1",
    status: "finished",
    challengeToken: null,
    p1Id: "user-p1",
    p2Id: "user-p2",
    p1Ready: true,
    p2Ready: true,
    problemId: "1794C",
    timeLimitSec: 2400,
    ratingMin: null,
    ratingMax: null,
    problemDateFrom: null,
    problemDateTo: null,
    problemSelectionFailedReason: null,
    startedAt: new Date("2026-07-01T00:00:00.000Z"),
    endsAt: new Date("2026-07-01T00:40:00.000Z"),
    finishedAt: new Date("2026-07-01T00:05:00.000Z"),
    outcome: "p1_win",
    winnerId: "user-p1",
    winningSubmissionId: null,
    eloDeltaP1: 12,
    eloDeltaP2: -12,
    lastPolledAt: null,
    p1LastSeenAt: null,
    p2LastSeenAt: null,
    livekitRoom: "room-1",
    drawOfferBy: null,
    readyDeadlineAt: null,
    createdAt: new Date("2026-06-30T23:55:00.000Z"),
    ...overrides,
  };
}

// A clock well after every fixture timestamp, so started races expose their
// problemId. Individual tests override `startedAt` to probe the gate.
const NOW = new Date("2026-07-02T00:00:00.000Z");

beforeEach(() => {
  dbState.selectResults = [];
  dbState.selectIndex = 0;
});

describe("mapRecentRace", () => {
  it("maps a finished race row + batched users to a RecentRaceDTO (with settings)", () => {
    const race = makeRace({
      ratingMin: 800,
      ratingMax: 1600,
      problemDateFrom: new Date("2020-01-01T00:00:00.000Z"),
      problemDateTo: new Date("2021-01-01T00:00:00.000Z"),
      readyDeadlineAt: new Date("2026-06-30T23:57:00.000Z"),
    });
    const usersById = new Map([
      ["user-p1", makeUser({ id: "user-p1", username: "p1" })],
      ["user-p2", makeUser({ id: "user-p2", username: "p2" })],
    ]);

    expect(mapRecentRace(race, usersById, NOW)).toEqual({
      id: "race-1",
      status: "finished",
      p1: { id: "user-p1", username: "p1" },
      p2: { id: "user-p2", username: "p2" },
      outcome: "p1_win",
      winnerId: "user-p1",
      eloDeltaP1: 12,
      eloDeltaP2: -12,
      startedAt: "2026-07-01T00:00:00.000Z",
      finishedAt: "2026-07-01T00:05:00.000Z",
      createdAt: "2026-06-30T23:55:00.000Z",
      ratingMin: 800,
      ratingMax: 1600,
      problemDateFrom: "2020-01-01T00:00:00.000Z",
      problemDateTo: "2021-01-01T00:00:00.000Z",
      timeLimitSec: 2400,
      problemId: "1794C",
      readyDeadlineAt: "2026-06-30T23:57:00.000Z",
    });
  });

  it("maps p2 to null when there is no second player (queue not yet matched, shouldn't normally reach here, but defensive)", () => {
    const race = makeRace({ p2Id: null, outcome: null, status: "active" });
    const usersById = new Map([["user-p1", makeUser({ id: "user-p1", username: "p1" })]]);

    const dto = mapRecentRace(race, usersById, NOW);
    expect(dto.p2).toBeNull();
    expect(dto.status).toBe("active");
    expect(dto.outcome).toBeNull();
  });

  it("falls back to 'unknown' for a missing user row", () => {
    const race = makeRace();
    const usersById = new Map([["user-p1", makeUser({ id: "user-p1", username: "p1" })]]);
    // user-p2's row is deliberately missing.

    const dto = mapRecentRace(race, usersById, NOW);
    expect(dto.p1).toEqual({ id: "user-p1", username: "p1" });
    expect(dto.p2).toEqual({ id: "user-p2", username: "unknown" });
  });

  it("serializes null timestamps/settings as null", () => {
    const race = makeRace({
      startedAt: null,
      finishedAt: null,
      createdAt: null,
      problemDateFrom: null,
      problemDateTo: null,
      readyDeadlineAt: null,
    });
    const dto = mapRecentRace(race, new Map(), NOW);
    expect(dto.startedAt).toBeNull();
    expect(dto.finishedAt).toBeNull();
    expect(dto.createdAt).toBeNull();
    expect(dto.problemDateFrom).toBeNull();
    expect(dto.problemDateTo).toBeNull();
    expect(dto.readyDeadlineAt).toBeNull();
    // startedAt null → the race never started → problemId gated to null.
    expect(dto.problemId).toBeNull();
  });

  it("passes through outcome and elo deltas unchanged", () => {
    const race = makeRace({ outcome: "draw", eloDeltaP1: 0, eloDeltaP2: 0, winnerId: null });
    const dto = mapRecentRace(race, new Map(), NOW);
    expect(dto.outcome).toBe("draw");
    expect(dto.winnerId).toBeNull();
    expect(dto.eloDeltaP1).toBe(0);
    expect(dto.eloDeltaP2).toBe(0);
  });

  it("exposes problemId once the race has started (startedAt <= now)", () => {
    const race = makeRace({
      status: "active",
      startedAt: new Date("2026-07-01T00:00:00.000Z"),
      problemId: "1794C",
    });
    const dto = mapRecentRace(race, new Map(), NOW);
    expect(dto.problemId).toBe("1794C");
  });

  it("HIDES problemId during the pre-start countdown (startedAt in the future)", () => {
    // Countdown phase: status active but startedAt is 5s past `now` — the
    // never-leak-problem-before-start invariant means problemId must be null.
    const now = new Date("2026-07-01T00:00:00.000Z");
    const race = makeRace({
      status: "active",
      startedAt: new Date("2026-07-01T00:00:05.000Z"),
      problemId: "1794C",
    });
    const dto = mapRecentRace(race, new Map(), now);
    expect(dto.problemId).toBeNull();
  });

  it("maps pending/ready rows correctly (no problem, status passes through)", () => {
    for (const status of ["pending", "ready"] as const) {
      const race = makeRace({ status, startedAt: null, problemId: null, outcome: null, winnerId: null });
      const dto = mapRecentRace(race, new Map(), NOW);
      expect(dto.status).toBe(status);
      expect(dto.problemId).toBeNull();
      expect(dto.startedAt).toBeNull();
    }
  });
});

describe("getAdminOps", () => {
  it("coerces Neon's string counts to numbers", async () => {
    dbState.selectResults = [
      [{ count: "3" }], // queue depth
      [{ count: "1" }], // active races
      [], // recent races
    ];

    const result = await getAdminOps();

    expect(result.queueDepth).toBe(3);
    expect(result.activeRaces).toBe(1);
    expect(result.recentRaces).toEqual([]);
  });

  it("defaults counts to 0 when no row comes back", async () => {
    dbState.selectResults = [[], [], []];

    const result = await getAdminOps();

    expect(result.queueDepth).toBe(0);
    expect(result.activeRaces).toBe(0);
  });

  it("batch-fetches users for the recent races and maps them", async () => {
    const race1 = makeRace({ id: "race-1", p1Id: "u1", p2Id: "u2" });
    const race2 = makeRace({ id: "race-2", p1Id: "u1", p2Id: null, status: "active", outcome: null });
    const u1 = makeUser({ id: "u1", username: "alice" });
    const u2 = makeUser({ id: "u2", username: "bob" });

    dbState.selectResults = [
      [{ count: "0" }],
      [{ count: "1" }],
      [race1, race2],
      [u1, u2],
    ];

    const result = await getAdminOps();

    expect(result.recentRaces).toHaveLength(2);
    expect(result.recentRaces[0]).toMatchObject({ id: "race-1", p1: { id: "u1", username: "alice" }, p2: { id: "u2", username: "bob" } });
    expect(result.recentRaces[1]).toMatchObject({ id: "race-2", p1: { id: "u1", username: "alice" }, p2: null });
  });

  it("doesn't query users when there are no recent races", async () => {
    dbState.selectResults = [[{ count: "0" }], [{ count: "0" }], []];

    const result = await getAdminOps();

    expect(result.recentRaces).toEqual([]);
    // Only 3 result slots were queued (no users query); if ops.ts queried
    // users anyway it would consume a 4th slot and get `[]` back regardless,
    // so this is really just documenting the short-circuit — the meaningful
    // assertion is the empty recentRaces above plus no thrown error from
    // indexing past the end of a shorter results array.
    expect(dbState.selectIndex).toBe(3);
  });
});
