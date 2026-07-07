/**
 * Tests for src/lib/audio/transitions.ts — the pure race-audio transition
 * detector `detectAudioTransitions(prev, next, youId)`.
 */

import { describe, it, expect } from "vitest";
import { detectAudioTransitions } from "../src/lib/audio/transitions";
import type { PublicUser, RaceSnapshot, RaceSubmissionInfo } from "../src/lib/types";

const YOU = "user-you";
const OPPONENT = "user-opponent";

function user(id: string, overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id,
    username: id,
    cfHandle: null,
    cfRating: null,
    elo: 1200,
    racesPlayed: 0,
    ...overrides,
  };
}

/** A fully-populated `RaceSnapshot`; tests override only what they need. */
function baseSnapshot(overrides: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return {
    id: "race-1",
    now: "2026-01-01T00:00:00.000Z",
    status: "pending",
    p1: user(YOU),
    p2: null,
    p1Ready: false,
    p2Ready: false,
    timeLimitSec: 2400,
    startedAt: null,
    endsAt: null,
    finishedAt: null,
    outcome: null,
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

function submission(overrides: Partial<RaceSubmissionInfo> = {}): RaceSubmissionInfo {
  return {
    userId: YOU,
    cfSubmissionId: 1,
    verdict: null,
    submittedAt: "2026-01-01T00:05:00.000Z",
    ...overrides,
  };
}

describe("detectAudioTransitions — no-op cases", () => {
  it("returns [] when prev is null (first-ever snapshot, no transition to detect)", () => {
    const next = baseSnapshot({ status: "finished", winnerId: YOU });
    expect(detectAudioTransitions(null, next, YOU)).toEqual([]);
  });

  it("returns [] for identical (no-repeat) snapshots", () => {
    const snap = baseSnapshot({ status: "ready", p2: user(OPPONENT) });
    expect(detectAudioTransitions(snap, snap, YOU)).toEqual([]);
  });

  it("returns [] for an unrelated field change with no audio-relevant transition", () => {
    const prev = baseSnapshot({ p1Ready: false });
    const next = baseSnapshot({ p1Ready: true });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual([]);
  });
});

describe("detectAudioTransitions — opponent_joined", () => {
  it("fires when p2 transitions from absent to present", () => {
    const prev = baseSnapshot({ p2: null });
    const next = baseSnapshot({ p2: user(OPPONENT) });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual(["opponent_joined"]);
  });

  it("does not re-fire once p2 is already present", () => {
    const prev = baseSnapshot({ p2: user(OPPONENT) });
    const next = baseSnapshot({ p2: user(OPPONENT), p2Ready: true });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual([]);
  });
});

describe("detectAudioTransitions — race_start (countdown boundary)", () => {
  it("fires when the countdown (per each snapshot's own `now`) crosses startedAt", () => {
    const startedAt = "2026-01-01T00:00:10.000Z";
    const prev = baseSnapshot({
      status: "active",
      startedAt,
      now: "2026-01-01T00:00:05.000Z", // still counting down
    });
    const next = baseSnapshot({
      status: "active",
      startedAt,
      now: "2026-01-01T00:00:10.500Z", // countdown just ended
    });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual(["race_start"]);
  });

  it("fires when the race jumps straight from ready to already-past-countdown active", () => {
    const startedAt = "2026-01-01T00:00:10.000Z";
    const prev = baseSnapshot({ status: "ready", startedAt: null });
    const next = baseSnapshot({
      status: "active",
      startedAt,
      now: "2026-01-01T00:00:11.000Z",
    });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual(["race_start"]);
  });

  it("does not fire while still counting down", () => {
    const startedAt = "2026-01-01T00:00:10.000Z";
    const prev = baseSnapshot({ status: "active", startedAt, now: "2026-01-01T00:00:03.000Z" });
    const next = baseSnapshot({ status: "active", startedAt, now: "2026-01-01T00:00:06.000Z" });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual([]);
  });

  it("does not re-fire on a later post-countdown snapshot", () => {
    const startedAt = "2026-01-01T00:00:10.000Z";
    const prev = baseSnapshot({ status: "active", startedAt, now: "2026-01-01T00:00:11.000Z" });
    const next = baseSnapshot({ status: "active", startedAt, now: "2026-01-01T00:00:20.000Z" });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual([]);
  });
});

describe("detectAudioTransitions — verdict_ok / verdict_fail", () => {
  it("fires verdict_ok for a newly-resolved OK submission", () => {
    const prev = baseSnapshot({ status: "active", submissions: [] });
    const next = baseSnapshot({
      status: "active",
      submissions: [submission({ verdict: "OK" })],
    });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual(["verdict_ok"]);
  });

  it("fires verdict_fail for a newly-resolved non-OK submission", () => {
    const prev = baseSnapshot({ status: "active", submissions: [] });
    const next = baseSnapshot({
      status: "active",
      submissions: [submission({ verdict: "WRONG_ANSWER" })],
    });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual(["verdict_fail"]);
  });

  it("fires when a pending submission resolves to a verdict", () => {
    const prev = baseSnapshot({
      status: "active",
      submissions: [submission({ verdict: null })],
    });
    const next = baseSnapshot({
      status: "active",
      submissions: [submission({ verdict: "OK" })],
    });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual(["verdict_ok"]);
  });

  it("does not re-fire for an already-announced verdict", () => {
    const prev = baseSnapshot({
      status: "active",
      submissions: [submission({ verdict: "OK" })],
    });
    const next = baseSnapshot({
      status: "active",
      submissions: [submission({ verdict: "OK" })],
    });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual([]);
  });

  it("fires once per newly-resolved submission when several land in one diff", () => {
    const prev = baseSnapshot({ status: "active", submissions: [] });
    const next = baseSnapshot({
      status: "active",
      submissions: [
        submission({ userId: YOU, cfSubmissionId: 1, verdict: "WRONG_ANSWER" }),
        submission({ userId: OPPONENT, cfSubmissionId: 2, verdict: "OK" }),
      ],
    });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual(["verdict_fail", "verdict_ok"]);
  });
});

describe("detectAudioTransitions — finish (win / lose / draw / abort)", () => {
  it("fires win when the viewer is the winner", () => {
    const prev = baseSnapshot({ status: "active" });
    const next = baseSnapshot({ status: "finished", outcome: "p1_win", winnerId: YOU });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual(["win"]);
  });

  it("fires lose when the opponent is the winner", () => {
    const prev = baseSnapshot({ status: "active" });
    const next = baseSnapshot({ status: "finished", outcome: "p2_win", winnerId: OPPONENT });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual(["lose"]);
  });

  it("fires nothing extra for a draw", () => {
    const prev = baseSnapshot({ status: "active" });
    const next = baseSnapshot({ status: "finished", outcome: "draw", winnerId: null });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual([]);
  });

  it("fires nothing for an aborted race", () => {
    const prev = baseSnapshot({ status: "active" });
    const next = baseSnapshot({ status: "aborted", outcome: "aborted", winnerId: null });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual([]);
  });

  it("does not re-fire once already finished", () => {
    const prev = baseSnapshot({ status: "finished", outcome: "p1_win", winnerId: YOU });
    const next = baseSnapshot({ status: "finished", outcome: "p1_win", winnerId: YOU });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual([]);
  });

  it("combines with a final verdict landing in the same diff", () => {
    const prev = baseSnapshot({ status: "active", submissions: [] });
    const next = baseSnapshot({
      status: "finished",
      outcome: "p1_win",
      winnerId: YOU,
      submissions: [submission({ verdict: "OK" })],
    });
    expect(detectAudioTransitions(prev, next, YOU)).toEqual(["verdict_ok", "win"]);
  });
});
