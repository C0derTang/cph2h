/**
 * Tests for src/lib/race/poll.ts — verdict selection (against #3 fixtures) and
 * draw-on-timeout. CF client, finish, and LiveKit are mocked; `findRaceVerdicts`
 * is the real parser.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Race, User } from "../src/lib/db/schema";
import type { CfSubmission } from "../src/lib/types";
import fixture from "./fixtures/user-status.json";

const {
  dbState,
  getUserStatusMock,
  finishRaceMock,
  publishMock,
  insertValuesMock,
  updateSetMock,
} = vi.hoisted(() => {
  const dbState = { userRows: [] as unknown[], selectCall: 0 };
  return {
    dbState,
    getUserStatusMock: vi.fn(),
    finishRaceMock: vi.fn().mockResolvedValue(undefined),
    publishMock: vi.fn().mockResolvedValue(undefined),
    insertValuesMock: vi.fn().mockResolvedValue(undefined),
    updateSetMock: vi.fn(() => ({ where: () => Promise.resolve(undefined) })),
  };
});

// The poll issues exactly one `select` for the player rows, then one existence
// `select` per observed submission (against `race_submissions`). Return the
// user rows for the first select and an empty result (no pre-existing row →
// insert path) for every subsequent one.
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          dbState.selectCall += 1;
          const rows = dbState.selectCall === 1 ? dbState.userRows : [];
          return Object.assign(Promise.resolve(rows), {
            limit: () => Promise.resolve(rows),
          });
        },
      }),
    }),
    insert: () => ({ values: insertValuesMock }),
    update: () => ({ set: updateSetMock }),
  },
}));

vi.mock("@/lib/cf/client", () => ({ getUserStatus: getUserStatusMock }));
vi.mock("@/lib/race/finish", () => ({ finishRace: finishRaceMock }));
vi.mock("@/lib/livekit", () => ({ publishRaceEvent: publishMock }));

import {
  pollActiveRace,
  stampHeartbeat,
  maybeAbsenceForfeit,
} from "../src/lib/race/poll";
import { ABSENCE_FORFEIT_SEC } from "../src/lib/types";

const submissions = fixture.result as CfSubmission[];
const PROBLEM_ID = "1794C";
// Fixture submissions live at ~1.7e9s; start the race just before them.
const STARTED_AT = new Date(1700000000 * 1000);

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: "race-1",
    status: "active",
    challengeToken: null,
    p1Id: "user-p1",
    p2Id: "user-p2",
    p1Ready: true,
    p2Ready: true,
    problemId: PROBLEM_ID,
    timeLimitSec: 2400,
    startedAt: STARTED_AT,
    endsAt: new Date(STARTED_AT.getTime() + 2400 * 1000),
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

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-p1",
    clerkId: "clerk-p1",
    username: "p1",
    cfHandle: "handle-p1",
    cfRating: 1600,
    cfLinkedAt: new Date(),
    elo: 1200,
    racesPlayed: 0,
    cppTemplate: "",
    solveHistorySyncedAt: null,
    createdAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  dbState.userRows = [
    makeUser({ id: "user-p1", cfHandle: "handle-p1" }),
    makeUser({ id: "user-p2", cfHandle: null }),
  ];
  dbState.selectCall = 0;
  getUserStatusMock.mockReset();
  finishRaceMock.mockClear();
  publishMock.mockClear();
  insertValuesMock.mockClear();
  updateSetMock.mockClear();
});

describe("pollActiveRace", () => {
  it("finishes as a p1 win on the earliest OK submission for the race problem", async () => {
    getUserStatusMock.mockResolvedValueOnce(submissions); // p1 (only one with a handle)

    // A "now" well before endsAt so only the verdict resolves the race.
    await pollActiveRace(makeRace(), new Date(STARTED_AT.getTime() + 60 * 1000));

    expect(finishRaceMock).toHaveBeenCalledTimes(1);
    expect(finishRaceMock).toHaveBeenCalledWith({
      raceId: "race-1",
      outcome: "p1_win",
      winnerId: "user-p1",
      winningSubmissionId: 200000003, // earliest OK after start
      reason: "solved",
    });
  });

  it("publishes non-OK final verdicts as hints and does not finish", async () => {
    const nonOk = submissions.filter((s) => s.verdict !== "OK");
    getUserStatusMock.mockResolvedValueOnce(nonOk);

    await pollActiveRace(makeRace(), new Date(STARTED_AT.getTime() + 60 * 1000));

    expect(finishRaceMock).not.toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledWith(
      "room-1",
      expect.objectContaining({ type: "verdict", userId: "user-p1" }),
    );
  });

  it("upserts a race_submissions row for each observed manual submission", async () => {
    const nonOk = submissions.filter((s) => s.verdict !== "OK");
    getUserStatusMock.mockResolvedValueOnce(nonOk);

    await pollActiveRace(makeRace(), new Date(STARTED_AT.getTime() + 60 * 1000));

    // No pre-inserted rows exist (users submit on CF themselves), so each
    // sighted *final* non-OK verdict is inserted with empty code and its
    // verdict. Still-testing submissions are skipped by findRaceVerdicts.
    expect(insertValuesMock).toHaveBeenCalled();
    const inserted = insertValuesMock.mock.calls.map((c) => c[0]);
    const insertedIds = inserted.map((r) => r.cfSubmissionId).sort();
    expect(insertedIds).toEqual([200000002, 200000004, 200000005]);
    for (const row of inserted) {
      expect(row).toMatchObject({ raceId: "race-1", userId: "user-p1", code: "" });
      expect(row.verdict).toBeTruthy();
    }
  });

  it("draws when the time limit has passed and nobody solved", async () => {
    getUserStatusMock.mockResolvedValueOnce([]); // p1 has no submissions

    const past = new Date(STARTED_AT.getTime() + 2400 * 1000 + 1000);
    await pollActiveRace(makeRace(), past);

    expect(finishRaceMock).toHaveBeenCalledTimes(1);
    expect(finishRaceMock).toHaveBeenCalledWith({
      raceId: "race-1",
      outcome: "draw",
      winnerId: null,
      reason: "timeout",
    });
  });

  it("does nothing when unsolved and still within the time limit", async () => {
    getUserStatusMock.mockResolvedValueOnce([]);

    await pollActiveRace(makeRace(), new Date(STARTED_AT.getTime() + 60 * 1000));

    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("draws a race with no problem assigned once it times out", async () => {
    const past = new Date(STARTED_AT.getTime() + 2400 * 1000 + 1000);
    await pollActiveRace(makeRace({ problemId: null }), past);

    expect(getUserStatusMock).not.toHaveBeenCalled();
    expect(finishRaceMock).toHaveBeenCalledWith({
      raceId: "race-1",
      outcome: "draw",
      winnerId: null,
      reason: "timeout",
    });
  });

  // Sweep interaction (issue #105): the cron sweep drives races solely through
  // pollActiveRace. It must never stamp a heartbeat (fake presence) nor
  // absence-forfeit on behalf of an absent player — pollActiveRace has no such
  // code, so it only ever finishes on solve/timeout.
  it("never stamps a heartbeat or absence-forfeits (sweep-safe path)", async () => {
    getUserStatusMock.mockResolvedValueOnce([]);

    await pollActiveRace(makeRace(), new Date(STARTED_AT.getTime() + 60 * 1000));

    // No `races` UPDATE (heartbeat) issued by the shared poll path.
    expect(updateSetMock).not.toHaveBeenCalled();
    // And nothing finishes here, let alone with a forfeit reason.
    expect(finishRaceMock).not.toHaveBeenCalled();
  });
});

describe("stampHeartbeat", () => {
  it("stamps the caller's own side (p1) while active", async () => {
    await stampHeartbeat("race-1", true);
    expect(updateSetMock).toHaveBeenCalledTimes(1);
    const arg = (updateSetMock.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect("p1LastSeenAt" in arg).toBe(true);
    expect("p2LastSeenAt" in arg).toBe(false);
  });

  it("stamps the caller's own side (p2) while active", async () => {
    await stampHeartbeat("race-1", false);
    const arg = (updateSetMock.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect("p2LastSeenAt" in arg).toBe(true);
    expect("p1LastSeenAt" in arg).toBe(false);
  });
});

describe("maybeAbsenceForfeit", () => {
  const START = STARTED_AT;
  const past = (s: number) => new Date(START.getTime() + s * 1000);

  it("forfeits the opponent to the present caller once past the grace window", async () => {
    // p1 is polling; p2 has never been seen → floored at startedAt.
    const race = makeRace({ p1LastSeenAt: null, p2LastSeenAt: null });
    const result = await maybeAbsenceForfeit(
      race,
      true,
      past(ABSENCE_FORFEIT_SEC + 1),
    );

    expect(result).toBe(true);
    expect(finishRaceMock).toHaveBeenCalledTimes(1);
    expect(finishRaceMock).toHaveBeenCalledWith({
      raceId: "race-1",
      outcome: "p1_win",
      winnerId: "user-p1",
      reason: "forfeit",
    });
  });

  it("credits the p2 caller when p1 is the absent one", async () => {
    const race = makeRace({ p1LastSeenAt: null, p2LastSeenAt: null });
    const result = await maybeAbsenceForfeit(
      race,
      false,
      past(ABSENCE_FORFEIT_SEC + 1),
    );

    expect(result).toBe(true);
    expect(finishRaceMock).toHaveBeenCalledWith({
      raceId: "race-1",
      outcome: "p2_win",
      winnerId: "user-p2",
      reason: "forfeit",
    });
  });

  it("does not forfeit within the grace window (a refresh is safe)", async () => {
    const race = makeRace({
      p2LastSeenAt: past(100), // opponent seen recently
    });
    const result = await maybeAbsenceForfeit(race, true, past(108));

    expect(result).toBe(false);
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("does not forfeit during the countdown (now before startedAt)", async () => {
    const race = makeRace({ startedAt: past(10), p2LastSeenAt: null });
    const result = await maybeAbsenceForfeit(race, true, past(5));

    expect(result).toBe(false);
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("no-ops once a verdict already finished the race (verdict precedence)", async () => {
    // pollActiveRace runs first in the route; a solve/timeout flips status,
    // so the re-read the route hands us is no longer 'active'.
    const race = makeRace({ status: "finished", p2LastSeenAt: null });
    const result = await maybeAbsenceForfeit(
      race,
      true,
      past(ABSENCE_FORFEIT_SEC + 1),
    );

    expect(result).toBe(false);
    expect(finishRaceMock).not.toHaveBeenCalled();
  });
});
