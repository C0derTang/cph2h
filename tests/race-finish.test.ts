/**
 * Tests for src/lib/race/finish.ts — Elo application + idempotency.
 *
 * The DB is mocked so we can drive the atomic claim result directly:
 *  - claim returns a row  ⇒ this call owns the finish (applies Elo).
 *  - claim returns []     ⇒ already finished ⇒ no-op (no Elo, no publish).
 * Elo math itself is the real `applyResult`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SQL } from "drizzle-orm";
import type { Race, User } from "../src/lib/db/schema";

const { dbState, publishMock, deleteRoomMock } = vi.hoisted(() => {
  const dbState = {
    claimResult: [] as unknown[],
    userRows: [] as unknown[],
    updateCalls: [] as { table: unknown; values: Record<string, unknown> }[],
    insertCalls: [] as { table: unknown; values: unknown }[],
    batchCalls: [] as unknown[][],
    selectCount: 0,
  };
  const publishMock = vi.fn().mockResolvedValue(undefined);
  const deleteRoomMock = vi.fn().mockResolvedValue(undefined);
  return { dbState, publishMock, deleteRoomMock };
});

vi.mock("@/lib/db", () => {
  // A query stub: recorded at build time (via set()/values()); usable both as a
  // batch item and as the claim's `.where().returning()` chain.
  const makeQuery = () => ({
    returning: () => Promise.resolve(dbState.claimResult),
  });
  return {
    db: {
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          dbState.updateCalls.push({ table, values });
          return { where: () => makeQuery() };
        },
      }),
      select: () => ({
        from: () => ({
          where: () => {
            dbState.selectCount++;
            return Promise.resolve(dbState.userRows);
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          dbState.insertCalls.push({ table, values });
          return makeQuery();
        },
      }),
      batch: (queries: unknown[]) => {
        dbState.batchCalls.push(queries);
        return Promise.resolve([]);
      },
    },
  };
});

vi.mock("@/lib/livekit", () => ({
  publishRaceEvent: publishMock,
  deleteRoom: deleteRoomMock,
}));

import { finishRace } from "../src/lib/race/finish";

const RACE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: RACE_ID,
    status: "finished",
    challengeToken: null,
    p1Id: "user-p1",
    p2Id: "user-p2",
    p1Ready: true,
    p2Ready: true,
    problemId: "1794C",
    timeLimitSec: 2400,
    startedAt: new Date("2024-01-01T00:00:00Z"),
    endsAt: new Date("2024-01-01T00:40:00Z"),
    finishedAt: new Date("2024-01-01T00:20:00Z"),
    outcome: "p1_win",
    winnerId: "user-p1",
    winningSubmissionId: 42,
    eloDeltaP1: null,
    eloDeltaP2: null,
    lastPolledAt: null,
    livekitRoom: "room-1",
    drawOfferBy: null,
    createdAt: null,
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-p1",
    clerkId: "clerk-p1",
    username: "p1",
    cfHandle: "p1cf",
    cfRating: 1200,
    cfLinkedAt: new Date(),
    elo: 1200,
    racesPlayed: 0,
    cppTemplate: "",
    createdAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  dbState.claimResult = [];
  dbState.userRows = [];
  dbState.updateCalls = [];
  dbState.insertCalls = [];
  dbState.batchCalls = [];
  dbState.selectCount = 0;
  publishMock.mockClear();
  deleteRoomMock.mockClear();
});

describe("finishRace", () => {
  it("applies Elo on a p1 win: updates both users, writes 2 history rows, sets deltas", async () => {
    dbState.claimResult = [makeRace({ winnerId: "user-p1", outcome: "p1_win" })];
    dbState.userRows = [
      makeUser({ id: "user-p1", elo: 1200, racesPlayed: 0 }),
      makeUser({ id: "user-p2", elo: 1200, racesPlayed: 0 }),
    ];

    await finishRace({
      raceId: RACE_ID,
      outcome: "p1_win",
      winnerId: "user-p1",
      winningSubmissionId: 42,
      reason: "solved",
    });

    // updateCalls: [0] claim, [1] p1 user, [2] p2 user, [3] race deltas.
    expect(dbState.updateCalls[0].values).toMatchObject({
      status: "finished",
      outcome: "p1_win",
      winnerId: "user-p1",
      winningSubmissionId: 42,
    });
    // User Elo/racesPlayed use atomic SQL increments, not absolute values, so
    // concurrent finishes sharing a player can't lose an update.
    expect(dbState.updateCalls[1].values.elo).toBeInstanceOf(SQL);
    expect(dbState.updateCalls[1].values.racesPlayed).toBeInstanceOf(SQL);
    expect(dbState.updateCalls[2].values.elo).toBeInstanceOf(SQL);
    expect(dbState.updateCalls[2].values.racesPlayed).toBeInstanceOf(SQL);
    // Provisional K=64, equal ratings ⇒ +32 / -32.
    expect(dbState.updateCalls[3].values).toEqual({
      eloDeltaP1: 32,
      eloDeltaP2: -32,
    });

    // The post-claim writes are one atomic batch: 2 user updates + history
    // insert + race-delta update.
    expect(dbState.batchCalls).toHaveLength(1);
    expect(dbState.batchCalls[0]).toHaveLength(4);

    // Two elo_history rows in one insert.
    expect(dbState.insertCalls).toHaveLength(1);
    const rows = dbState.insertCalls[0].values as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      userId: "user-p1",
      eloBefore: 1200,
      eloAfter: 1232,
      delta: 32,
    });
    expect(rows[1]).toMatchObject({
      userId: "user-p2",
      eloBefore: 1200,
      eloAfter: 1168,
      delta: -32,
    });

    // race_finished event carries the per-user deltas.
    expect(publishMock).toHaveBeenCalledWith("room-1", {
      type: "race_finished",
      outcome: "p1_win",
      winnerId: "user-p1",
      eloDeltas: { "user-p1": 32, "user-p2": -32 },
    });
    expect(deleteRoomMock).toHaveBeenCalledWith("room-1");
  });

  it("applies a symmetric draw (0/0 at equal ratings)", async () => {
    dbState.claimResult = [makeRace({ outcome: "draw", winnerId: null })];
    dbState.userRows = [
      makeUser({ id: "user-p1", elo: 1200, racesPlayed: 0 }),
      makeUser({ id: "user-p2", elo: 1200, racesPlayed: 0 }),
    ];

    await finishRace({
      raceId: RACE_ID,
      outcome: "draw",
      winnerId: null,
      reason: "timeout",
    });

    expect(dbState.updateCalls[3].values).toEqual({
      eloDeltaP1: 0,
      eloDeltaP2: 0,
    });
    expect(publishMock).toHaveBeenCalledWith(
      "room-1",
      expect.objectContaining({
        type: "race_finished",
        outcome: "draw",
        eloDeltas: { "user-p1": 0, "user-p2": 0 },
      }),
    );
  });

  it("is idempotent: a lost/second claim applies no Elo and publishes nothing", async () => {
    dbState.claimResult = []; // race already finished by someone else.

    await finishRace({
      raceId: RACE_ID,
      outcome: "p1_win",
      winnerId: "user-p1",
      reason: "solved",
    });

    // Only the claim update ran; no batch, no user/history/delta writes, no publish.
    expect(dbState.updateCalls).toHaveLength(1);
    expect(dbState.batchCalls).toHaveLength(0);
    expect(dbState.insertCalls).toHaveLength(0);
    expect(dbState.selectCount).toBe(0);
    expect(publishMock).not.toHaveBeenCalled();
    expect(deleteRoomMock).not.toHaveBeenCalled();
  });
});
