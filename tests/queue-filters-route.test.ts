/**
 * Route tests for filter-aware matchmaking on /api/queue
 * (src/app/api/queue/route.ts), issue #274. The session, pairing, race
 * creation, problem-availability count, and db are mocked so the route's own
 * gating and persistence are exercised in isolation. `intersectFilters` and
 * `bandForWait` are kept REAL (via importOriginal) so the intersection written
 * to a matchmade race is verified end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionResult } from "../src/lib/race/session";
import { _resetMemoryStore } from "../src/lib/ratelimit";

const H = vi.hoisted(() => ({
  state: { selectResult: [] as unknown[] },
  authMock: vi.fn(),
  requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
  tryPairMock: vi.fn(),
  createRaceMock: vi.fn(),
  countAvailMock: vi.fn(),
  insertValuesSpy: vi.fn(),
  onConflictSpy: vi.fn(),
  updateSetSpy: vi.fn(),
  updateWhereSpy: vi.fn(),
  deleteWhereSpy: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: H.authMock }));
vi.mock("@/lib/race/session", () => ({ requireLinkedUser: H.requireLinkedUserMock }));
vi.mock("@/lib/race/create", () => ({
  createRace: H.createRaceMock,
  generateChallengeToken: vi.fn(),
}));
vi.mock("@/lib/matchmaking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/matchmaking")>();
  return { ...actual, tryPair: H.tryPairMock };
});
vi.mock("@/lib/cf/cheaters", () => ({
  getCheaterSet: vi.fn().mockResolvedValue(new Set()),
  isKnownCheater: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/cf/problem-availability", () => ({
  countAvailableProblems: H.countAvailMock,
}));
vi.mock("@/lib/db", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(H.state.selectResult),
  };
  return {
    db: {
      select: () => chain,
      insert: () => ({
        values: (v: unknown) => {
          H.insertValuesSpy(v);
          return {
            onConflictDoUpdate: (a: unknown) => {
              H.onConflictSpy(a);
              return Promise.resolve();
            },
          };
        },
      }),
      update: () => ({
        set: (v: unknown) => {
          H.updateSetSpy(v);
          return {
            where: (w: unknown) => {
              H.updateWhereSpy(w);
              return Promise.resolve();
            },
          };
        },
      }),
      delete: () => ({
        where: (w: unknown) => {
          H.deleteWhereSpy(w);
          return Promise.resolve();
        },
      }),
    },
  };
});

import { POST, GET } from "../src/app/api/queue/route";

function mockSession() {
  H.requireLinkedUserMock.mockResolvedValue({
    ok: true,
    user: {
      id: "user-1",
      clerkId: "clerk-1",
      username: "me",
      cfHandle: "mecf",
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

function postReq(body?: unknown): Request {
  return new Request("http://localhost/api/queue", {
    method: "POST",
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
}

function getReq(): Request {
  return new Request("http://localhost/api/queue", { method: "GET" });
}

function queueEntry(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    elo: 1200,
    enqueuedAt: new Date(Date.now() - 5000),
    ratingMin: null,
    ratingMax: null,
    dateFrom: null,
    dateTo: null,
    lastSeenAt: new Date(Date.now() - 5000),
    ...overrides,
  };
}

beforeEach(() => {
  _resetMemoryStore();
  H.state.selectResult = [];
  H.authMock.mockReset().mockResolvedValue({ userId: "clerk-1", isAuthenticated: true });
  H.requireLinkedUserMock.mockReset();
  H.tryPairMock.mockReset().mockResolvedValue(null);
  H.createRaceMock.mockReset().mockResolvedValue({ id: "race-new" });
  H.countAvailMock.mockReset().mockResolvedValue(5);
  H.insertValuesSpy.mockReset();
  H.onConflictSpy.mockReset();
  H.updateSetSpy.mockReset();
  H.updateWhereSpy.mockReset();
  H.deleteWhereSpy.mockReset();
  mockSession();
});

describe("POST /api/queue — single-instance guard", () => {
  it("returns 409 already_in_race (with raceId) and never pairs when already in a race", async () => {
    H.state.selectResult = [{ id: "race-x" }];

    const res = await POST(postReq());

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("already_in_race");
    expect(body.raceId).toBe("race-x");
    expect(H.tryPairMock).not.toHaveBeenCalled();
    expect(H.insertValuesSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/queue — filter validation & availability", () => {
  it("returns 400 invalid_body on an invalid filter (rating not a multiple of 100)", async () => {
    const res = await POST(postReq({ ratingMin: 1234 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(H.tryPairMock).not.toHaveBeenCalled();
  });

  it("returns 422 no_problems_in_range when a filtered request has zero matches", async () => {
    H.countAvailMock.mockResolvedValue(0);

    const res = await POST(postReq({ ratingMin: 1200, ratingMax: 1600 }));

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("no_problems_in_range");
    expect(H.tryPairMock).not.toHaveBeenCalled();
  });

  it("does not count availability for a filterless request", async () => {
    const res = await POST(postReq());

    expect(res.status).toBe(200);
    expect(H.countAvailMock).not.toHaveBeenCalled();
    expect(H.tryPairMock).toHaveBeenCalled();
  });
});

describe("POST /api/queue — enqueue persists filters + heartbeat", () => {
  it("upserts the four filter columns and lastSeenAt on both insert and conflict-update", async () => {
    H.tryPairMock.mockResolvedValue(null);

    const res = await POST(postReq({ ratingMin: 1200, ratingMax: 1600 }));

    expect(res.status).toBe(200);
    expect((await res.json()).matched).toBe(false);

    expect(H.insertValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        ratingMin: 1200,
        ratingMax: 1600,
        dateFrom: null,
        dateTo: null,
        lastSeenAt: expect.any(Date),
      }),
    );
    expect(H.onConflictSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          ratingMin: 1200,
          ratingMax: 1600,
          lastSeenAt: expect.any(Date),
        }),
      }),
    );
  });
});

describe("POST /api/queue — match writes intersection + ready deadline", () => {
  it("creates a ready race storing the filter intersection and a readyDeadlineAt", async () => {
    H.tryPairMock.mockResolvedValue({
      opponentId: "opp",
      opponentFilters: { ratingMin: 1400, ratingMax: 1800, dateFrom: null, dateTo: null },
    });

    const res = await POST(postReq({ ratingMin: 1200, ratingMax: 1600 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matched: true, raceId: "race-new" });

    const arg = H.createRaceMock.mock.calls[0][0];
    expect(arg.p1Id).toBe("user-1");
    expect(arg.p2Id).toBe("opp");
    expect(arg.status).toBe("ready");
    // Intersection: max(1200,1400)=1400, min(1600,1800)=1600.
    expect(arg.filters).toEqual({ ratingMin: 1400, ratingMax: 1600, dateFrom: null, dateTo: null });
    expect(arg.readyDeadlineAt).toBeInstanceOf(Date);
    // ~120s (READY_DEADLINE_SEC) in the future.
    expect(arg.readyDeadlineAt.getTime()).toBeGreaterThan(Date.now() + 60_000);
  });
});

describe("GET /api/queue — heartbeat + filter echo", () => {
  it("stamps lastSeenAt and echoes the caller's filters while queued", async () => {
    H.state.selectResult = [queueEntry({ ratingMin: 1200, ratingMax: 1600 })];
    H.tryPairMock.mockResolvedValue(null);

    const res = await GET(getReq());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("queued");
    expect(body.filters).toEqual({ ratingMin: 1200, ratingMax: 1600, dateFrom: null, dateTo: null });

    expect(H.updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ lastSeenAt: expect.any(Date) }),
    );
  });

  it("echoes null filters for an unfiltered queued caller (still stamps lastSeenAt)", async () => {
    H.state.selectResult = [queueEntry()];
    H.tryPairMock.mockResolvedValue(null);

    const res = await GET(getReq());

    const body = await res.json();
    expect(body.state).toBe("queued");
    expect(body.filters).toBeNull();
    expect(H.updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ lastSeenAt: expect.any(Date) }),
    );
  });

  it("on a poll match, creates a race with the intersection and deadline", async () => {
    H.state.selectResult = [queueEntry({ ratingMin: 1000, ratingMax: 1500 })];
    H.tryPairMock.mockResolvedValue({
      opponentId: "opp",
      opponentFilters: { ratingMin: 1200, ratingMax: 1800, dateFrom: null, dateTo: null },
    });

    const res = await GET(getReq());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("matched");
    expect(body.raceId).toBe("race-new");

    const arg = H.createRaceMock.mock.calls[0][0];
    expect(arg.filters).toEqual({ ratingMin: 1200, ratingMax: 1500, dateFrom: null, dateTo: null });
    expect(arg.readyDeadlineAt).toBeInstanceOf(Date);
  });
});
