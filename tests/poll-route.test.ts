/**
 * Tests for src/app/api/races/[id]/poll/route.ts — the poll mutex claim under
 * the dynamic-window change (issue #238).
 *
 * `requireLinkedUser`, `db`, the shared poll helpers (`stampHeartbeat`,
 * `pollActiveRace`, `maybeAbsenceForfeit`), and `buildRaceSnapshot` are mocked;
 * the REAL `isParticipant` guard runs. Load-bearing invariants pinned here:
 *
 *  - The claim is ONE atomic UPDATE whose window is the dynamic scalar subquery
 *    `GREATEST(5, (SELECT count(*) FROM races WHERE status = 'active') * 4)`,
 *    with the 5/4 sourced from the shared constants (compiled and asserted).
 *  - The presence heartbeat is stamped BEFORE the mutex claim (absence-forfeit
 *    presence must not degrade for the mutex-skipped majority).
 *  - A lost claim (zero rows) short-circuits to `{ skipped: true }` and never
 *    touches CF.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Race, User } from "../src/lib/db/schema";
import type { SessionResult } from "../src/lib/race/session";
import { POLL_MIN_INTERVAL_SEC } from "../src/lib/types";
import { SECONDS_PER_ACTIVE_RACE } from "../src/lib/race/poll-interval";
import { _resetMemoryStore } from "../src/lib/ratelimit";
import { RATE_LIMIT_POLICIES } from "../src/lib/ratelimit/policies";

const {
  authMock,
  requireLinkedUserMock,
  stampHeartbeatMock,
  pollActiveRaceMock,
  maybeAbsenceForfeitMock,
  buildRaceSnapshotMock,
  dbState,
  events,
} = vi.hoisted(() => {
  const dbState = {
    selectResults: [] as unknown[][],
    selectIndex: 0,
    claimReturns: [] as unknown[][],
    claimIndex: 0,
    capturedWhere: undefined as unknown,
  };
  const events: string[] = [];
  return {
    authMock: vi.fn(),
    requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
    stampHeartbeatMock: vi.fn(async () => {
      events.push("heartbeat");
    }),
    pollActiveRaceMock: vi.fn().mockResolvedValue(undefined),
    maybeAbsenceForfeitMock: vi.fn().mockResolvedValue(false),
    buildRaceSnapshotMock: vi.fn(async (race: Race) => ({
      __snapshotFor: race.id,
      status: race.status,
    })),
    dbState,
    events,
  };
});

vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));
vi.mock("@/lib/race/session", () => ({ requireLinkedUser: requireLinkedUserMock }));
vi.mock("@/lib/race/poll", () => ({
  stampHeartbeat: stampHeartbeatMock,
  pollActiveRace: pollActiveRaceMock,
  maybeAbsenceForfeit: maybeAbsenceForfeitMock,
}));
vi.mock("@/lib/race/snapshot", () => ({ buildRaceSnapshot: buildRaceSnapshotMock }));

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
    update: () => ({
      set: () => ({
        where: (condition: unknown) => {
          dbState.capturedWhere = condition;
          events.push("claim");
          return {
            returning: () =>
              Promise.resolve(dbState.claimReturns[dbState.claimIndex++] ?? []),
          };
        },
      }),
    }),
  },
}));

import { POST } from "../src/app/api/races/[id]/poll/route";

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
  return new Request(`http://localhost/api/races/${RACE_ID}/poll`, {
    method: "POST",
  });
}

beforeEach(() => {
  _resetMemoryStore();
  authMock.mockReset().mockResolvedValue({ userId: "clerk-user-p1", isAuthenticated: true });
  requireLinkedUserMock.mockReset();
  stampHeartbeatMock.mockClear();
  pollActiveRaceMock.mockClear();
  maybeAbsenceForfeitMock.mockClear();
  maybeAbsenceForfeitMock.mockResolvedValue(false);
  buildRaceSnapshotMock.mockClear();
  dbState.selectResults = [];
  dbState.selectIndex = 0;
  dbState.claimReturns = [];
  dbState.claimIndex = 0;
  dbState.capturedWhere = undefined;
  events.length = 0;
  mockSessionAs(P1);
});

describe("POST /api/races/[id]/poll — dynamic claim window (issue #238)", () => {
  it("claims with the dynamic scalar-subquery window sourced from the shared constants", async () => {
    const race = makeRace();
    dbState.selectResults = [[race], [race]];
    dbState.claimReturns = [[race]];

    const res = await POST(req(), { params });
    expect(res.status).toBe(200);

    // A single atomic UPDATE ran its claim (one captured WHERE).
    expect(dbState.capturedWhere).toBeDefined();
    const { sql: text, params: bound } = new PgDialect().sqlToQuery(
      dbState.capturedWhere as SQL,
    );
    const normalized = text.toLowerCase();

    // The window is the GREATEST(floor, count(active) * per-race) subquery form,
    // not a fixed literal interval.
    expect(normalized).toContain("greatest");
    expect(normalized).toContain("count(*)");
    expect(normalized).toContain("status");
    expect(normalized).toContain("interval");
    // The active-race snapshot is a subquery inside this same statement.
    expect(normalized).toContain("select count(*)");

    // The 5/4 constants are bound from the shared module — no duplicated magic
    // numbers hardcoded into the SQL string.
    expect(bound).toContain(POLL_MIN_INTERVAL_SEC);
    expect(bound).toContain(SECONDS_PER_ACTIVE_RACE);
    expect(text).not.toMatch(/greatest\(\s*5\s*,/i); // floor is a param, not inlined
  });

  it("stamps the presence heartbeat BEFORE the mutex claim", async () => {
    const race = makeRace();
    dbState.selectResults = [[race], [race]];
    dbState.claimReturns = [[race]];

    await POST(req(), { params });

    expect(stampHeartbeatMock).toHaveBeenCalledTimes(1);
    expect(events.indexOf("heartbeat")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("claim")).toBeGreaterThan(events.indexOf("heartbeat"));
  });

  it("still stamps the heartbeat then returns {skipped:true} when the claim is lost", async () => {
    const race = makeRace();
    dbState.selectResults = [[race]];
    dbState.claimReturns = [[]]; // lost the mutex — polled recently or not active

    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: true });
    // Heartbeat still ran (presence must not degrade for mutex-skipped polls)...
    expect(stampHeartbeatMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["heartbeat", "claim"]);
    // ...and no CF work happened on the skipped path.
    expect(pollActiveRaceMock).not.toHaveBeenCalled();
  });

  it("runs pollActiveRace and returns the snapshot on a won claim", async () => {
    const race = makeRace();
    dbState.selectResults = [[race], [race]];
    dbState.claimReturns = [[race]];

    const res = await POST(req(), { params });

    expect(pollActiveRaceMock).toHaveBeenCalledTimes(1);
    expect(buildRaceSnapshotMock).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("returns 404 when the race does not exist (no heartbeat, no claim)", async () => {
    dbState.selectResults = [[]];
    const res = await POST(req(), { params });
    expect(res.status).toBe(404);
    expect(stampHeartbeatMock).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("returns 403 for a non-participant (no heartbeat, no claim)", async () => {
    mockSessionAs("stranger");
    dbState.selectResults = [[makeRace()]];
    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
    expect(stampHeartbeatMock).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe("POST /api/races/[id]/poll — rate limiting (issue #257)", () => {
  it("allows requests within the policy limit unchanged", async () => {
    const race = makeRace();
    dbState.selectResults = [[race], [race]];
    dbState.claimReturns = [[race]];

    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    expect(requireLinkedUserMock).toHaveBeenCalled();
  });

  it("returns 429 with a Retry-After header once the per-minute limit is exceeded, without touching the DB", async () => {
    const { limit } = RATE_LIMIT_POLICIES.racePoll.policy;
    const race = makeRace();

    for (let i = 0; i < limit; i++) {
      dbState.selectResults = [[race], [race]];
      dbState.selectIndex = 0;
      dbState.claimReturns = [[race]];
      dbState.claimIndex = 0;
      const ok = await POST(req(), { params });
      expect(ok.status).toBe(200);
    }

    requireLinkedUserMock.mockClear();
    const res = await POST(req(), { params });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
    expect(await res.json()).toEqual({ error: "rate_limited" });
    // Rate-limited before the session/DB path ever runs.
    expect(requireLinkedUserMock).not.toHaveBeenCalled();
  });
});
