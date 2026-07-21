/**
 * Tests for the issue #184 cheater-blocklist check on `POST /api/queue`
 * (src/app/api/queue/route.ts). `requireLinkedUser`, the matchmaking
 * pairing, race creation, and the cheater set are all mocked so the route's
 * own gating logic — cheater check before pairing, fail-open on list
 * unavailability — is exercised in isolation, mirroring
 * `tests/race-create-filters-route.test.ts`'s approach to route testing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionResult } from "../src/lib/race/session";
import { _resetMemoryStore } from "../src/lib/ratelimit";

const {
  authMock,
  requireLinkedUserMock,
  tryPairMock,
  getCheaterSetMock,
  isKnownCheaterMock,
  dbInsertMock,
} =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
    tryPairMock: vi.fn(),
    getCheaterSetMock: vi.fn(),
    isKnownCheaterMock: vi.fn(),
    dbInsertMock: vi.fn(),
  }));

vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));
vi.mock("@/lib/race/session", () => ({ requireLinkedUser: requireLinkedUserMock }));
vi.mock("@/lib/race/create", () => ({ createRace: vi.fn() }));
vi.mock("@/lib/matchmaking", () => ({
  tryPair: tryPairMock,
  bandForWait: vi.fn(),
  intersectFilters: vi.fn(),
  BAND_BASE: 100,
}));
vi.mock("@/lib/cf/cheaters", () => ({
  getCheaterSet: getCheaterSetMock,
  isKnownCheater: isKnownCheaterMock,
}));
vi.mock("@/lib/cf/problem-availability", () => ({
  countAvailableProblems: vi.fn().mockResolvedValue(1),
}));
vi.mock("@/lib/db", () => ({
  db: {
    // findActiveRaceId(): no in-flight race for the caller.
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: dbInsertMock,
      }),
    }),
  },
}));

import { POST } from "../src/app/api/queue/route";

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

function req(): Request {
  return new Request("http://localhost/api/queue", { method: "POST" });
}

beforeEach(() => {
  _resetMemoryStore();
  authMock.mockReset().mockResolvedValue({ userId: "clerk-1", isAuthenticated: true });
  requireLinkedUserMock.mockReset();
  tryPairMock.mockReset().mockResolvedValue(null);
  getCheaterSetMock.mockReset().mockResolvedValue(new Set());
  isKnownCheaterMock.mockReset().mockReturnValue(false);
  dbInsertMock.mockReset().mockResolvedValue(undefined);
  mockSession();
});

describe("POST /api/queue — cheater blocklist (issue #184)", () => {
  it("returns 403 cheater_blocked and never attempts to pair or enqueue", async () => {
    getCheaterSetMock.mockResolvedValue(new Set(["mecf"]));
    isKnownCheaterMock.mockReturnValue(true);

    const res = await POST(req());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("cheater_blocked");
    expect(tryPairMock).not.toHaveBeenCalled();
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("fails open and enqueues normally when the cheater list is unavailable", async () => {
    getCheaterSetMock.mockResolvedValue(null);

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(isKnownCheaterMock).not.toHaveBeenCalled();
    expect(tryPairMock).toHaveBeenCalled();
  });

  it("allows a handle not on the list", async () => {
    getCheaterSetMock.mockResolvedValue(new Set(["someoneelse"]));
    isKnownCheaterMock.mockReturnValue(false);

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(tryPairMock).toHaveBeenCalled();
  });

  it("does not check the cheater list when unauthenticated", async () => {
    requireLinkedUserMock.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });

    const res = await POST(req());

    expect(res.status).toBe(401);
    expect(getCheaterSetMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/queue — rate limiting (issue #257)", () => {
  it("returns 429 once the per-minute write limit is exceeded, without calling requireLinkedUser", async () => {
    const { RATE_LIMIT_POLICIES } = await import("../src/lib/ratelimit/policies");
    const { limit } = RATE_LIMIT_POLICIES.queueWrite.policy;

    for (let i = 0; i < limit; i++) {
      const ok = await POST(req());
      expect(ok.status).toBe(200);
    }

    requireLinkedUserMock.mockClear();
    const res = await POST(req());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
    expect(requireLinkedUserMock).not.toHaveBeenCalled();
  });
});
