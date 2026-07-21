/**
 * Tests for the matchmade ready-deadline resolution (issue #275):
 *  - the pure decision `readyTimeoutAction` (src/lib/race/machine.ts), and
 *  - the resolver `resolveReadyTimeout` (src/lib/race/ready-timeout.ts).
 *
 * The pure table exhaustively covers before/at/after the deadline × ready-flag
 * combos × null-deadline (challenge) × non-ready statuses. The resolver runs
 * against a mocked db (abort claim shape captured from the real drizzle SQL) and
 * mocked finishRace/publishRaceEvent (walkover delegation asserted).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Race } from "../src/lib/db/schema";
import type { RaceStatus } from "../src/lib/types";
import { readyTimeoutAction } from "../src/lib/race/machine";

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const RACE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const DEADLINE = new Date("2024-01-01T00:02:00Z");
const BEFORE = new Date("2024-01-01T00:01:59Z");
const AFTER = new Date("2024-01-01T00:02:01Z");

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: RACE_ID,
    status: "ready",
    challengeToken: null,
    p1Id: P1,
    p2Id: P2,
    p1Ready: false,
    p2Ready: false,
    problemId: null,
    timeLimitSec: 2400,
    startedAt: null,
    endsAt: null,
    finishedAt: null,
    outcome: null,
    winnerId: null,
    winningSubmissionId: null,
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
    readyDeadlineAt: DEADLINE,
    createdAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure decision
// ---------------------------------------------------------------------------

describe("readyTimeoutAction (pure)", () => {
  it("challenge races (null deadline) are NEVER resolved by the timeout", () => {
    const combos: Array<Partial<Race>> = [
      { p1Ready: false, p2Ready: false },
      { p1Ready: true, p2Ready: false },
      { p1Ready: false, p2Ready: true },
      { p1Ready: true, p2Ready: true },
    ];
    for (const combo of combos) {
      const race = makeRace({ readyDeadlineAt: null, ...combo });
      expect(readyTimeoutAction(race, AFTER)).toEqual({ kind: "none" });
    }
  });

  it("non-ready statuses are never resolved, even past a (stale) deadline", () => {
    const statuses: RaceStatus[] = ["pending", "active", "finished", "aborted"];
    for (const status of statuses) {
      const race = makeRace({ status, p1Ready: true, p2Ready: false });
      expect(readyTimeoutAction(race, AFTER)).toEqual({ kind: "none" });
    }
  });

  it("before the deadline: none, regardless of flags", () => {
    expect(readyTimeoutAction(makeRace({ p1Ready: true }), BEFORE)).toEqual({
      kind: "none",
    });
    expect(readyTimeoutAction(makeRace(), BEFORE)).toEqual({ kind: "none" });
  });

  it("exactly AT the deadline: none (strict > required)", () => {
    // now === deadline must not fire — resolution requires now > deadline.
    expect(readyTimeoutAction(makeRace({ p1Ready: true }), DEADLINE)).toEqual({
      kind: "none",
    });
  });

  it("after the deadline, both ready: none (a start is in flight)", () => {
    const race = makeRace({ p1Ready: true, p2Ready: true });
    expect(readyTimeoutAction(race, AFTER)).toEqual({ kind: "none" });
  });

  it("after the deadline, neither ready: abort", () => {
    const race = makeRace({ p1Ready: false, p2Ready: false });
    expect(readyTimeoutAction(race, AFTER)).toEqual({ kind: "abort" });
  });

  it("after the deadline, only p1 ready: walkover p1_win pinned to p1", () => {
    const race = makeRace({ p1Ready: true, p2Ready: false });
    expect(readyTimeoutAction(race, AFTER)).toEqual({
      kind: "walkover",
      outcome: "p1_win",
      winnerId: P1,
      readySide: "p1",
    });
  });

  it("after the deadline, only p2 ready: walkover p2_win pinned to p2", () => {
    const race = makeRace({ p1Ready: false, p2Ready: true });
    expect(readyTimeoutAction(race, AFTER)).toEqual({
      kind: "walkover",
      outcome: "p2_win",
      winnerId: P2,
      readySide: "p2",
    });
  });

  it("degenerate: p2 ready but p2Id null yields none (no winner to award)", () => {
    const race = makeRace({ p1Ready: false, p2Ready: true, p2Id: null });
    expect(readyTimeoutAction(race, AFTER)).toEqual({ kind: "none" });
  });
});

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

const { dbState, finishRaceMock, publishRaceEventMock } = vi.hoisted(() => {
  const dbState = {
    abortResult: [] as unknown[],
    updateSet: null as Record<string, unknown> | null,
    updateWhere: undefined as unknown,
    updateCount: 0,
  };
  return {
    dbState,
    finishRaceMock: vi.fn().mockResolvedValue(undefined),
    publishRaceEventMock: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        dbState.updateSet = values;
        dbState.updateCount++;
        return {
          where: (clause: unknown) => {
            dbState.updateWhere = clause;
            return { returning: () => Promise.resolve(dbState.abortResult) };
          },
        };
      },
    }),
  },
}));

vi.mock("@/lib/race/finish", () => ({ finishRace: finishRaceMock }));
vi.mock("@/lib/race/hooks", () => ({ publishRaceEvent: publishRaceEventMock }));

const { resolveReadyTimeout } = await import("../src/lib/race/ready-timeout");

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

beforeEach(() => {
  dbState.abortResult = [];
  dbState.updateSet = null;
  dbState.updateWhere = undefined;
  dbState.updateCount = 0;
  finishRaceMock.mockClear();
  publishRaceEventMock.mockClear();
});

describe("resolveReadyTimeout — none", () => {
  it("does nothing for a challenge race (null deadline)", async () => {
    await resolveReadyTimeout(makeRace({ readyDeadlineAt: null }), AFTER);
    expect(dbState.updateCount).toBe(0);
    expect(finishRaceMock).not.toHaveBeenCalled();
    expect(publishRaceEventMock).not.toHaveBeenCalled();
  });

  it("does nothing before the deadline", async () => {
    await resolveReadyTimeout(makeRace({ p1Ready: true }), BEFORE);
    expect(dbState.updateCount).toBe(0);
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("does nothing when both are ready (start in flight)", async () => {
    await resolveReadyTimeout(makeRace({ p1Ready: true, p2Ready: true }), AFTER);
    expect(dbState.updateCount).toBe(0);
    expect(finishRaceMock).not.toHaveBeenCalled();
  });
});

describe("resolveReadyTimeout — abort (neither ready)", () => {
  it("claims ready->aborted pinning deadline + both flags clear, then publishes", async () => {
    const race = makeRace({ p1Ready: false, p2Ready: false });
    dbState.abortResult = [{ ...race, status: "aborted", outcome: "aborted", p1Id: P1 }];

    await resolveReadyTimeout(race, AFTER);

    // SET: aborted outcome, no Elo, no winner.
    expect(dbState.updateSet).toMatchObject({
      status: "aborted",
      outcome: "aborted",
    });
    expect(dbState.updateSet).not.toHaveProperty("winnerId");

    // WHERE: id, status='ready', ready_deadline_at IS NOT NULL AND < now(),
    // p1_ready=false, p2_ready=false (exact-flag pin, not a bare XOR).
    const shape = claimShape(dbState.updateWhere);
    const cols = shape.filter((s) => s.col).map((s) => s.col);
    expect(cols).toContain("status");
    expect(cols).toContain("ready_deadline_at");
    expect(cols).toContain("p1_ready");
    expect(cols).toContain("p2_ready");
    // The flag params immediately follow their columns: both pinned to false.
    const p1Idx = shape.findIndex((s) => s.col === "p1_ready");
    const p2Idx = shape.findIndex((s) => s.col === "p2_ready");
    expect(shape[p1Idx + 1]).toEqual({ param: false });
    expect(shape[p2Idx + 1]).toEqual({ param: false });

    // Abort applies NO Elo (never funnels through finishRace).
    expect(finishRaceMock).not.toHaveBeenCalled();
    // System abort: hint published, byUserId stamped as the challenger p1.
    expect(publishRaceEventMock).toHaveBeenCalledWith(RACE_ID, {
      type: "aborted",
      byUserId: P1,
    });
  });

  it("lost claim (zero rows) is a silent no-op: no publish", async () => {
    dbState.abortResult = []; // someone else resolved it first
    await resolveReadyTimeout(makeRace(), AFTER);
    expect(finishRaceMock).not.toHaveBeenCalled();
    expect(publishRaceEventMock).not.toHaveBeenCalled();
  });
});

describe("resolveReadyTimeout — walkover (one ready)", () => {
  it("delegates a p1 walkover to finishRace with readyWalkover + reason, no direct write", async () => {
    const race = makeRace({ p1Ready: true, p2Ready: false });

    await resolveReadyTimeout(race, AFTER);

    expect(finishRaceMock).toHaveBeenCalledTimes(1);
    expect(finishRaceMock).toHaveBeenCalledWith({
      raceId: RACE_ID,
      outcome: "p1_win",
      winnerId: P1,
      reason: "ready_timeout",
      readyWalkover: { readySide: "p1" },
    });
    // The resolver never writes the abort/finish itself — finishRace owns it.
    expect(dbState.updateCount).toBe(0);
    expect(publishRaceEventMock).not.toHaveBeenCalled();
  });

  it("delegates a p2 walkover to finishRace pinned to p2", async () => {
    const race = makeRace({ p1Ready: false, p2Ready: true });

    await resolveReadyTimeout(race, AFTER);

    expect(finishRaceMock).toHaveBeenCalledWith({
      raceId: RACE_ID,
      outcome: "p2_win",
      winnerId: P2,
      reason: "ready_timeout",
      readyWalkover: { readySide: "p2" },
    });
  });
});
