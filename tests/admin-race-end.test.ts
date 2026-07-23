/**
 * Tests for src/lib/admin/race-end.ts (issue #296).
 *
 * Pure decision logic — every branch of `decideAdminRaceEnd` is exercised
 * without any DB. The load-bearing invariants: a terminal race rejects BOTH
 * actions with 409; declare_winner only resolves against an active race and
 * only for a valid winner id.
 */

import { describe, expect, it } from "vitest";
import { decideAdminRaceEnd, type AdminEndRequest } from "@/lib/admin/race-end";
import type { Race } from "@/lib/db/schema";

type RaceSubset = Pick<Race, "status" | "p1Id" | "p2Id">;

function race(overrides: Partial<RaceSubset> = {}): RaceSubset {
  return { status: "active", p1Id: "p1", p2Id: "p2", ...overrides };
}

const abort: AdminEndRequest = { action: "abort" };
const declareP1: AdminEndRequest = { action: "declare_winner", winnerId: "p1" };
const declareP2: AdminEndRequest = { action: "declare_winner", winnerId: "p2" };

describe("decideAdminRaceEnd — terminal races", () => {
  for (const status of ["finished", "aborted"] as const) {
    it(`rejects abort on a ${status} race with already_terminal (409)`, () => {
      expect(decideAdminRaceEnd(race({ status }), abort)).toEqual({
        kind: "reject",
        reason: "already_terminal",
        http: 409,
      });
    });

    it(`rejects declare_winner on a ${status} race with already_terminal (409)`, () => {
      expect(decideAdminRaceEnd(race({ status }), declareP1)).toEqual({
        kind: "reject",
        reason: "already_terminal",
        http: 409,
      });
    });
  }
});

describe("decideAdminRaceEnd — abort", () => {
  for (const status of ["pending", "ready", "active"] as const) {
    it(`aborts a ${status} race`, () => {
      expect(decideAdminRaceEnd(race({ status }), abort)).toEqual({ kind: "abort" });
    });
  }
});

describe("decideAdminRaceEnd — declare_winner", () => {
  it("rejects declare_winner on a pending race with not_active (409)", () => {
    expect(decideAdminRaceEnd(race({ status: "pending" }), declareP1)).toEqual({
      kind: "reject",
      reason: "not_active",
      http: 409,
    });
  });

  it("rejects declare_winner on a ready race with not_active (409)", () => {
    expect(decideAdminRaceEnd(race({ status: "ready" }), declareP1)).toEqual({
      kind: "reject",
      reason: "not_active",
      http: 409,
    });
  });

  it("finishes as p1_win when winnerId === p1Id", () => {
    expect(decideAdminRaceEnd(race(), declareP1)).toEqual({
      kind: "finish",
      outcome: "p1_win",
      winnerId: "p1",
    });
  });

  it("finishes as p2_win when winnerId === p2Id", () => {
    expect(decideAdminRaceEnd(race(), declareP2)).toEqual({
      kind: "finish",
      outcome: "p2_win",
      winnerId: "p2",
    });
  });

  it("rejects invalid_winner (400) for a winnerId matching neither player", () => {
    expect(
      decideAdminRaceEnd(race(), { action: "declare_winner", winnerId: "stranger" }),
    ).toEqual({ kind: "reject", reason: "invalid_winner", http: 400 });
  });

  it("rejects invalid_winner (400) when winnerId equals a NULL p2Id", () => {
    // p2Id is null and the request's winnerId is (say) the empty string via a
    // stray value; a null p2 can never be the winner.
    expect(
      decideAdminRaceEnd(race({ p2Id: null }), {
        action: "declare_winner",
        winnerId: "p2",
      }),
    ).toEqual({ kind: "reject", reason: "invalid_winner", http: 400 });
  });

  it("still allows p1 as winner when p2Id is null", () => {
    expect(decideAdminRaceEnd(race({ p2Id: null }), declareP1)).toEqual({
      kind: "finish",
      outcome: "p1_win",
      winnerId: "p1",
    });
  });
});
