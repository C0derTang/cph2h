/**
 * Tests for the `selectRaceProblem` hook (src/lib/race/hooks.ts, issue #66).
 *
 * The DB (`users` rating lookup), the candidate repo, the statement pre-cache,
 * LiveKit, and finish are mocked; the REAL pure picker
 * (`src/lib/cf/problem-picker.ts`) runs so this exercises the full
 * fetch-band → pick → SelectProblemResult path. The load-bearing invariant
 * verified here: on success the result is `{ ok: true, problemId }` with a
 * non-null id (the race must never go active with a null problem); on failure
 * it is a discriminated reason and NO problem id.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Race } from "../src/lib/db/schema";
import type { ProblemRef } from "../src/lib/types";

const {
  getCandidatesInBandMock,
  getSeenProblemIdsMock,
  getOrScrapeStatementMock,
  usersRows,
} = vi.hoisted(() => ({
  getCandidatesInBandMock: vi.fn(),
  getSeenProblemIdsMock: vi.fn(),
  getOrScrapeStatementMock: vi.fn().mockResolvedValue(undefined),
  usersRows: { value: [] as unknown[] },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(usersRows.value),
      }),
    }),
  },
}));

vi.mock("@/lib/cf/problem-repo", () => ({
  getCandidatesInBand: getCandidatesInBandMock,
  getSeenProblemIds: getSeenProblemIdsMock,
}));
vi.mock("@/lib/cf/statements", () => ({
  getOrScrapeStatement: getOrScrapeStatementMock,
}));
vi.mock("@/lib/livekit", () => ({ publishRaceEvent: vi.fn() }));
vi.mock("@/lib/race/finish", () => ({ finishRace: vi.fn() }));

import { selectRaceProblem } from "../src/lib/race/hooks";

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";

function problem(id: string, rating: number): ProblemRef {
  const contestId = Number(id.slice(0, -1));
  const index = id.slice(-1);
  return {
    id,
    contestId,
    index,
    name: `Problem ${id}`,
    rating,
    url: `https://codeforces.com/problemset/problem/${contestId}/${index}`,
  };
}

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: "race-seed-a",
    status: "ready",
    challengeToken: null,
    p1Id: P1,
    p2Id: P2,
    p1Ready: true,
    p2Ready: true,
    problemId: null,
    timeLimitSec: 2400,
    ratingMin: null,
    ratingMax: null,
    problemDateFrom: null,
    problemDateTo: null,
    problemSelectionFailedReason: null,
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
    livekitRoom: "room-1",
    drawOfferBy: null,
    readyDeadlineAt: null,
    createdAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  getCandidatesInBandMock.mockReset();
  getSeenProblemIdsMock.mockReset();
  getOrScrapeStatementMock.mockClear();
  getOrScrapeStatementMock.mockResolvedValue(undefined);
  // Both players rated 1200 -> target 1200.
  usersRows.value = [
    { id: P1, cfRating: 1200 },
    { id: P2, cfRating: 1200 },
  ];
  getSeenProblemIdsMock.mockResolvedValue(new Set<string>());
});

describe("selectRaceProblem", () => {
  it("returns { ok: true, problemId } (non-null) when a conforming unseen problem exists", async () => {
    getCandidatesInBandMock.mockResolvedValue([problem("1A", 1200)]);

    const result = await selectRaceProblem(makeRace());

    expect(result).toEqual({ ok: true, problemId: "1A" });
    // Invariant: an ok result never carries a null/empty problem id.
    if (result.ok) expect(result.problemId).toBeTruthy();
    expect(getOrScrapeStatementMock).toHaveBeenCalledWith("1A");
  });

  it("returns all_problems_seen when the only in-band candidate is already seen", async () => {
    getCandidatesInBandMock.mockResolvedValue([problem("1A", 1200)]);
    getSeenProblemIdsMock.mockImplementation((userId: string) =>
      Promise.resolve(userId === P2 ? new Set(["1A"]) : new Set<string>()),
    );

    const result = await selectRaceProblem(makeRace());

    expect(result).toEqual({ ok: false, reason: "all_problems_seen" });
    expect(getOrScrapeStatementMock).not.toHaveBeenCalled();
  });

  it("returns no_problems_in_filters when there are no candidates at all", async () => {
    getCandidatesInBandMock.mockResolvedValue([]);

    const result = await selectRaceProblem(makeRace());

    expect(result).toEqual({ ok: false, reason: "no_problems_in_filters" });
  });

  it("reads the race filter columns: fetch range widens to the full filter and out-of-filter candidates are rejected", async () => {
    // Filter [2000, 2400]. Fetch must span the full filter range (not just the
    // 1200 target band), and a candidate below the floor must not be picked.
    getCandidatesInBandMock.mockResolvedValue([
      problem("1A", 1900), // below filter floor — must be rejected by the picker
      problem("2A", 2000), // in filter
    ]);

    const from = new Date("2020-01-01T00:00:00.000Z");
    const to = new Date("2023-01-01T00:00:00.000Z");
    const result = await selectRaceProblem(
      makeRace({ ratingMin: 2000, ratingMax: 2400, problemDateFrom: from, problemDateTo: to }),
    );

    expect(getCandidatesInBandMock).toHaveBeenCalledWith(2000, 2400, {
      dateFrom: from,
      dateTo: to,
    });
    expect(result).toEqual({ ok: true, problemId: "2A" });
  });

  it("single-sided ratingMin far ABOVE the target still fetches a valid range and succeeds (regression)", async () => {
    // Players rated 1200 -> target 1200. ratingMin=2500, ratingMax unset.
    // A naive fallback to the target band would fetch (2500, 1900) — an
    // inverted, always-empty range — and misreport no_problems_in_filters.
    // The unset side must widen to the global ceiling (3500) instead.
    getCandidatesInBandMock.mockResolvedValue([problem("1A", 3000)]);

    const result = await selectRaceProblem(makeRace({ ratingMin: 2500, ratingMax: null }));

    expect(getCandidatesInBandMock).toHaveBeenCalledWith(2500, 3500, {
      dateFrom: null,
      dateTo: null,
    });
    expect(result).toEqual({ ok: true, problemId: "1A" });
  });

  it("single-sided ratingMax far BELOW the target still fetches a valid range and succeeds (regression)", async () => {
    // Players rated 3000 -> target 3000. ratingMax=1000, ratingMin unset.
    // The unset side must widen to the global floor (800), not target-600=2400
    // (which would invert the range to (2400, 1000)).
    usersRows.value = [
      { id: P1, cfRating: 3000 },
      { id: P2, cfRating: 3000 },
    ];
    getCandidatesInBandMock.mockResolvedValue([problem("1A", 900)]);

    const result = await selectRaceProblem(makeRace({ ratingMin: null, ratingMax: 1000 }));

    expect(getCandidatesInBandMock).toHaveBeenCalledWith(800, 1000, {
      dateFrom: null,
      dateTo: null,
    });
    expect(result).toEqual({ ok: true, problemId: "1A" });
  });

  it("no rating filter at all keeps the target-band fetch range (unchanged behavior)", async () => {
    getCandidatesInBandMock.mockResolvedValue([problem("1A", 1200)]);

    await selectRaceProblem(makeRace());

    // target 1200 -> (1200-600, 1200+700).
    expect(getCandidatesInBandMock).toHaveBeenCalledWith(600, 1900, {
      dateFrom: null,
      dateTo: null,
    });
  });

  it("still succeeds even if the statement pre-cache throws (best-effort)", async () => {
    getCandidatesInBandMock.mockResolvedValue([problem("1A", 1200)]);
    getOrScrapeStatementMock.mockRejectedValue(new Error("scrape down"));

    const result = await selectRaceProblem(makeRace());

    expect(result).toEqual({ ok: true, problemId: "1A" });
  });
});
