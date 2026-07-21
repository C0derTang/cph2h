/**
 * Tests for the issue #184 cheater-blocklist check on `POST /api/races/join`
 * (src/app/api/races/join/route.ts) — the challenge-accept entry point,
 * which covers accounts that linked before the list caught them.
 * `requireLinkedUser`, the DB, the snapshot builder, and the cheater set are
 * mocked so the route's own gating logic — cheater check before any DB
 * read/write, fail-open on list unavailability — is exercised in isolation,
 * mirroring tests/queue-cheater-route.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { SessionResult } from "../src/lib/race/session";

const {
  requireLinkedUserMock,
  getCheaterSetMock,
  isKnownCheaterMock,
  dbSelectMock,
  dbUpdateReturningMock,
  publishRaceEventMock,
  enforceDbRateLimitMock,
} = vi.hoisted(() => ({
  requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
  getCheaterSetMock: vi.fn(),
  isKnownCheaterMock: vi.fn(),
  dbSelectMock: vi.fn(),
  dbUpdateReturningMock: vi.fn(),
  publishRaceEventMock: vi.fn().mockResolvedValue(undefined),
  enforceDbRateLimitMock: vi.fn(),
}));

vi.mock("@/lib/race/session", () => ({ requireLinkedUser: requireLinkedUserMock }));
vi.mock("@/lib/cf/cheaters", () => ({
  getCheaterSet: getCheaterSetMock,
  isKnownCheater: isKnownCheaterMock,
}));
// See tests/race-create-filters-route.test.ts for why this is mocked here.
vi.mock("@/lib/ratelimit/policies", () => ({
  enforceDbRateLimit: enforceDbRateLimitMock,
  RACES_JOIN_POLICY: { limit: 15, windowMs: 60_000 },
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: dbSelectMock,
    update: () => ({
      set: () => ({
        where: () => ({ returning: dbUpdateReturningMock }),
      }),
    }),
    // Issue #274: on a successful join the route clears the joiner's queue row.
    delete: () => ({ where: () => Promise.resolve() }),
  },
}));
vi.mock("@/lib/race/snapshot", () => ({
  buildRaceSnapshot: vi.fn(async (race: { id: string }) => ({ id: race.id })),
  toPublicUser: vi.fn((user: { id: string }) => ({ id: user.id })),
}));
vi.mock("@/lib/race/hooks", () => ({ publishRaceEvent: publishRaceEventMock }));

import { POST } from "../src/app/api/races/join/route";

const PENDING_RACE = {
  id: "race-1",
  status: "pending",
  p1Id: "user-2",
  p2Id: null,
  challengeToken: "tok-abc",
};

function mockSession(cfHandle: string | null = "mecf") {
  requireLinkedUserMock.mockResolvedValue({
    ok: true,
    user: {
      id: "user-1",
      clerkId: "clerk-1",
      username: "me",
      cfHandle,
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

function makeRequest(token = "tok-abc"): NextRequest {
  return new NextRequest("http://localhost/api/races/join", {
    method: "POST",
    body: JSON.stringify({ token }),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  requireLinkedUserMock.mockReset();
  getCheaterSetMock.mockReset().mockResolvedValue(new Set());
  isKnownCheaterMock.mockReset().mockReturnValue(false);
  dbSelectMock.mockReset().mockImplementation(() => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve([PENDING_RACE]) }),
    }),
  }));
  dbUpdateReturningMock
    .mockReset()
    .mockResolvedValue([{ ...PENDING_RACE, p2Id: "user-1", status: "ready" }]);
  publishRaceEventMock.mockClear();
  enforceDbRateLimitMock.mockReset().mockResolvedValue(null);
  mockSession();
});

describe("POST /api/races/join — cheater blocklist (issue #184)", () => {
  it("returns 403 cheater_blocked before any DB read/write", async () => {
    getCheaterSetMock.mockResolvedValue(new Set(["mecf"]));
    isKnownCheaterMock.mockReturnValue(true);

    const res = await POST(makeRequest());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("cheater_blocked");
    expect(dbSelectMock).not.toHaveBeenCalled();
    expect(dbUpdateReturningMock).not.toHaveBeenCalled();
    expect(publishRaceEventMock).not.toHaveBeenCalled();
  });

  it("fails open and joins normally when the cheater list is unavailable", async () => {
    getCheaterSetMock.mockResolvedValue(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(isKnownCheaterMock).not.toHaveBeenCalled();
    expect(dbUpdateReturningMock).toHaveBeenCalled();
  });

  it("allows a handle not on the list", async () => {
    getCheaterSetMock.mockResolvedValue(new Set(["someoneelse"]));
    isKnownCheaterMock.mockReturnValue(false);

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(dbUpdateReturningMock).toHaveBeenCalled();
  });

  it("does not check the cheater list when unauthenticated", async () => {
    requireLinkedUserMock.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(getCheaterSetMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/races/join — rate limiting (issue #256)", () => {
  it("returns 429 and does not touch the DB when the limiter blocks", async () => {
    enforceDbRateLimitMock.mockResolvedValue(
      NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "3" } }),
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3");
    expect(dbSelectMock).not.toHaveBeenCalled();
    expect(dbUpdateReturningMock).not.toHaveBeenCalled();
  });

  it("is keyed by the authenticated user id", async () => {
    await POST(makeRequest());

    expect(enforceDbRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "races_join",
      "user-1",
      expect.anything(),
    );
  });

  it("does not enforce the rate limit when unauthenticated", async () => {
    requireLinkedUserMock.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(enforceDbRateLimitMock).not.toHaveBeenCalled();
  });
});
