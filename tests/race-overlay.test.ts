/**
 * Tests for src/lib/race/overlay.ts — the pure victory/defeat overlay
 * transition detector (issue #113).
 *
 * The overlay must fire ONLY on an observed live `active → finished|aborted`
 * transition and never on a direct load onto an already-finished race. The
 * outcome is derived from the snapshot (source of truth), not any event.
 */

import { describe, it, expect } from "vitest";
import {
  detectOverlayOutcome,
  winnerHasAcceptedSubmission,
} from "../src/lib/race/overlay";
import type { PublicUser, RaceOutcome, RaceSnapshot, RaceStatus } from "../src/lib/types";

const YOU = "user-you";
const OPP = "user-opp";

function user(id: string): PublicUser {
  return { id, username: id, cfHandle: null, cfRating: null, elo: 1200, racesPlayed: 0 };
}

function snap(overrides: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return {
    id: "race-1",
    now: new Date().toISOString(),
    status: "finished" as RaceStatus,
    p1: user(YOU),
    p2: user(OPP),
    p1Ready: true,
    p2Ready: true,
    timeLimitSec: 2400,
    startedAt: null,
    endsAt: null,
    finishedAt: null,
    outcome: null as RaceOutcome | null,
    winnerId: null,
    eloDeltaP1: null,
    eloDeltaP2: null,
    problem: null,
    statement: null,
    submissions: [],
    livekitRoom: "room-1",
    challengeToken: null,
    drawOfferBy: null,
    p1LastSeenAt: null,
    p2LastSeenAt: null,
    filters: null,
    problemSelectionFailedReason: null,
    ...overrides,
  };
}

describe("detectOverlayOutcome", () => {
  it("victory: active → finished with you as winner", () => {
    expect(
      detectOverlayOutcome(
        "active",
        snap({ status: "finished", outcome: "p1_win", winnerId: YOU }),
        YOU,
      ),
    ).toBe("victory");
  });

  it("defeat: active → finished with opponent as winner", () => {
    expect(
      detectOverlayOutcome(
        "active",
        snap({ status: "finished", outcome: "p2_win", winnerId: OPP }),
        YOU,
      ),
    ).toBe("defeat");
  });

  it("draw: active → finished with a draw outcome", () => {
    expect(
      detectOverlayOutcome(
        "active",
        snap({ status: "finished", outcome: "draw", winnerId: null }),
        YOU,
      ),
    ).toBe("draw");
  });

  it("draw: terminal with no winner and no explicit draw outcome", () => {
    expect(
      detectOverlayOutcome(
        "active",
        snap({ status: "finished", outcome: null, winnerId: null }),
        YOU,
      ),
    ).toBe("draw");
  });

  it("none: direct load onto an already-finished race (prev is not active)", () => {
    expect(
      detectOverlayOutcome(
        "finished",
        snap({ status: "finished", outcome: "p1_win", winnerId: YOU }),
        YOU,
      ),
    ).toBe("none");
  });

  it("none: prev status null (never observed active)", () => {
    expect(
      detectOverlayOutcome(
        null,
        snap({ status: "finished", outcome: "p2_win", winnerId: OPP }),
        YOU,
      ),
    ).toBe("none");
  });

  it("none: still active (no transition yet)", () => {
    expect(
      detectOverlayOutcome("active", snap({ status: "active", outcome: null }), YOU),
    ).toBe("none");
  });

  it("none: non-terminal transitions (pending → ready etc.)", () => {
    expect(
      detectOverlayOutcome("pending", snap({ status: "ready" }), YOU),
    ).toBe("none");
  });

  // Forfeit outcomes: an active forfeit resolves via finishRace to a normal
  // p1_win/p2_win with status "finished" (not "aborted"), so it reads as a
  // plain victory/defeat here — the display layer varies the copy.
  it("forfeit victory: opponent forfeits, you win (finished, you are winner)", () => {
    expect(
      detectOverlayOutcome(
        "active",
        snap({ status: "finished", outcome: "p1_win", winnerId: YOU, submissions: [] }),
        YOU,
      ),
    ).toBe("victory");
  });

  it("forfeit defeat: you forfeit, opponent wins (finished, opponent is winner)", () => {
    expect(
      detectOverlayOutcome(
        "active",
        snap({ status: "finished", outcome: "p2_win", winnerId: OPP, submissions: [] }),
        YOU,
      ),
    ).toBe("defeat");
  });

  // Defensive: a race that reaches "aborted" from active with a winner still
  // maps to victory/defeat for the right viewer.
  it("aborted from active with a winner maps to victory/defeat", () => {
    expect(
      detectOverlayOutcome(
        "active",
        snap({ status: "aborted", outcome: "aborted", winnerId: OPP }),
        YOU,
      ),
    ).toBe("defeat");
  });
});

describe("winnerHasAcceptedSubmission", () => {
  it("ignores earlier wrong submissions when classifying a forfeit win", () => {
    expect(
      winnerHasAcceptedSubmission(YOU, [
        {
          userId: YOU,
          cfSubmissionId: 123,
          verdict: "WRONG_ANSWER",
          submittedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    ).toBe(false);
  });

  it("detects an accepted winner submission", () => {
    expect(
      winnerHasAcceptedSubmission(YOU, [
        {
          userId: YOU,
          cfSubmissionId: 123,
          verdict: "WRONG_ANSWER",
          submittedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          userId: YOU,
          cfSubmissionId: 124,
          verdict: "OK",
          submittedAt: "2026-01-01T00:01:00.000Z",
        },
      ]),
    ).toBe(true);
  });

  it("treats a null winner as unsolved for defensive draw rendering", () => {
    expect(
      winnerHasAcceptedSubmission(null, [
        {
          userId: YOU,
          cfSubmissionId: 124,
          verdict: "OK",
          submittedAt: "2026-01-01T00:01:00.000Z",
        },
      ]),
    ).toBe(false);
  });
});
