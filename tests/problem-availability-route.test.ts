/**
 * Tests for `GET /api/problems/availability`
 * (src/app/api/problems/availability/route.ts, issue #64) — the thin authed
 * route the challenge-creation form polls for live filter feedback.
 * `requireLinkedUser` and `countAvailableProblems` are mocked; validation and
 * query-param coercion are exercised against the real `raceFiltersSchema`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { SessionResult } from "../src/lib/race/session";

const { requireLinkedUserMock, countAvailableProblemsMock } = vi.hoisted(() => ({
  requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
  countAvailableProblemsMock: vi.fn(),
}));

vi.mock("@/lib/race/session", () => ({ requireLinkedUser: requireLinkedUserMock }));
vi.mock("@/lib/cf/problem-availability", () => ({
  countAvailableProblems: countAvailableProblemsMock,
}));

import { GET } from "../src/app/api/problems/availability/route";

function mockSession() {
  requireLinkedUserMock.mockResolvedValue({
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
    },
  });
}

beforeEach(() => {
  requireLinkedUserMock.mockReset();
  countAvailableProblemsMock.mockReset();
  mockSession();
});

describe("GET /api/problems/availability", () => {
  it("returns 401 when unauthenticated", async () => {
    requireLinkedUserMock.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    const res = await GET(new NextRequest("http://localhost/api/problems/availability"));
    expect(res.status).toBe(401);
    expect(countAvailableProblemsMock).not.toHaveBeenCalled();
  });

  it("coerces numeric query params and returns the count", async () => {
    countAvailableProblemsMock.mockResolvedValue(7);
    const req = new NextRequest(
      "http://localhost/api/problems/availability?ratingMin=800&ratingMax=1200",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 7 });
    expect(countAvailableProblemsMock).toHaveBeenCalledWith({
      ratingMin: 800,
      ratingMax: 1200,
      dateFrom: null,
      dateTo: null,
    });
  });

  it("passes through date query params", async () => {
    countAvailableProblemsMock.mockResolvedValue(2);
    const req = new NextRequest(
      "http://localhost/api/problems/availability?dateFrom=2020-01-01T00%3A00%3A00.000Z",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(countAvailableProblemsMock).toHaveBeenCalledWith({
      ratingMin: null,
      ratingMax: null,
      dateFrom: "2020-01-01T00:00:00.000Z",
      dateTo: null,
    });
  });

  it("returns 400 invalid_query on an out-of-range rating", async () => {
    const req = new NextRequest("http://localhost/api/problems/availability?ratingMin=100");
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_query");
    expect(countAvailableProblemsMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_query on a non-ISO date", async () => {
    const req = new NextRequest("http://localhost/api/problems/availability?dateFrom=not-a-date");
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(countAvailableProblemsMock).not.toHaveBeenCalled();
  });

  it("returns the count with no query params at all (matches every cached problem)", async () => {
    countAvailableProblemsMock.mockResolvedValue(42);
    const req = new NextRequest("http://localhost/api/problems/availability");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 42 });
    expect(countAvailableProblemsMock).toHaveBeenCalledWith({
      ratingMin: null,
      ratingMax: null,
      dateFrom: null,
      dateTo: null,
    });
  });
});
