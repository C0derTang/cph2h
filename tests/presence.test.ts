/**
 * Tests for src/lib/race/presence.ts — the pure absence-forfeit math shared by
 * the server's authoritative forfeit decision and the client countdown banner.
 */

import { describe, it, expect } from "vitest";
import {
  ABSENCE_COUNTDOWN_AFTER_SEC,
  absenceSecondsRemaining,
  effectiveLastSeenMs,
  isAbsenceForfeit,
  shouldShowAbsenceCountdown,
} from "../src/lib/race/presence";
import { ABSENCE_FORFEIT_SEC } from "../src/lib/types";

const START = 1_000_000_000_000; // arbitrary ms epoch for `startedAt`
const sec = (n: number) => n * 1000;

describe("effectiveLastSeenMs", () => {
  it("floors a null heartbeat at startedAt (opponent hasn't polled yet)", () => {
    expect(effectiveLastSeenMs(null, START)).toBe(START);
  });

  it("floors a heartbeat older than startedAt at startedAt", () => {
    expect(effectiveLastSeenMs(START - sec(30), START)).toBe(START);
  });

  it("passes through a heartbeat after startedAt", () => {
    expect(effectiveLastSeenMs(START + sec(12), START)).toBe(START + sec(12));
  });
});

describe("isAbsenceForfeit (server decision)", () => {
  it("does not forfeit during the countdown (now before startedAt)", () => {
    // Even with a null heartbeat, nothing forfeits until the race has begun.
    expect(isAbsenceForfeit(null, START, START - sec(1))).toBe(false);
  });

  it("does not forfeit within the grace window from startedAt (null heartbeat)", () => {
    const now = START + sec(ABSENCE_FORFEIT_SEC); // exactly at the edge, not past
    expect(isAbsenceForfeit(null, START, now)).toBe(false);
  });

  it("forfeits once the opponent has been absent strictly past the grace window", () => {
    const now = START + sec(ABSENCE_FORFEIT_SEC) + 1;
    expect(isAbsenceForfeit(null, START, now)).toBe(true);
  });

  it("does not forfeit a recently-seen opponent (refresh gap)", () => {
    const lastSeen = START + sec(100);
    const now = lastSeen + sec(8); // an 8s refresh gap
    expect(isAbsenceForfeit(lastSeen, START, now)).toBe(false);
  });

  it("measures grace from the last heartbeat, not from startedAt", () => {
    const lastSeen = START + sec(200);
    const now = lastSeen + sec(ABSENCE_FORFEIT_SEC) + sec(1);
    expect(isAbsenceForfeit(lastSeen, START, now)).toBe(true);
  });

  it("gives the opponent the full grace from startedAt before their first poll", () => {
    // null heartbeat but 45s in — still inside the startedAt-floored window.
    expect(isAbsenceForfeit(null, START, START + sec(45))).toBe(false);
  });
});

describe("absenceSecondsRemaining (display)", () => {
  it("is the full grace at the moment of the last heartbeat", () => {
    const lastSeen = START + sec(30);
    expect(absenceSecondsRemaining(lastSeen, START, lastSeen)).toBe(
      ABSENCE_FORFEIT_SEC,
    );
  });

  it("counts down as the heartbeat ages", () => {
    const lastSeen = START + sec(30);
    const now = lastSeen + sec(20);
    expect(absenceSecondsRemaining(lastSeen, START, now)).toBe(
      ABSENCE_FORFEIT_SEC - 20,
    );
  });

  it("clamps to 0 once past the grace window", () => {
    const now = START + sec(ABSENCE_FORFEIT_SEC) + sec(5);
    expect(absenceSecondsRemaining(null, START, now)).toBe(0);
  });

  it("never exceeds the grace window (heartbeat in the future / skew)", () => {
    const now = START + sec(5);
    const lastSeen = START + sec(20); // ahead of now
    expect(absenceSecondsRemaining(lastSeen, START, now)).toBe(
      ABSENCE_FORFEIT_SEC,
    );
  });
});

describe("shouldShowAbsenceCountdown (client escalation gate)", () => {
  it("stays hidden for a short heartbeat gap (ordinary refresh)", () => {
    const lastSeen = START + sec(100);
    const now = lastSeen + sec(ABSENCE_COUNTDOWN_AFTER_SEC - 5);
    expect(shouldShowAbsenceCountdown(lastSeen, START, now)).toBe(false);
  });

  it("escalates once the heartbeat is stale past the threshold", () => {
    const lastSeen = START + sec(100);
    const now = lastSeen + sec(ABSENCE_COUNTDOWN_AFTER_SEC);
    expect(shouldShowAbsenceCountdown(lastSeen, START, now)).toBe(true);
  });

  it("never shows during the countdown", () => {
    expect(shouldShowAbsenceCountdown(null, START, START - sec(1))).toBe(false);
  });

  it("shows a countdown window strictly inside the grace window", () => {
    // The threshold must be below the grace so a live countdown is visible.
    expect(ABSENCE_COUNTDOWN_AFTER_SEC).toBeLessThan(ABSENCE_FORFEIT_SEC);
  });
});
