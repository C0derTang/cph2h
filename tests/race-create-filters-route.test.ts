/**
 * Tests for the issue #64 extension to `POST /api/races`
 * (src/app/api/races/route.ts): optional problem filters, the creation-time
 * `no_problems_in_range` guard, and that filterless requests are unaffected.
 *
 * `requireLinkedUser`, `createRace`/`generateChallengeToken`, and
 * `countAvailableProblems` are mocked so the route's own logic (validation,
 * guard ordering, persistence call shape) is exercised in isolation — mirrors
 * `tests/race-abort-route.test.ts`'s approach to route testing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { SessionResult } from "../src/lib/race/session";

const { requireLinkedUserMock, createRaceMock, generateChallengeTokenMock, countAvailableProblemsMock } =
  vi.hoisted(() => ({
    requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
    createRaceMock: vi.fn(),
    generateChallengeTokenMock: vi.fn(() => "tok-abc"),
    countAvailableProblemsMock: vi.fn(),
  }));

vi.mock("@/lib/race/session", () => ({ requireLinkedUser: requireLinkedUserMock }));
vi.mock("@/lib/race/create", () => ({
  createRace: createRaceMock,
  generateChallengeToken: generateChallengeTokenMock,
}));
vi.mock("@/lib/cf/problem-availability", () => ({
  countAvailableProblems: countAvailableProblemsMock,
}));

import { POST } from "../src/app/api/races/route";

const ME = "user-1";

function mockSession() {
  requireLinkedUserMock.mockResolvedValue({
    ok: true,
    user: {
      id: ME,
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

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/races", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  requireLinkedUserMock.mockReset();
  createRaceMock.mockReset();
  generateChallengeTokenMock.mockClear();
  countAvailableProblemsMock.mockReset();
  mockSession();
  createRaceMock.mockResolvedValue({ id: "race-1", livekitRoom: "race-race-1" });
});

describe("POST /api/races — problem filters", () => {
  it("filterless body behaves exactly as before: no availability check, filters persisted as all-null", async () => {
    const res = await POST(makeRequest({ timeLimitSec: 1200 }));

    expect(res.status).toBe(201);
    expect(countAvailableProblemsMock).not.toHaveBeenCalled();
    expect(createRaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        p1Id: ME,
        status: "pending",
        timeLimitSec: 1200,
        filters: { ratingMin: null, ratingMax: null, dateFrom: null, dateTo: null },
      }),
    );
  });

  it("an empty body (no JSON at all) still creates the race", async () => {
    const res = await POST(new NextRequest("http://localhost/api/races", { method: "POST" }));
    expect(res.status).toBe(201);
    expect(createRaceMock).toHaveBeenCalled();
  });

  it("returns 400 on ratingMin > ratingMax and does not create a race", async () => {
    const res = await POST(makeRequest({ ratingMin: 2000, ratingMax: 1000 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(createRaceMock).not.toHaveBeenCalled();
  });

  it("returns 400 on an off-step rating and does not create a race", async () => {
    const res = await POST(makeRequest({ ratingMin: 850 }));
    expect(res.status).toBe(400);
    expect(createRaceMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a rating outside [800, 3500]", async () => {
    const res = await POST(makeRequest({ ratingMax: 3600 }));
    expect(res.status).toBe(400);
    expect(createRaceMock).not.toHaveBeenCalled();
  });

  it("returns 400 on dateFrom > dateTo", async () => {
    const res = await POST(
      makeRequest({ dateFrom: "2021-01-01T00:00:00.000Z", dateTo: "2020-01-01T00:00:00.000Z" }),
    );
    expect(res.status).toBe(400);
    expect(createRaceMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-ISO date string", async () => {
    const res = await POST(makeRequest({ dateFrom: "2020-01-01" }));
    expect(res.status).toBe(400);
    expect(createRaceMock).not.toHaveBeenCalled();
  });

  it("returns 422 no_problems_in_range when a filter is set and none match, and does not create a race", async () => {
    countAvailableProblemsMock.mockResolvedValue(0);
    const res = await POST(makeRequest({ ratingMin: 3500, ratingMax: 3500 }));

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("no_problems_in_range");
    expect(createRaceMock).not.toHaveBeenCalled();
  });

  it("creates the race and persists filters when the pool is non-empty", async () => {
    countAvailableProblemsMock.mockResolvedValue(5);
    const res = await POST(
      makeRequest({ ratingMin: 1200, ratingMax: 1600, dateFrom: "2020-01-01T00:00:00.000Z" }),
    );

    expect(res.status).toBe(201);
    expect(countAvailableProblemsMock).toHaveBeenCalledWith({
      ratingMin: 1200,
      ratingMax: 1600,
      dateFrom: "2020-01-01T00:00:00.000Z",
      dateTo: null,
    });
    expect(createRaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: {
          ratingMin: 1200,
          ratingMax: 1600,
          dateFrom: "2020-01-01T00:00:00.000Z",
          dateTo: null,
        },
      }),
    );
  });

  it("returns 401 when unauthenticated, without checking availability or creating a race", async () => {
    requireLinkedUserMock.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    const res = await POST(makeRequest({ ratingMin: 1000 }));
    expect(res.status).toBe(401);
    expect(countAvailableProblemsMock).not.toHaveBeenCalled();
    expect(createRaceMock).not.toHaveBeenCalled();
  });
});
