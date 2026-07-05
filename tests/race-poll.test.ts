/**
 * Tests for src/lib/race/poll.ts — verdict selection (against #3 fixtures) and
 * draw-on-timeout. CF client, finish, and LiveKit are mocked; `findRaceVerdicts`
 * is the real parser.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Race, User } from "../src/lib/db/schema";
import type { CfSubmission } from "../src/lib/types";
import fixture from "./fixtures/user-status.json";

const { dbState, getUserStatusMock, finishRaceMock, publishMock } = vi.hoisted(
  () => {
    const dbState = { userRows: [] as unknown[] };
    return {
      dbState,
      getUserStatusMock: vi.fn(),
      finishRaceMock: vi.fn().mockResolvedValue(undefined),
      publishMock: vi.fn().mockResolvedValue(undefined),
    };
  },
);

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(dbState.userRows) }),
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve(undefined) }),
    }),
  },
}));

vi.mock("@/lib/cf/client", () => ({ getUserStatus: getUserStatusMock }));
vi.mock("@/lib/race/finish", () => ({ finishRace: finishRaceMock }));
vi.mock("@/lib/livekit", () => ({ publishRaceEvent: publishMock }));

import { pollActiveRace } from "../src/lib/race/poll";

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
    livekitRoom: "room-1",
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
    createdAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  dbState.userRows = [
    makeUser({ id: "user-p1", cfHandle: "handle-p1" }),
    makeUser({ id: "user-p2", cfHandle: null }),
  ];
  getUserStatusMock.mockReset();
  finishRaceMock.mockClear();
  publishMock.mockClear();
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
});
