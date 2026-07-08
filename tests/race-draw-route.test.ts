/**
 * Tests for src/app/api/races/[id]/draw/route.ts (issue #53).
 *
 * `requireLinkedUser`, `finishRace` (via the `@/lib/race/hooks` seam), and
 * `publishRaceEvent` are mocked; `db` is mocked at the
 * `select().from().where().limit()` / `update().set().where().returning()`
 * call shapes the route uses (see tests/run-route.test.ts /
 * tests/race-finish.test.ts for the same patterns). `buildRaceSnapshot` is
 * mocked too — it has its own extensive DB fan-out (players, submissions,
 * problem/statement) covered by other tests, so here we just assert the
 * route passes it the right race row and returns its result verbatim. The
 * real (pure) guards from `@/lib/race/machine` run unmocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Race } from "../src/lib/db/schema";
import type { SessionResult } from "../src/lib/race/session";
import type { RaceEvent } from "../src/lib/types";

const {
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
    requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
    updateSetMock: vi.fn(),
    finishRaceMock: vi.fn().mockResolvedValue(undefined),
    publishRaceEventMock: vi.fn().mockResolvedValue(undefined),
    buildRaceSnapshotMock: vi.fn(async (race: Race) => ({
      __snapshotFor: race.id,
      status: race.status,
      drawOfferBy: race.drawOfferBy ?? null,
    })),
    dbState,
  };
});

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

vi.mock("@/lib/race/hooks", () => ({ finishRace: finishRaceMock }));
vi.mock("@/lib/livekit", () => ({ publishRaceEvent: publishRaceEventMock }));
vi.mock("@/lib/race/snapshot", () => ({ buildRaceSnapshot: buildRaceSnapshotMock }));

import { POST } from "../src/app/api/races/[id]/draw/route";

const RACE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
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
    createdAt: null,
    ...overrides,
  };
}

function queueSelects(results: unknown[][]) {
  dbState.selectResults = results;
  dbState.selectIndex = 0;
}

function makeRequest(body: unknown): Request {
  return new Request(`http://localhost/api/races/${RACE_ID}/draw`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: RACE_ID });

beforeEach(() => {
  requireLinkedUserMock.mockReset();
  updateSetMock.mockClear();
  finishRaceMock.mockClear();
  publishRaceEventMock.mockClear();
  buildRaceSnapshotMock.mockClear();
  dbState.selectResults = [];
  dbState.selectIndex = 0;
  dbState.updateReturning = [];

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
    },
  });
});

describe("POST /api/races/[id]/draw — offer", () => {
  it("sets draw_offer_by and publishes draw_offered", async () => {
    const race = makeRace();
    queueSelects([[race]]);
    dbState.updateReturning = [{ ...race, drawOfferBy: P1 }];

    const res = await POST(makeRequest({ action: "offer" }), { params });

    expect(res.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ drawOfferBy: P1 }),
    );
    expect(publishRaceEventMock).toHaveBeenCalledWith(
      "room-1",
      { type: "draw_offered", byUserId: P1 } satisfies RaceEvent,
    );
    const json = await res.json();
    expect(json).toEqual({ __snapshotFor: RACE_ID, status: "active", drawOfferBy: P1 });
  });

  it("is a no-op-ok when the same player re-offers", async () => {
    const race = makeRace({ drawOfferBy: P1 });
    queueSelects([[race]]);
    dbState.updateReturning = [{ ...race, drawOfferBy: P1 }];

    const res = await POST(makeRequest({ action: "offer" }), { params });

    expect(res.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalled();
  });

  it("returns 403 not_participant for an outsider", async () => {
    requireLinkedUserMock.mockResolvedValue({
      ok: true,
      user: { id: OUTSIDER, clerkId: "clerk-out", username: "out", cfHandle: null, cfRating: null, cfLinkedAt: new Date(), elo: 1200, racesPlayed: 0, cppTemplate: "", solveHistorySyncedAt: null, solveHistoryImportCursor: null, createdAt: null },
    });
    queueSelects([[makeRace()]]);

    const res = await POST(makeRequest({ action: "offer" }), { params });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_participant");
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("returns 409 not_active when the race is not active", async () => {
    queueSelects([[makeRace({ status: "finished" })]]);

    const res = await POST(makeRequest({ action: "offer" }), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_active");
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("returns 409 not_active when the atomic claim loses the race", async () => {
    const race = makeRace();
    queueSelects([[race], [{ ...race, status: "finished" }]]);
    dbState.updateReturning = []; // lost the race between read and write

    const res = await POST(makeRequest({ action: "offer" }), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_active");
    expect(publishRaceEventMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/races/[id]/draw — accept", () => {
  it("atomically consumes the opponent's offer, finishes as a draw, returns the fresh snapshot", async () => {
    const offered = makeRace({ drawOfferBy: P1 });
    const finished = makeRace({
      drawOfferBy: null,
      status: "finished",
      outcome: "draw",
    });
    requireLinkedUserMock.mockResolvedValue({
      ok: true,
      user: { id: P2, clerkId: "clerk-p2", username: "p2", cfHandle: "p2cf", cfRating: 1400, cfLinkedAt: new Date(), elo: 1200, racesPlayed: 3, cppTemplate: "", solveHistorySyncedAt: null, solveHistoryImportCursor: null, createdAt: null },
    });
    queueSelects([[offered], [finished]]);
    // The CAS claim finds the still-valid offer and clears it.
    dbState.updateReturning = [{ ...offered, drawOfferBy: null }];

    const res = await POST(makeRequest({ action: "accept" }), { params });

    expect(res.status).toBe(200);
    // Consent is gated by the atomic CAS (clear draw_offer_by), not just the
    // pre-guard, and only then does the finish run.
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ drawOfferBy: null }),
    );
    expect(finishRaceMock).toHaveBeenCalledWith({
      raceId: RACE_ID,
      outcome: "draw",
      winnerId: null,
      reason: "agreement",
    });
    const json = await res.json();
    expect(json).toEqual({ __snapshotFor: RACE_ID, status: "finished", drawOfferBy: null });
  });

  it("does NOT finish when the offer was withdrawn before the accept's atomic claim (TOCTOU)", async () => {
    // The handler's initial read still sees P1's offer (guard passes), but by
    // the time the CAS runs P1 has withdrawn (draw_offer_by=NULL, still
    // active) so the claim matches zero rows.
    const stillOffered = makeRace({ drawOfferBy: P1 });
    const withdrawn = makeRace({ drawOfferBy: null }); // active, no offer
    requireLinkedUserMock.mockResolvedValue({
      ok: true,
      user: { id: P2, clerkId: "clerk-p2", username: "p2", cfHandle: "p2cf", cfRating: 1400, cfLinkedAt: new Date(), elo: 1200, racesPlayed: 3, cppTemplate: "", solveHistorySyncedAt: null, solveHistoryImportCursor: null, createdAt: null },
    });
    queueSelects([[stillOffered], [withdrawn]]);
    dbState.updateReturning = []; // CAS lost — offer already gone

    const res = await POST(makeRequest({ action: "accept" }), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_draw_offer");
    // Crucially: the race is NOT finished on consent that no longer exists.
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("returns 409 not_active when the race ended before the accept's atomic claim", async () => {
    const stillOffered = makeRace({ drawOfferBy: P1 });
    const ended = makeRace({ drawOfferBy: null, status: "finished" });
    requireLinkedUserMock.mockResolvedValue({
      ok: true,
      user: { id: P2, clerkId: "clerk-p2", username: "p2", cfHandle: "p2cf", cfRating: 1400, cfLinkedAt: new Date(), elo: 1200, racesPlayed: 3, cppTemplate: "", solveHistorySyncedAt: null, solveHistoryImportCursor: null, createdAt: null },
    });
    queueSelects([[stillOffered], [ended]]);
    dbState.updateReturning = []; // CAS lost — race no longer active

    const res = await POST(makeRequest({ action: "accept" }), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_active");
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("rejects the offerer accepting their own offer", async () => {
    queueSelects([[makeRace({ drawOfferBy: P1 })]]);

    const res = await POST(makeRequest({ action: "accept" }), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("own_draw_offer");
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("rejects accepting when there is no outstanding offer", async () => {
    requireLinkedUserMock.mockResolvedValue({
      ok: true,
      user: { id: P2, clerkId: "clerk-p2", username: "p2", cfHandle: "p2cf", cfRating: 1400, cfLinkedAt: new Date(), elo: 1200, racesPlayed: 3, cppTemplate: "", solveHistorySyncedAt: null, solveHistoryImportCursor: null, createdAt: null },
    });
    queueSelects([[makeRace({ drawOfferBy: null })]]);

    const res = await POST(makeRequest({ action: "accept" }), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_draw_offer");
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("returns 403 not_participant for an outsider", async () => {
    requireLinkedUserMock.mockResolvedValue({
      ok: true,
      user: { id: OUTSIDER, clerkId: "clerk-out", username: "out", cfHandle: null, cfRating: null, cfLinkedAt: new Date(), elo: 1200, racesPlayed: 0, cppTemplate: "", solveHistorySyncedAt: null, solveHistoryImportCursor: null, createdAt: null },
    });
    queueSelects([[makeRace({ drawOfferBy: P1 })]]);

    const res = await POST(makeRequest({ action: "accept" }), { params });

    expect(res.status).toBe(403);
    expect(finishRaceMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/races/[id]/draw — decline", () => {
  it("clears draw_offer_by and publishes draw_declined when the opponent declines", async () => {
    const race = makeRace({ drawOfferBy: P1 });
    requireLinkedUserMock.mockResolvedValue({
      ok: true,
      user: { id: P2, clerkId: "clerk-p2", username: "p2", cfHandle: "p2cf", cfRating: 1400, cfLinkedAt: new Date(), elo: 1200, racesPlayed: 3, cppTemplate: "", solveHistorySyncedAt: null, solveHistoryImportCursor: null, createdAt: null },
    });
    queueSelects([[race]]);
    dbState.updateReturning = [{ ...race, drawOfferBy: null }];

    const res = await POST(makeRequest({ action: "decline" }), { params });

    expect(res.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ drawOfferBy: null }),
    );
    expect(publishRaceEventMock).toHaveBeenCalledWith("room-1", {
      type: "draw_declined",
      byUserId: P2,
    } satisfies RaceEvent);
  });

  it("allows the offerer to withdraw their own offer", async () => {
    const race = makeRace({ drawOfferBy: P1 });
    queueSelects([[race]]);
    dbState.updateReturning = [{ ...race, drawOfferBy: null }];

    const res = await POST(makeRequest({ action: "decline" }), { params });

    expect(res.status).toBe(200);
    expect(publishRaceEventMock).toHaveBeenCalledWith("room-1", {
      type: "draw_declined",
      byUserId: P1,
    } satisfies RaceEvent);
  });

  it("returns 409 no_draw_offer when there is nothing to decline", async () => {
    queueSelects([[makeRace({ drawOfferBy: null })]]);

    const res = await POST(makeRequest({ action: "decline" }), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_draw_offer");
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/races/[id]/draw — cross-cutting", () => {
  it("returns 401 when unauthenticated", async () => {
    requireLinkedUserMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: "unauthorized",
    });

    const res = await POST(makeRequest({ action: "offer" }), { params });

    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid action", async () => {
    const res = await POST(makeRequest({ action: "nope" }), { params });

    expect(res.status).toBe(400);
  });

  it("returns 404 when the race does not exist", async () => {
    queueSelects([[]]);

    const res = await POST(makeRequest({ action: "offer" }), { params });

    expect(res.status).toBe(404);
  });
});
