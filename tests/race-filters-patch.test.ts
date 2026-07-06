/**
 * Tests for src/app/api/races/[id]/filters/route.ts (issue #66).
 *
 * `requireLinkedUser`, `db`, `buildRaceSnapshot`, and `publishRaceEvent` are
 * mocked; the REAL zod validation (`@/lib/race/filters`) runs. This pins the
 * PATCH guard matrix — challenger-only (403), lobby-status-only (409), the same
 * validation as `POST /api/races` (400) — and the atomic reset-and-clear write
 * plus the `filters_updated` event on success.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Race } from "../src/lib/db/schema";
import type { SessionResult } from "../src/lib/race/session";

const { requireLinkedUserMock, publishRaceEventMock, buildRaceSnapshotMock, updateSetMock, dbState } =
  vi.hoisted(() => {
    const dbState = {
      selectResults: [] as unknown[][],
      selectIndex: 0,
      updateReturns: [] as unknown[],
    };
    return {
      requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
      publishRaceEventMock: vi.fn().mockResolvedValue(undefined),
      buildRaceSnapshotMock: vi.fn(async (race: Race) => ({
        __snapshotFor: race.id,
        status: race.status,
      })),
      updateSetMock: vi.fn(),
      dbState,
    };
  });

vi.mock("@/lib/race/session", () => ({ requireLinkedUser: requireLinkedUserMock }));
vi.mock("@/lib/race/snapshot", () => ({ buildRaceSnapshot: buildRaceSnapshotMock }));
vi.mock("@/lib/race/hooks", () => ({ publishRaceEvent: publishRaceEventMock }));

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
      set: (values: Record<string, unknown>) => {
        updateSetMock(values);
        return {
          where: () => ({ returning: () => Promise.resolve(dbState.updateReturns) }),
        };
      },
    }),
  },
}));

import { PATCH } from "../src/app/api/races/[id]/filters/route";

const RACE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const P1 = "user-p1";
const P2 = "user-p2";

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: RACE_ID,
    status: "pending",
    challengeToken: "tok-abc",
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

function queueSelects(results: unknown[][]) {
  dbState.selectResults = results;
  dbState.selectIndex = 0;
}

const params = Promise.resolve({ id: RACE_ID });

function req(body?: unknown): Request {
  const init: RequestInit = { method: "PATCH", headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost/api/races/${RACE_ID}/filters`, init);
}

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
      createdAt: null,
    },
  });
}

beforeEach(() => {
  requireLinkedUserMock.mockReset();
  publishRaceEventMock.mockClear();
  buildRaceSnapshotMock.mockClear();
  updateSetMock.mockClear();
  dbState.selectResults = [];
  dbState.selectIndex = 0;
  dbState.updateReturns = [];
  mockSessionAs(P1);
});

describe("PATCH /api/races/[id]/filters — success", () => {
  it("challenger updates filters on a pending race: resets ready flags, clears reason, emits event", async () => {
    const race = makeRace({ status: "pending", p2Id: P2, p1Ready: true, p2Ready: true });
    queueSelects([[race]]);
    dbState.updateReturns = [{ ...race, ratingMin: 1200, ratingMax: 1600 }];

    const res = await PATCH(
      req({ ratingMin: 1200, ratingMax: 1600, dateFrom: "2020-01-01T00:00:00.000Z" }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ratingMin: 1200,
        ratingMax: 1600,
        problemDateFrom: expect.any(Date),
        problemDateTo: null,
        p1Ready: false,
        p2Ready: false,
        problemSelectionFailedReason: null,
      }),
    );
    expect(publishRaceEventMock).toHaveBeenCalledWith(RACE_ID, { type: "filters_updated" });
  });

  it("is allowed while status is ready", async () => {
    const race = makeRace({ status: "ready", p2Id: P2 });
    queueSelects([[race]]);
    dbState.updateReturns = [{ ...race, ratingMin: 1000 }];

    const res = await PATCH(req({ ratingMin: 1000 }), { params });

    expect(res.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalled();
  });

  it("an empty body clears all filters (all columns null)", async () => {
    const race = makeRace({ status: "pending", ratingMin: 1200, ratingMax: 1600 });
    queueSelects([[race]]);
    dbState.updateReturns = [{ ...race, ratingMin: null, ratingMax: null }];

    const res = await PATCH(req({}), { params });

    expect(res.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ratingMin: null,
        ratingMax: null,
        problemDateFrom: null,
        problemDateTo: null,
      }),
    );
  });

  it("re-reads (no publish) when the atomic claim is lost to a concurrent start", async () => {
    const race = makeRace({ status: "ready", p2Id: P2 });
    queueSelects([[race], [{ ...race, status: "active" }]]);
    dbState.updateReturns = []; // lost the pending|ready claim

    const res = await PATCH(req({ ratingMin: 1000 }), { params });

    expect(res.status).toBe(200);
    expect(publishRaceEventMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/races/[id]/filters — guard matrix", () => {
  it("403 for a non-challenger (p2), no write", async () => {
    mockSessionAs(P2);
    queueSelects([[makeRace({ status: "ready", p2Id: P2 })]]);

    const res = await PATCH(req({ ratingMin: 1000 }), { params });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_challenger");
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("409 when the race has already started (active), no write", async () => {
    queueSelects([[makeRace({ status: "active", p2Id: P2 })]]);

    const res = await PATCH(req({ ratingMin: 1000 }), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_editable");
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("409 when the race is finished", async () => {
    queueSelects([[makeRace({ status: "finished", p2Id: P2 })]]);
    const res = await PATCH(req({ ratingMin: 1000 }), { params });
    expect(res.status).toBe(409);
  });

  it("role is checked before status: non-challenger on an active race still gets 403", async () => {
    mockSessionAs(P2);
    queueSelects([[makeRace({ status: "active", p2Id: P2 })]]);

    const res = await PATCH(req({ ratingMin: 1000 }), { params });

    expect(res.status).toBe(403);
  });

  it("400 on an off-step rating, no write", async () => {
    queueSelects([[makeRace({ status: "pending" })]]);
    const res = await PATCH(req({ ratingMin: 850 }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("400 on ratingMin > ratingMax", async () => {
    queueSelects([[makeRace({ status: "pending" })]]);
    const res = await PATCH(req({ ratingMin: 2000, ratingMax: 1000 }), { params });
    expect(res.status).toBe(400);
  });

  it("400 on a rating outside [800, 3500]", async () => {
    queueSelects([[makeRace({ status: "pending" })]]);
    const res = await PATCH(req({ ratingMax: 3600 }), { params });
    expect(res.status).toBe(400);
  });

  it("400 on dateFrom > dateTo", async () => {
    queueSelects([[makeRace({ status: "pending" })]]);
    const res = await PATCH(
      req({ dateFrom: "2021-01-01T00:00:00.000Z", dateTo: "2020-01-01T00:00:00.000Z" }),
      { params },
    );
    expect(res.status).toBe(400);
  });

  it("404 when the race does not exist", async () => {
    queueSelects([[]]);
    const res = await PATCH(req({ ratingMin: 1000 }), { params });
    expect(res.status).toBe(404);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("401 when unauthenticated, no read of the race body needed", async () => {
    requireLinkedUserMock.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    const res = await PATCH(req({ ratingMin: 1000 }), { params });
    expect(res.status).toBe(401);
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});
