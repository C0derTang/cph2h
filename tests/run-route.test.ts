/**
 * Tests for src/app/api/races/[id]/run/route.ts
 *
 * `requireLinkedUser` and the Piston HTTP call (`runCode`) are mocked; `db`
 * is mocked at the `select().from().where().limit()` call shape used by the
 * route (see tests/livekit-token-route.test.ts for the same pattern).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Race, User } from "../src/lib/db/schema";
import type { SessionResult } from "../src/lib/race/session";

const { requireLinkedUserMock, selectMock, runCodeMock } = vi.hoisted(() => {
  return {
    requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
    selectMock: vi.fn(),
    runCodeMock: vi.fn(),
  };
});

vi.mock("@/lib/race/session", () => ({
  requireLinkedUser: requireLinkedUserMock,
}));

vi.mock("@/lib/db", () => ({
  db: { select: selectMock },
}));

vi.mock("@/lib/piston", async (importActual) => {
  const actual = await importActual<typeof import("../src/lib/piston")>();
  return { ...actual, runCode: runCodeMock };
});

import { POST } from "../src/app/api/races/[id]/run/route";
import { PISTON_STATUS_ACCEPTED, PISTON_STATUS_COMPILE_ERROR } from "../src/lib/piston";
import type { RunResponse } from "../src/lib/types";

const RACE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-p1",
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
    ...overrides,
  };
}

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: RACE_ID,
    status: "active",
    challengeToken: null,
    p1Id: currentUserId,
    p2Id: "user-p2",
    p1Ready: true,
    p2Ready: true,
    problemId: "1794C",
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

function makeStatementRow(samples: { input: string; output: string }[]) {
  return {
    problemId: "1794C",
    html: "<p>statement</p>",
    samples,
    scrapedAt: new Date(),
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
  return new Request(`http://localhost/api/races/${RACE_ID}/run`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: RACE_ID });

// The route's rate-limit map is keyed by userId and lives for the process
// lifetime of the module (by design — see route.ts). Giving every test its
// own userId keeps the rate-limit state from one test leaking into the next;
// the one test that actually exercises rate limiting reuses the same id
// across its own two calls on purpose.
let currentUserId = "user-p1";
let userCounter = 0;

beforeEach(() => {
  currentUserId = `user-test-${++userCounter}`;
  requireLinkedUserMock.mockReset();
  selectMock.mockReset();
  runCodeMock.mockReset();
  requireLinkedUserMock.mockResolvedValue({
    ok: true,
    user: makeUser({ id: currentUserId, clerkId: currentUserId }),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/races/[id]/run", () => {
  it("runs every sample and reports pass/fail (happy path)", async () => {
    mockSelectSequence([
      [makeRace()],
      [makeStatementRow([{ input: "1\n", output: "2\n" }, { input: "2\n", output: "4\n" }])],
    ]);
    runCodeMock
      .mockResolvedValueOnce({
        statusId: PISTON_STATUS_ACCEPTED,
        status: "Accepted",
        stdout: "2\n",
        stderr: "",
        compileOutput: null,
        timeSec: 0.01,
      })
      .mockResolvedValueOnce({
        statusId: PISTON_STATUS_ACCEPTED,
        status: "Accepted",
        stdout: "5\n", // wrong
        stderr: "",
        compileOutput: null,
        timeSec: 0.01,
      });

    const res = await POST(makeRequest({ code: "int main(){}" }), { params });

    expect(res.status).toBe(200);
    const json = (await res.json()) as RunResponse;
    expect(json.ok).toBe(true);
    if (!json.ok) throw new Error("expected ok:true");
    expect(json.results).toHaveLength(2);
    expect(json.results[0]).toMatchObject({ sampleIndex: 0, passed: true });
    expect(json.results[1]).toMatchObject({ sampleIndex: 1, passed: false, actualOutput: "5\n" });
    expect(runCodeMock).toHaveBeenCalledTimes(2);
  });

  it("short-circuits after a compilation error instead of re-running every sample", async () => {
    mockSelectSequence([
      [makeRace()],
      [makeStatementRow([{ input: "1\n", output: "2\n" }, { input: "2\n", output: "4\n" }])],
    ]);
    runCodeMock.mockResolvedValueOnce({
      statusId: PISTON_STATUS_COMPILE_ERROR,
      status: "Compilation Error",
      stdout: "",
      stderr: "",
      compileOutput: "error: expected ';'",
      timeSec: null,
    });

    const res = await POST(makeRequest({ code: "int main() {" }), { params });

    const json = (await res.json()) as RunResponse;
    expect(json.ok).toBe(true);
    if (!json.ok) throw new Error("expected ok:true");
    expect(json.results).toHaveLength(1);
    expect(json.results[0].compileOutput).toBe("error: expected ';'");
    expect(runCodeMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a second run within RUN_RATE_LIMIT_SEC with 429 rate_limited", async () => {
    mockSelectSequence([
      [makeRace()],
      [makeStatementRow([{ input: "1\n", output: "2\n" }])],
      [makeRace()],
    ]);
    runCodeMock.mockResolvedValue({
      statusId: PISTON_STATUS_ACCEPTED,
      status: "Accepted",
      stdout: "2\n",
      stderr: "",
      compileOutput: null,
      timeSec: 0.01,
    });

    const first = await POST(makeRequest({ code: "int main(){}" }), { params });
    expect(first.status).toBe(200);

    const second = await POST(makeRequest({ code: "int main(){}" }), { params });
    expect(second.status).toBe(429);
    const json = (await second.json()) as RunResponse;
    expect(json).toMatchObject({ ok: false, error: "rate_limited" });
    // The rate limit is enforced before spending another Piston call.
    expect(runCodeMock).toHaveBeenCalledTimes(1);
  });

  it("returns 403 for a non-participant", async () => {
    // Race belongs to two other users; the mocked caller is neither.
    mockSelectSequence([[makeRace({ p1Id: "user-a", p2Id: "user-b" })]]);

    const res = await POST(makeRequest({ code: "int main(){}" }), { params });

    expect(res.status).toBe(403);
    expect(runCodeMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    requireLinkedUserMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: "unauthorized",
    });

    const res = await POST(makeRequest({ code: "int main(){}" }), { params });

    expect(res.status).toBe(401);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns no_samples when the race has no problem assigned yet", async () => {
    mockSelectSequence([[makeRace({ problemId: null })]]);

    const res = await POST(makeRequest({ code: "int main(){}" }), { params });

    expect(res.status).toBe(409);
    const json = (await res.json()) as RunResponse;
    expect(json).toMatchObject({ ok: false, error: "no_samples" });
  });

  it("returns judge0_error when the Piston call fails", async () => {
    mockSelectSequence([
      [makeRace()],
      [makeStatementRow([{ input: "1\n", output: "2\n" }])],
    ]);
    runCodeMock.mockRejectedValue(new Error("Piston request failed: HTTP 503"));

    const res = await POST(makeRequest({ code: "int main(){}" }), { params });

    expect(res.status).toBe(502);
    const json = (await res.json()) as RunResponse;
    expect(json).toMatchObject({ ok: false, error: "judge0_error" });
  });

  it("returns 400 for an invalid body", async () => {
    mockSelectSequence([[makeRace()]]);

    const res = await POST(makeRequest({ code: "" }), { params });

    expect(res.status).toBe(400);
  });
});
