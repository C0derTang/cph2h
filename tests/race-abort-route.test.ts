/**
 * Tests for src/app/api/races/[id]/abort/route.ts (issue #7, decline path #60).
 *
 * Mirrors tests/race-draw-route.test.ts: `requireLinkedUser` is mocked, `db`
 * is mocked at the `select().from().where().limit()` /
 * `update().set().where().returning()` call shapes the route uses, and
 * `buildRaceSnapshot` is mocked (its own DB fan-out is covered elsewhere) —
 * here we assert the route passes it the right race row and returns its
 * result verbatim. The abort route imports BOTH `finishRace` and
 * `publishRaceEvent` from `@/lib/race/hooks` (unlike the draw route, which
 * gets `publishRaceEvent` from `@/lib/livekit`), so that module is mocked
 * with both. The real (pure) guards from `@/lib/race/machine` run unmocked —
 * this is where the load-bearing "a stale decline must never forfeit a live
 * race" invariant is exercised.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Race } from "../src/lib/db/schema";
import type { SessionResult } from "../src/lib/race/session";
import type { RaceEvent } from "../src/lib/types";
import { _resetMemoryStore } from "../src/lib/ratelimit";

const {
  authMock,
  requireLinkedUserMock,
  updateSetMock,
  finishRaceMock,
  publishRaceEventMock,
  buildRaceSnapshotMock,
  dbState,
} = vi.hoisted(() => {
  const dbState = {
    selectResults: [] as unknown[][],
    selectIndex: 0,
    updateReturning: [] as unknown[],
  };
  return {
    authMock: vi.fn(),
    requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
    updateSetMock: vi.fn(),
    finishRaceMock: vi.fn().mockResolvedValue(undefined),
    publishRaceEventMock: vi.fn().mockResolvedValue(undefined),
    buildRaceSnapshotMock: vi.fn(async (race: Race) => ({
      __snapshotFor: race.id,
      status: race.status,
    })),
    dbState,
  };
});

vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));
vi.mock("@/lib/race/session", () => ({
  requireLinkedUser: requireLinkedUserMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(dbState.selectResults[dbState.selectIndex++] ?? []),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updateSetMock(table, values);
        return {
          where: () => ({
            returning: () => Promise.resolve(dbState.updateReturning),
          }),
        };
      },
    }),
  },
}));

vi.mock("@/lib/race/hooks", () => ({
  finishRace: finishRaceMock,
  publishRaceEvent: publishRaceEventMock,
}));
vi.mock("@/lib/race/snapshot", () => ({ buildRaceSnapshot: buildRaceSnapshotMock }));

import { POST } from "../src/app/api/races/[id]/abort/route";

const RACE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const P1 = "user-p1";
const P2 = "user-p2";
const OUTSIDER = "user-outsider";
const TOKEN = "tok-abc";

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: RACE_ID,
    status: "pending",
    challengeToken: TOKEN,
    p1Id: P1,
    p2Id: null,
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
    readyDeadlineAt: null,
    createdAt: null,
    ...overrides,
  };
}

function queueSelects(results: unknown[][]) {
  dbState.selectResults = results;
  dbState.selectIndex = 0;
}

function makeRequest(body?: unknown): Request {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost/api/races/${RACE_ID}/abort`, init);
}

const params = Promise.resolve({ id: RACE_ID });

function mockSessionAs(userId: string) {
  requireLinkedUserMock.mockResolvedValue({
    ok: true,
    user: {
      id: userId,
      clerkId: `clerk-${userId}`,
      username: userId,
      cfHandle: `${userId}cf`,
      cfRating: 1400,
      cfLinkedAt: new Date(),
      elo: 1200,
      racesPlayed: 3,
      cppTemplate: "",
      solveHistorySyncedAt: null,
      solveHistoryImportCursor: null,
      createdAt: null,
      isAdmin: false,
    },
  });
}

beforeEach(() => {
  _resetMemoryStore();
  authMock.mockReset().mockResolvedValue({ userId: "clerk-user-p1", isAuthenticated: true });
  requireLinkedUserMock.mockReset();
  updateSetMock.mockClear();
  finishRaceMock.mockClear();
  publishRaceEventMock.mockClear();
  buildRaceSnapshotMock.mockClear();
  dbState.selectResults = [];
  dbState.selectIndex = 0;
  dbState.updateReturning = [];

  mockSessionAs(P1);
});

describe("POST /api/races/[id]/abort — participant cancel/forfeit", () => {
  it("cancels a pending race with no body (Lobby cancel sends no body)", async () => {
    const race = makeRace({ status: "pending", p2Id: null });
    queueSelects([[race]]);
    dbState.updateReturning = [{ ...race, status: "aborted", outcome: "aborted" }];

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "aborted", outcome: "aborted" }),
    );
    expect(publishRaceEventMock).toHaveBeenCalledWith(RACE_ID, {
      type: "aborted",
      byUserId: P1,
    } satisfies RaceEvent);
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("cancels a ready race (opponent already joined)", async () => {
    const race = makeRace({ status: "ready", p2Id: P2 });
    queueSelects([[race]]);
    dbState.updateReturning = [{ ...race, status: "aborted", outcome: "aborted" }];

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "aborted", outcome: "aborted" }),
    );
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("forfeits an active race — opponent (p2) wins", async () => {
    const race = makeRace({ status: "active", p2Id: P2 });
    queueSelects([[race], [{ ...race, status: "finished", outcome: "p2_win" }]]);

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(finishRaceMock).toHaveBeenCalledWith({
      raceId: RACE_ID,
      outcome: "p2_win",
      winnerId: P2,
      reason: "forfeit",
    });
  });

  it("falls through to forfeit when the pending-abort's atomic claim loses the race", async () => {
    // Guard reads a pending race, but the race started (pending/ready -> active)
    // before the write — this pins the EXISTING abort behavior (not the new
    // decline path): a participant's lost claim still resolves as a forfeit.
    const race = makeRace({ status: "pending", p2Id: P2 });
    const nowActive = { ...race, status: "active" as const };
    queueSelects([[race], [{ ...nowActive, status: "finished", outcome: "p2_win" }]]);
    dbState.updateReturning = []; // lost the pending/ready -> aborted claim

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(finishRaceMock).toHaveBeenCalledWith({
      raceId: RACE_ID,
      outcome: "p2_win",
      winnerId: P2,
      reason: "forfeit",
    });
  });

  it("returns 409 already_finished when aborting an already-aborted race", async () => {
    queueSelects([[makeRace({ status: "aborted", p2Id: P2 })]]);

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_finished");
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    requireLinkedUserMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: "unauthorized",
    });

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(401);
  });

  it("returns 404 when the race does not exist", async () => {
    queueSelects([[]]);

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(404);
  });
});

describe("POST /api/races/[id]/abort — challenge-link decline", () => {
  it("lets a non-participant with a valid token decline a pending race", async () => {
    mockSessionAs(OUTSIDER);
    const race = makeRace({ status: "pending", challengeToken: TOKEN, p2Id: null });
    queueSelects([[race]]);
    dbState.updateReturning = [{ ...race, status: "aborted", outcome: "aborted" }];

    const res = await POST(makeRequest({ challengeToken: TOKEN }), { params });

    expect(res.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "aborted", outcome: "aborted" }),
    );
    expect(publishRaceEventMock).toHaveBeenCalledWith(RACE_ID, {
      type: "aborted",
      byUserId: OUTSIDER,
    } satisfies RaceEvent);
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong token with 403 invalid_token and no write", async () => {
    mockSessionAs(OUTSIDER);
    const race = makeRace({ status: "pending", challengeToken: TOKEN, p2Id: null });
    queueSelects([[race]]);

    const res = await POST(makeRequest({ challengeToken: "wrong-token" }), { params });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("invalid_token");
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("returns 409 not_pending + snapshot when the challenge is already ready (no forfeit)", async () => {
    mockSessionAs(OUTSIDER);
    const race = makeRace({ status: "ready", challengeToken: TOKEN, p2Id: P2 });
    queueSelects([[race]]);

    const res = await POST(makeRequest({ challengeToken: TOKEN }), { params });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("not_pending");
    expect(json.race).toEqual({ __snapshotFor: RACE_ID, status: "ready" });
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("TOCTOU: guard sees pending but the claim loses to a concurrent join+ready — 409, no forfeit", async () => {
    mockSessionAs(OUTSIDER);
    const race = makeRace({ status: "pending", challengeToken: TOKEN, p2Id: null });
    const nowReady = { ...race, status: "ready" as const, p2Id: P2 };
    queueSelects([[race], [nowReady]]);
    dbState.updateReturning = []; // lost the pending-only claim

    const res = await POST(makeRequest({ challengeToken: TOKEN }), { params });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("not_pending");
    expect(json.race).toEqual({ __snapshotFor: RACE_ID, status: "ready" });
    expect(finishRaceMock).not.toHaveBeenCalled();
    expect(publishRaceEventMock).not.toHaveBeenCalled();
  });
});
