/**
 * Tests for src/app/api/reports/route.ts (issue #174).
 *
 * `requireLinkedUser` and `db` are mocked at the call shapes the route uses
 * (`select().from().where().limit()` / `insert().values().returning()`), same
 * pattern as tests/race-draw-route.test.ts. The real (pure) guard from
 * `@/lib/race/report` runs unmocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import type { Race } from "../src/lib/db/schema";
import type { SessionResult } from "../src/lib/race/session";

const { requireLinkedUserMock, insertValuesMock, enforceDbRateLimitMock, dbState } = vi.hoisted(() => {
  const dbState = {
    selectResults: [] as unknown[][],
    selectIndex: 0,
    insertReturning: [] as unknown[],
    insertError: null as unknown,
  };
  return {
    requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
    insertValuesMock: vi.fn(),
    enforceDbRateLimitMock: vi.fn(),
    dbState,
  };
});

vi.mock("@/lib/race/session", () => ({
  requireLinkedUser: requireLinkedUserMock,
}));

// `src/lib/ratelimit/policies.ts` transitively imports the real `@/lib/db`
// (via `./db.ts`'s registration side effect); mocked here at the call shape
// the route uses so this suite's own `@/lib/db` mock stays the source of
// truth. Rate-limit behavior itself is covered by tests/ratelimit-db.test.ts.
vi.mock("@/lib/ratelimit/policies", () => ({
  enforceDbRateLimit: enforceDbRateLimitMock,
  REPORTS_CREATE_POLICY: { limit: 5, windowMs: 60_000 },
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
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        insertValuesMock(table, values);
        return {
          returning: () => {
            if (dbState.insertError) return Promise.reject(dbState.insertError);
            return Promise.resolve(dbState.insertReturning);
          },
        };
      },
    }),
  },
}));

import { POST } from "../src/app/api/reports/route";

const RACE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const REPORT_ID = "d290f1ee-6c54-4b01-90e6-d701748f0851";
const P1 = "user-p1";
const P2 = "user-p2";
const OUTSIDER = "user-outsider";

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
    startedAt: new Date("2024-01-01T00:00:00Z"),
    endsAt: new Date("2024-01-01T00:40:00Z"),
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

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/reports", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireLinkedUserMock.mockReset();
  insertValuesMock.mockClear();
  enforceDbRateLimitMock.mockReset().mockResolvedValue(null);
  dbState.selectResults = [];
  dbState.selectIndex = 0;
  dbState.insertReturning = [];
  dbState.insertError = null;

  requireLinkedUserMock.mockResolvedValue({
    ok: true,
    user: {
      id: P1,
      clerkId: "clerk-p1",
      username: "p1",
      cfHandle: "p1cf",
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
});

describe("POST /api/reports", () => {
  it("inserts a report with the server-derived reportedId and returns 201", async () => {
    queueSelects([[makeRace()]]);
    dbState.insertReturning = [{ id: REPORT_ID }];

    const res = await POST(
      makeRequest({ raceId: RACE_ID, reason: "cheating", note: "sus" }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: REPORT_ID });
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        raceId: RACE_ID,
        reporterId: P1,
        reportedId: P2, // derived server-side, never from the request body
        reason: "cheating",
        note: "sus",
      }),
    );
  });

  it("derives reportedId as p1 when the caller is p2", async () => {
    requireLinkedUserMock.mockResolvedValue({
      ok: true,
      user: {
        id: P2,
        clerkId: "clerk-p2",
        username: "p2",
        cfHandle: "p2cf",
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
    queueSelects([[makeRace()]]);
    dbState.insertReturning = [{ id: REPORT_ID }];

    const res = await POST(makeRequest({ raceId: RACE_ID, reason: "other" }));

    expect(res.status).toBe(201);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reportedId: P1 }),
    );
  });

  it("defaults note to null when omitted", async () => {
    queueSelects([[makeRace()]]);
    dbState.insertReturning = [{ id: REPORT_ID }];

    await POST(makeRequest({ raceId: RACE_ID, reason: "av_violation" }));

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ note: null }),
    );
  });

  it("allows reporting a finished race", async () => {
    queueSelects([[makeRace({ status: "finished" })]]);
    dbState.insertReturning = [{ id: REPORT_ID }];

    const res = await POST(makeRequest({ raceId: RACE_ID, reason: "cheating" }));

    expect(res.status).toBe(201);
  });

  it("returns 409 already_reported on a unique-violation", async () => {
    queueSelects([[makeRace()]]);
    dbState.insertError = Object.assign(new Error("duplicate key"), {
      code: "23505",
    });

    const res = await POST(makeRequest({ raceId: RACE_ID, reason: "cheating" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_reported" });
  });

  it("rethrows non-unique-violation insert errors", async () => {
    queueSelects([[makeRace()]]);
    dbState.insertError = new Error("connection reset");

    await expect(
      POST(makeRequest({ raceId: RACE_ID, reason: "cheating" })),
    ).rejects.toThrow("connection reset");
  });

  it("returns 401 when unauthenticated", async () => {
    requireLinkedUserMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: "unauthorized",
    });

    const res = await POST(makeRequest({ raceId: RACE_ID, reason: "cheating" }));

    expect(res.status).toBe(401);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the race does not exist", async () => {
    queueSelects([[]]);

    const res = await POST(makeRequest({ raceId: RACE_ID, reason: "cheating" }));

    expect(res.status).toBe(404);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 403 not_participant for an outsider", async () => {
    requireLinkedUserMock.mockResolvedValue({
      ok: true,
      user: {
        id: OUTSIDER,
        clerkId: "clerk-out",
        username: "out",
        cfHandle: null,
        cfRating: null,
        cfLinkedAt: new Date(),
        elo: 1200,
        racesPlayed: 0,
        cppTemplate: "",
        solveHistorySyncedAt: null,
        solveHistoryImportCursor: null,
        createdAt: null,
        isAdmin: false,
      },
    });
    queueSelects([[makeRace()]]);

    const res = await POST(makeRequest({ raceId: RACE_ID, reason: "cheating" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_participant");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_status for a pending race", async () => {
    queueSelects([[makeRace({ status: "pending", p2Id: null })]]);

    const res = await POST(makeRequest({ raceId: RACE_ID, reason: "cheating" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_status");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_reason for a bogus reason", async () => {
    queueSelects([[makeRace()]]);

    const res = await POST(makeRequest({ raceId: RACE_ID, reason: "bogus" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_reason");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_body for a malformed request", async () => {
    const res = await POST(makeRequest({ raceId: RACE_ID }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/reports — rate limiting (issue #256)", () => {
  it("returns 429 and does not insert when the limiter blocks", async () => {
    enforceDbRateLimitMock.mockResolvedValue(
      NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "9" } }),
    );

    const res = await POST(makeRequest({ raceId: RACE_ID, reason: "cheating" }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("9");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("is keyed by the authenticated user id", async () => {
    queueSelects([[makeRace()]]);
    dbState.insertReturning = [{ id: REPORT_ID }];

    await POST(makeRequest({ raceId: RACE_ID, reason: "cheating" }));

    expect(enforceDbRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "reports_create",
      P1,
      expect.anything(),
    );
  });

  it("does not enforce the rate limit when unauthenticated", async () => {
    requireLinkedUserMock.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });

    const res = await POST(makeRequest({ raceId: RACE_ID, reason: "cheating" }));

    expect(res.status).toBe(401);
    expect(enforceDbRateLimitMock).not.toHaveBeenCalled();
  });
});
