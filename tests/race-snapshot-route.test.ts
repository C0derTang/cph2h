/**
 * Tests for src/app/api/races/[id]/route.ts — GET race snapshot (issue #7),
 * extended with the memory rate limiter (issue #257).
 *
 * `requireLinkedUser`, `db`, and `buildRaceSnapshot` are mocked; the REAL
 * `isParticipant` guard runs. The rate-limit invariant pinned here mirrors
 * `tests/poll-route.test.ts`: over the per-minute limit the route returns 429
 * with a `Retry-After` header BEFORE ever calling `requireLinkedUser` (so an
 * over-limit refetch never touches the DB); under the limit the existing
 * behavior is unchanged.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Race, User } from "../src/lib/db/schema";
import type { SessionResult } from "../src/lib/race/session";
import { _resetMemoryStore } from "../src/lib/ratelimit";
import { RATE_LIMIT_POLICIES } from "../src/lib/ratelimit/policies";

const { authMock, requireLinkedUserMock, buildRaceSnapshotMock, resolveReadyTimeoutMock, dbState } = vi.hoisted(() => {
  const dbState = {
    selectResults: [] as unknown[][],
    selectIndex: 0,
  };
  return {
    authMock: vi.fn(),
    requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
    buildRaceSnapshotMock: vi.fn(async (race: Race) => ({
      __snapshotFor: race.id,
      status: race.status,
    })),
    resolveReadyTimeoutMock: vi.fn().mockResolvedValue(undefined),
    dbState,
  };
});

vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));
vi.mock("@/lib/race/session", () => ({ requireLinkedUser: requireLinkedUserMock }));
vi.mock("@/lib/race/snapshot", () => ({ buildRaceSnapshot: buildRaceSnapshotMock }));
vi.mock("@/lib/race/ready-timeout", () => ({ resolveReadyTimeout: resolveReadyTimeoutMock }));

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
  },
}));

import { GET } from "../src/app/api/races/[id]/route";

const RACE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const P1 = "user-p1";
const P2 = "user-p2";

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: RACE_ID,
    status: "active",
    challengeToken: null,
    p1Id: P1,
    p2Id: P2,
    p1Ready: true,
    p2Ready: true,
    problemId: "1794C",
    timeLimitSec: 2400,
    startedAt: new Date(1700000000 * 1000),
    endsAt: new Date(1700000000 * 1000 + 2400 * 1000),
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

function mockSessionAs(userId: string) {
  const user: User = {
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
  };
  requireLinkedUserMock.mockResolvedValue({ ok: true, user });
}

const params = Promise.resolve({ id: RACE_ID });
function req(): Request {
  return new Request(`http://localhost/api/races/${RACE_ID}`);
}

beforeEach(() => {
  _resetMemoryStore();
  authMock.mockReset().mockResolvedValue({ userId: "clerk-user-p1", isAuthenticated: true });
  requireLinkedUserMock.mockReset();
  buildRaceSnapshotMock.mockClear();
  resolveReadyTimeoutMock.mockClear();
  resolveReadyTimeoutMock.mockResolvedValue(undefined);
  dbState.selectResults = [];
  dbState.selectIndex = 0;
  mockSessionAs(P1);
});

describe("GET /api/races/[id] — snapshot", () => {
  it("returns the snapshot for a participant", async () => {
    dbState.selectResults = [[makeRace()]];
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ __snapshotFor: RACE_ID, status: "active" });
  });

  it("returns 404 when the race does not exist", async () => {
    dbState.selectResults = [[]];
    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-participant", async () => {
    mockSessionAs("stranger");
    dbState.selectResults = [[makeRace()]];
    const res = await GET(req(), { params });
    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    requireLinkedUserMock.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    const res = await GET(req(), { params });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/races/[id] — lazy ready-deadline resolution (issue #275)", () => {
  it("resolves a past-deadline matchmade ready race, then RE-READS the terminal row", async () => {
    // Matchmade lobby (non-null deadline) with the deadline in the past and one
    // player ready: readyTimeoutAction fires, resolveReadyTimeout runs, and the
    // route re-reads so the claim loser observes the winner's terminal state.
    const pastDeadline = makeRace({
      status: "ready",
      startedAt: null,
      endsAt: null,
      p1Ready: true,
      p2Ready: false,
      readyDeadlineAt: new Date(Date.now() - 60_000),
    });
    const terminal = { ...pastDeadline, status: "finished" as const, winnerId: P1 };
    dbState.selectResults = [[pastDeadline], [terminal]];

    const res = await GET(req(), { params });

    expect(res.status).toBe(200);
    expect(resolveReadyTimeoutMock).toHaveBeenCalledTimes(1);
    // The snapshot is built from the RE-READ terminal row, not the stale one.
    expect(buildRaceSnapshotMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "finished" }),
    );
    expect(await res.json()).toMatchObject({ status: "finished" });
  });

  it("does NOT resolve a challenge race (null deadline): single read, no resolver", async () => {
    dbState.selectResults = [[makeRace({ status: "ready", readyDeadlineAt: null, p1Ready: true })]];
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    expect(resolveReadyTimeoutMock).not.toHaveBeenCalled();
    expect(dbState.selectIndex).toBe(1); // only one select consumed
  });
});

describe("GET /api/races/[id] — rate limiting (issue #257)", () => {
  it("allows requests within the policy limit unchanged", async () => {
    dbState.selectResults = [[makeRace()]];
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    expect(requireLinkedUserMock).toHaveBeenCalled();
  });

  it("returns 429 with a Retry-After header once the per-minute limit is exceeded, without touching the DB", async () => {
    const { limit } = RATE_LIMIT_POLICIES.raceSnapshot.policy;

    for (let i = 0; i < limit; i++) {
      dbState.selectResults = [[makeRace()]];
      dbState.selectIndex = 0;
      const ok = await GET(req(), { params });
      expect(ok.status).toBe(200);
    }

    requireLinkedUserMock.mockClear();
    const res = await GET(req(), { params });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(requireLinkedUserMock).not.toHaveBeenCalled();
  });
});
