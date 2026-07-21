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
    whereClauses: [] as unknown[],
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
          return {
            where: (clause: unknown) => {
              dbState.whereClauses.push(clause);
              return makeQuery();
            },
          };
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
    p1LastSeenAt: null,
    p2LastSeenAt: null,
    ratingMin: null,
    ratingMax: null,
    problemDateFrom: null,
    problemDateTo: null,
    problemSelectionFailedReason: null,
    livekitRoom: "room-1",
    drawOfferBy: null,
    readyDeadlineAt: null,
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
    solveHistorySyncedAt: null,
    solveHistoryImportCursor: null,
    createdAt: null,
    isAdmin: false,
    ...overrides,
  };
}

beforeEach(() => {
  dbState.claimResult = [];
  dbState.userRows = [];
  dbState.updateCalls = [];
  dbState.whereClauses = [];
  dbState.insertCalls = [];
  dbState.batchCalls = [];
  dbState.selectCount = 0;
  publishMock.mockClear();
  deleteRoomMock.mockClear();
});

/**
 * Flatten a drizzle SQL claim into an ordered col/param sequence so the exact
 * WHERE predicate (columns AND the boolean flag values) can be asserted.
 */
function claimShape(
  node: unknown,
  out: Array<{ col?: string; param?: unknown }> = [],
): Array<{ col?: string; param?: unknown }> {
  if (!node || typeof node !== "object") return out;
  const n = node as Record<string, unknown>;
  if (Array.isArray(n.queryChunks)) {
    for (const chunk of n.queryChunks) claimShape(chunk, out);
  }
  if (n.name && n.table) out.push({ col: n.name as string });
  else if ("value" in n && n.encoder) out.push({ param: n.value });
  return out;
}

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
    // Issue #121 supersedes the #113/#114 teardown: the room is NOT deleted at
    // finish — both players stay on the call for post-race banter, and the
    // empty room self-destructs via its `emptyTimeout`.
    expect(deleteRoomMock).not.toHaveBeenCalled();
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

  it("never tears down the room at finish (issue #121): publishes then returns", async () => {
    dbState.claimResult = [makeRace({ winnerId: "user-p1", outcome: "p1_win" })];
    dbState.userRows = [
      makeUser({ id: "user-p1", elo: 1200, racesPlayed: 0 }),
      makeUser({ id: "user-p2", elo: 1200, racesPlayed: 0 }),
    ];

    await finishRace({
      raceId: RACE_ID,
      outcome: "p1_win",
      winnerId: "user-p1",
      reason: "solved",
    });

    // The finish event is still published exactly once...
    expect(publishMock).toHaveBeenCalledTimes(1);
    // ...but the room is left alive for the post-race call (no deleteRoom, and
    // no teardown-delay plumbing remains on finishRace).
    expect(deleteRoomMock).not.toHaveBeenCalled();
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

describe("finishRace — ready-deadline walkover (issue #275)", () => {
  it("default (no readyWalkover) claims active->finished: WHERE is id + status='active' only", async () => {
    dbState.claimResult = [];
    await finishRace({
      raceId: RACE_ID,
      outcome: "p1_win",
      winnerId: "user-p1",
      reason: "solved",
    });

    // The active-path claim references only id and status — byte-identical to
    // the pre-#275 behavior. No ready_deadline_at / ready-flag pins.
    const shape = claimShape(dbState.whereClauses[0]);
    const cols = shape.filter((s) => s.col).map((s) => s.col);
    expect(cols).toEqual(["id", "status"]);
    const statusIdx = shape.findIndex((s) => s.col === "status");
    expect(shape[statusIdx + 1]).toEqual({ param: "active" });
  });

  it("walkover claim flips ready->finished pinning deadline + EXACT ready flags (p1)", async () => {
    dbState.claimResult = [
      makeRace({
        status: "finished",
        winnerId: "user-p1",
        outcome: "p1_win",
        p1Ready: true,
        p2Ready: false,
        startedAt: null,
        readyDeadlineAt: new Date("2024-01-01T00:00:00Z"),
      }),
    ];
    dbState.userRows = [
      makeUser({ id: "user-p1", elo: 1200, racesPlayed: 0 }),
      makeUser({ id: "user-p2", elo: 1200, racesPlayed: 0 }),
    ];

    await finishRace({
      raceId: RACE_ID,
      outcome: "p1_win",
      winnerId: "user-p1",
      reason: "ready_timeout",
      readyWalkover: { readySide: "p1" },
    });

    const shape = claimShape(dbState.whereClauses[0]);
    const cols = shape.filter((s) => s.col).map((s) => s.col);
    // status='ready' (not 'active'), the deadline guard, and BOTH ready flags.
    expect(cols).toContain("status");
    expect(cols).toContain("ready_deadline_at");
    expect(cols).toContain("p1_ready");
    expect(cols).toContain("p2_ready");
    const statusIdx = shape.findIndex((s) => s.col === "status");
    expect(shape[statusIdx + 1]).toEqual({ param: "ready" });
    // Exact-flag pin (NOT a bare XOR): readySide 'p1' ⇒ p1_ready=true, p2_ready=false.
    const p1Idx = shape.findIndex((s) => s.col === "p1_ready");
    const p2Idx = shape.findIndex((s) => s.col === "p2_ready");
    expect(shape[p1Idx + 1]).toEqual({ param: true });
    expect(shape[p2Idx + 1]).toEqual({ param: false });

    // The SET marks it finished; startedAt is left untouched (stays null — the
    // client's walkover discriminator). Full Elo is applied exactly once.
    expect(dbState.updateCalls[0].values).toMatchObject({
      status: "finished",
      outcome: "p1_win",
      winnerId: "user-p1",
    });
    expect(dbState.updateCalls[0].values).not.toHaveProperty("startedAt");
    expect(dbState.batchCalls).toHaveLength(1);
    expect(dbState.updateCalls[3].values).toEqual({ eloDeltaP1: 32, eloDeltaP2: -32 });
    expect(publishMock).toHaveBeenCalledWith(
      "room-1",
      expect.objectContaining({ type: "race_finished", outcome: "p1_win" }),
    );
  });

  it("walkover pins the EXACT flags for readySide 'p2' (p1_ready=false, p2_ready=true)", async () => {
    dbState.claimResult = [];
    await finishRace({
      raceId: RACE_ID,
      outcome: "p2_win",
      winnerId: "user-p2",
      reason: "ready_timeout",
      readyWalkover: { readySide: "p2" },
    });

    const shape = claimShape(dbState.whereClauses[0]);
    const p1Idx = shape.findIndex((s) => s.col === "p1_ready");
    const p2Idx = shape.findIndex((s) => s.col === "p2_ready");
    expect(shape[p1Idx + 1]).toEqual({ param: false });
    expect(shape[p2Idx + 1]).toEqual({ param: true });
  });

  it("a lost/second walkover claim applies no Elo and publishes nothing", async () => {
    dbState.claimResult = []; // flags churned or already resolved

    await finishRace({
      raceId: RACE_ID,
      outcome: "p1_win",
      winnerId: "user-p1",
      reason: "ready_timeout",
      readyWalkover: { readySide: "p1" },
    });

    expect(dbState.updateCalls).toHaveLength(1); // only the claim
    expect(dbState.batchCalls).toHaveLength(0);
    expect(dbState.insertCalls).toHaveLength(0);
    expect(publishMock).not.toHaveBeenCalled();
  });
});
