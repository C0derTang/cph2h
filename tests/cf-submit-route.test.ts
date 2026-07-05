/**
 * Tests for src/app/api/races/[id]/submit/route.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Problem, Race, User } from "@/lib/db/schema";

const { authMock, selectMock, insertValuesMock, insertMock, submitSolutionMock } =
  vi.hoisted(() => {
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    return {
      authMock: vi.fn(),
      selectMock: vi.fn(),
      insertValuesMock,
      insertMock: vi.fn(() => ({ values: insertValuesMock })),
      submitSolutionMock: vi.fn(),
    };
  });

vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ db: { select: selectMock, insert: insertMock } }));
vi.mock("@/lib/cf/submit", () => ({ submitSolution: submitSolutionMock }));

import { POST } from "@/app/api/races/[id]/submit/route";

const RACE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-p1",
    clerkId: "clerk-p1",
    username: "p1",
    cfHandle: "tourist",
    cfRating: 3800,
    cfLinkedAt: new Date("2024-01-01T00:00:00Z"),
    elo: 1200,
    racesPlayed: 0,
    cppTemplate: "",
    createdAt: null,
    ...overrides,
  };
}

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: RACE_ID,
    status: "active",
    challengeToken: null,
    p1Id: "user-p1",
    p2Id: "user-p2",
    p1Ready: true,
    p2Ready: true,
    problemId: "1794C",
    timeLimitSec: 2400,
    startedAt: new Date("2024-01-01T00:00:00Z"),
    endsAt: null,
    finishedAt: null,
    outcome: null,
    winnerId: null,
    winningSubmissionId: null,
    eloDeltaP1: null,
    eloDeltaP2: null,
    lastPolledAt: null,
    livekitRoom: "room-1",
    createdAt: null,
    ...overrides,
  };
}

function makeProblem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: "1794C",
    contestId: 1794,
    index: "C",
    name: "Sum on Subarrays",
    rating: 1600,
    tags: [],
    fetchedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

/** Queue up successive `db.select()...limit()` results in call order. */
function mockSelectSequence(results: unknown[][]) {
  let i = 0;
  selectMock.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(results[i++] ?? []),
      }),
    }),
  }));
}

function makeRequest(body: unknown): Request {
  return new Request(`http://localhost/api/races/${RACE_ID}/submit`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function makeParams() {
  return { params: Promise.resolve({ id: RACE_ID }) };
}

beforeEach(() => {
  authMock.mockReset();
  selectMock.mockReset();
  insertMock.mockClear();
  insertValuesMock.mockClear();
  submitSolutionMock.mockReset();
});

describe("POST /api/races/[id]/submit", () => {
  it("submits and records a race_submissions row on success", async () => {
    authMock.mockResolvedValue({ userId: "clerk-p1" });
    mockSelectSequence([[makeUser()], [makeRace()], [makeProblem()]]);
    submitSolutionMock.mockResolvedValue({ cfSubmissionId: 987654 });

    const res = await POST(makeRequest({ code: "int main(){}" }), makeParams());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cfSubmissionId: 987654 });
    expect(submitSolutionMock).toHaveBeenCalledWith({
      userId: "user-p1",
      contestId: 1794,
      index: "C",
      code: "int main(){}",
      languageId: 54,
    });
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ cfSubmissionId: 987654, verdict: null, userId: "user-p1" }),
    );
  });

  it("returns cf_error and still persists the code when CF submit fails", async () => {
    authMock.mockResolvedValue({ userId: "clerk-p1" });
    mockSelectSequence([[makeUser()], [makeRace()], [makeProblem()]]);
    submitSolutionMock.mockRejectedValue(new Error("You have already submitted exactly this code to Codeforces."));

    const res = await POST(makeRequest({ code: "dup" }), makeParams());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("cf_error");
    expect(json.message).toContain("already submitted");
    // Code persisted with a null submission id for manual fallback / #15 polling.
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ cfSubmissionId: null, code: "dup" }),
    );
  });

  it("returns 403 not_participant for a non-participant", async () => {
    authMock.mockResolvedValue({ userId: "clerk-out" });
    mockSelectSequence([
      [makeUser({ id: "user-out", clerkId: "clerk-out" })],
      [makeRace()],
    ]);

    const res = await POST(makeRequest({ code: "x" }), makeParams());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_participant");
    expect(submitSolutionMock).not.toHaveBeenCalled();
  });

  it("returns 409 not_active when the race is not active", async () => {
    authMock.mockResolvedValue({ userId: "clerk-p1" });
    mockSelectSequence([[makeUser()], [makeRace({ status: "finished" })]]);

    const res = await POST(makeRequest({ code: "x" }), makeParams());

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_active");
    expect(submitSolutionMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });

    const res = await POST(makeRequest({ code: "x" }), makeParams());

    expect(res.status).toBe(401);
  });

  it("returns 403 cf_not_linked when the caller has no linked CF account", async () => {
    authMock.mockResolvedValue({ userId: "clerk-p1" });
    mockSelectSequence([[makeUser({ cfLinkedAt: null })]]);

    const res = await POST(makeRequest({ code: "x" }), makeParams());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("cf_not_linked");
  });

  it("returns 400 for an invalid body", async () => {
    authMock.mockResolvedValue({ userId: "clerk-p1" });
    mockSelectSequence([[makeUser()]]);

    const res = await POST(makeRequest({ code: "" }), makeParams());

    expect(res.status).toBe(400);
  });

  it("returns 404 when the race does not exist", async () => {
    authMock.mockResolvedValue({ userId: "clerk-p1" });
    mockSelectSequence([[makeUser()], []]);

    const res = await POST(makeRequest({ code: "x" }), makeParams());

    expect(res.status).toBe(404);
  });
});
