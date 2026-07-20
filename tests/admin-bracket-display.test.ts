/**
 * Tests for src/lib/admin/bracket-display.ts (issue #241) — pure display
 * helpers for the admin BracketPanel. No I/O.
 */

import { describe, expect, it } from "vitest";
import {
  defaultRatingRange,
  matchStatusBadge,
  playerLabel,
  roundLabel,
} from "@/lib/admin/bracket-display";
import type { TournamentMatchDTO, TournamentMatchPlayer } from "@/lib/types";

function makePlayer(overrides: Partial<TournamentMatchPlayer> = {}): TournamentMatchPlayer {
  return {
    userId: "user-1",
    username: "tourist",
    cfHandle: "tourist_cf",
    cfRating: 3500,
    seed: 1,
    ...overrides,
  };
}

function makeMatch(overrides: Partial<TournamentMatchDTO> = {}): TournamentMatchDTO {
  return {
    id: "match-1",
    round: 1,
    slot: 0,
    p1: makePlayer(),
    p2: makePlayer({ userId: "user-2", username: "benq", seed: 64 }),
    raceId: null,
    raceStatus: null,
    raceOutcome: null,
    winnerId: null,
    status: "pending",
    resolution: null,
    deadlineAt: null,
    ...overrides,
  };
}

describe("roundLabel", () => {
  it("maps rounds 1-6 to the standard bracket labels", () => {
    expect(roundLabel(1)).toBe("R64");
    expect(roundLabel(2)).toBe("R32");
    expect(roundLabel(3)).toBe("R16");
    expect(roundLabel(4)).toBe("QF");
    expect(roundLabel(5)).toBe("SF");
    expect(roundLabel(6)).toBe("F");
  });

  it("falls back to R{n} out of range", () => {
    expect(roundLabel(7)).toBe("R7");
    expect(roundLabel(0)).toBe("R0");
  });
});

describe("defaultRatingRange", () => {
  it("returns a widening window for known rounds", () => {
    expect(defaultRatingRange(1)).toEqual({ min: 800, max: 1200 });
    expect(defaultRatingRange(6)).toEqual({ min: 1800, max: 2400 });
  });

  it("returns a broad fallback for an unknown round", () => {
    expect(defaultRatingRange(99)).toEqual({ min: 800, max: 3500 });
  });
});

describe("playerLabel", () => {
  it("formats seed, username, and cfHandle", () => {
    expect(playerLabel(makePlayer())).toBe("1. tourist (tourist_cf)");
  });

  it("labels an unlinked handle explicitly", () => {
    expect(playerLabel(makePlayer({ cfHandle: null }))).toBe("1. tourist (unlinked)");
  });

  it("renders an em dash for an empty slot", () => {
    expect(playerLabel(null)).toBe("—");
  });
});

describe("matchStatusBadge", () => {
  it("labels a bye as Bye", () => {
    const badge = matchStatusBadge(makeMatch({ status: "done", resolution: "bye" }));
    expect(badge.label).toBe("Bye");
    expect(badge.variant).toBe("outline");
  });

  it("labels a done race/walkover match as Done", () => {
    expect(matchStatusBadge(makeMatch({ status: "done", resolution: "race" })).label).toBe(
      "Done",
    );
    expect(matchStatusBadge(makeMatch({ status: "done", resolution: "walkover" })).label).toBe(
      "Done",
    );
  });

  it("labels a pending match with no linked race as Awaiting race", () => {
    const badge = matchStatusBadge(makeMatch({ status: "pending", raceId: null }));
    expect(badge.label).toBe("Awaiting race");
  });

  it("labels a pending match with an aborted race as Needs attention", () => {
    const badge = matchStatusBadge(
      makeMatch({ status: "pending", raceId: "race-1", raceStatus: "aborted" }),
    );
    expect(badge.label).toBe("Needs attention");
  });

  it("labels a pending match with a drawn finished race as Needs attention", () => {
    const badge = matchStatusBadge(
      makeMatch({
        status: "pending",
        raceId: "race-1",
        raceStatus: "finished",
        raceOutcome: "draw",
      }),
    );
    expect(badge.label).toBe("Needs attention");
  });

  it("labels a pending match with an active linked race as Live", () => {
    const badge = matchStatusBadge(
      makeMatch({ status: "pending", raceId: "race-1", raceStatus: "active" }),
    );
    expect(badge.label).toBe("Live");
  });

  it("labels a pending match whose race finished with a winner as Live (awaiting resolve)", () => {
    const badge = matchStatusBadge(
      makeMatch({
        status: "pending",
        raceId: "race-1",
        raceStatus: "finished",
        raceOutcome: "p1_win",
      }),
    );
    expect(badge.label).toBe("Live");
  });
});
