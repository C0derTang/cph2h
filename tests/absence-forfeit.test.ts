/**
 * Tests for src/lib/race/poll.ts `maybeAbsenceForfeit` — the CF-activity
 * fallback (issue #303).
 *
 * A stale heartbeat alone must no longer forfeit when the opponent has a
 * recent Codeforces submission in this race (`race_submissions` is upserted by
 * `pollActiveRace` in the same request): the decision input is
 * `max(heartbeat, latest opponent submission)`. The DB is mocked following the
 * pattern in tests/race-finish.test.ts; `finishRace` is mocked so "no finish"
 * can be asserted directly (its own idempotency is covered by
 * tests/race-finish.test.ts and is untouched here).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Race } from "../src/lib/db/schema";
import { ABSENCE_FORFEIT_SEC } from "../src/lib/types";

const { dbState, finishMock } = vi.hoisted(() => {
  const dbState = {
    /** Rows returned by the max(submitted_at) query: `[{ latest }]`. */
    submissionRows: [] as unknown[],
    /** How many times the submissions fallback query actually ran. */
    selectCount: 0,
  };
  const finishMock = vi.fn().mockResolvedValue(undefined);
  return { dbState, finishMock };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          dbState.selectCount++;
          return Promise.resolve(dbState.submissionRows);
        },
      }),
    }),
  },
}));

vi.mock("@/lib/race/finish", () => ({ finishRace: finishMock }));
vi.mock("@/lib/cf/client", () => ({ getUserStatus: vi.fn() }));
vi.mock("@/lib/livekit", () => ({
  publishRaceEvent: vi.fn().mockResolvedValue(undefined),
}));

import { maybeAbsenceForfeit } from "../src/lib/race/poll";

const RACE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const STARTED_AT = new Date("2024-01-01T00:00:00Z");
const startMs = STARTED_AT.getTime();
const sec = (n: number) => n * 1000;
const at = (offsetSec: number) => new Date(startMs + sec(offsetSec));

// A "now" comfortably past the grace window measured from startedAt, so only
// the heartbeat / submission recency decides the outcome.
const NOW = at(ABSENCE_FORFEIT_SEC + 100);

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
    startedAt: STARTED_AT,
    endsAt: new Date(startMs + sec(2400)),
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
    readyDeadlineAt: null,
    createdAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  dbState.submissionRows = [{ latest: null }];
  dbState.selectCount = 0;
  finishMock.mockClear();
});

describe("maybeAbsenceForfeit — CF-activity fallback (issue #303)", () => {
  it("does NOT forfeit when the heartbeat is stale but a recent opponent CF submission exists", async () => {
    // p2's heartbeat is long stale (frozen background tab) …
    const race = makeRace({ p2LastSeenAt: at(10) });
    // … but they submitted on codeforces.com 50s ago — proof of presence.
    dbState.submissionRows = [
      { latest: new Date(NOW.getTime() - sec(50)) },
    ];

    const forfeited = await maybeAbsenceForfeit(race, true, NOW);

    expect(forfeited).toBe(false);
    expect(finishMock).not.toHaveBeenCalled();
    expect(dbState.selectCount).toBe(1);
  });

  it("forfeits when BOTH the heartbeat and the latest submission are stale", async () => {
    const race = makeRace({ p2LastSeenAt: at(10) });
    // Latest submission is also older than the grace window (ISO-string form,
    // as the HTTP driver may return raw strings for a bare max() projection).
    dbState.submissionRows = [{ latest: at(20).toISOString() }];

    const forfeited = await maybeAbsenceForfeit(race, true, NOW);

    expect(forfeited).toBe(true);
    expect(finishMock).toHaveBeenCalledTimes(1);
    expect(finishMock).toHaveBeenCalledWith({
      raceId: RACE_ID,
      outcome: "p1_win",
      winnerId: "user-p1",
      reason: "forfeit",
    });
  });

  it("forfeits on a null heartbeat with no submissions at all (max() row is null)", async () => {
    const race = makeRace({ p2LastSeenAt: null });
    dbState.submissionRows = [{ latest: null }];

    const forfeited = await maybeAbsenceForfeit(race, true, NOW);

    expect(forfeited).toBe(true);
    expect(finishMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "p1_win", winnerId: "user-p1" }),
    );
  });

  it("skips the submissions query entirely when the heartbeat alone is fresh", async () => {
    // max() can only push last-seen later, so a fresh heartbeat decides alone.
    const race = makeRace({ p2LastSeenAt: new Date(NOW.getTime() - sec(10)) });

    const forfeited = await maybeAbsenceForfeit(race, true, NOW);

    expect(forfeited).toBe(false);
    expect(finishMock).not.toHaveBeenCalled();
    expect(dbState.selectCount).toBe(0);
  });

  it("judges only the OPPONENT: a p2 caller checks p1's staleness and wins as p2", async () => {
    // The caller (p2) never forfeits themselves — their own heartbeat is
    // irrelevant here; p1's staleness (heartbeat + submissions) decides.
    const race = makeRace({
      p1LastSeenAt: at(10),
      p2LastSeenAt: null, // caller's own stamp doesn't matter
    });
    dbState.submissionRows = [{ latest: null }];

    const forfeited = await maybeAbsenceForfeit(race, false, NOW);

    expect(forfeited).toBe(true);
    expect(finishMock).toHaveBeenCalledWith({
      raceId: RACE_ID,
      outcome: "p2_win",
      winnerId: "user-p2",
      reason: "forfeit",
    });
  });

  it("keeps a p2 caller's fresh opponent (p1) alive via p1's recent submission", async () => {
    const race = makeRace({ p1LastSeenAt: at(10), p2LastSeenAt: null });
    dbState.submissionRows = [
      { latest: new Date(NOW.getTime() - sec(30)) },
    ];

    const forfeited = await maybeAbsenceForfeit(race, false, NOW);

    expect(forfeited).toBe(false);
    expect(finishMock).not.toHaveBeenCalled();
  });

  it("no-ops on a non-active race", async () => {
    const race = makeRace({ status: "finished" });

    expect(await maybeAbsenceForfeit(race, true, NOW)).toBe(false);
    expect(finishMock).not.toHaveBeenCalled();
    expect(dbState.selectCount).toBe(0);
  });

  it("no-ops before startedAt is set", async () => {
    const race = makeRace({ startedAt: null });

    expect(await maybeAbsenceForfeit(race, true, NOW)).toBe(false);
    expect(finishMock).not.toHaveBeenCalled();
    expect(dbState.selectCount).toBe(0);
  });
});
