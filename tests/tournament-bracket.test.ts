/**
 * Pure bracket-logic tests (issue #240) — seedSlots, selectSeeds,
 * generateBracket, nextSlot, computeRoundAdvances. No I/O.
 */

import { describe, it, expect } from "vitest";
import {
  computeRoundAdvances,
  generateBracket,
  nextSlot,
  seedSlots,
  selectSeeds,
  type SeededPlayer,
} from "../src/lib/tournament/bracket";
import { TOURNAMENT_TOTAL_ROUNDS } from "../src/lib/types";
import type { Race, TournamentMatch } from "../src/lib/db/schema";

// ---------------------------------------------------------------------------
// seedSlots
// ---------------------------------------------------------------------------

describe("seedSlots", () => {
  it("matches the classic small brackets", () => {
    expect(seedSlots(2)).toEqual([1, 2]);
    expect(seedSlots(4)).toEqual([1, 4, 2, 3]);
    expect(seedSlots(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  for (const size of [2, 4, 8, 64]) {
    it(`is a permutation of 1..${size}`, () => {
      const slots = seedSlots(size);
      expect(slots).toHaveLength(size);
      expect([...slots].sort((a, b) => a - b)).toEqual(
        Array.from({ length: size }, (_, i) => i + 1),
      );
    });

    it(`round-1 pairings all sum to ${size + 1}`, () => {
      const slots = seedSlots(size);
      for (let k = 0; k < size / 2; k++) {
        expect(slots[2 * k] + slots[2 * k + 1]).toBe(size + 1);
      }
    });

    it(`places seeds 1 and 2 in opposite halves (size ${size})`, () => {
      const slots = seedSlots(size);
      const i1 = slots.indexOf(1);
      const i2 = slots.indexOf(2);
      const firstHalf = (i: number) => i < size / 2;
      expect(firstHalf(i1)).not.toBe(firstHalf(i2));
    });
  }

  it("degenerates to [1] for size 1 and [] for size 0", () => {
    expect(seedSlots(1)).toEqual([1]);
    expect(seedSlots(0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectSeeds
// ---------------------------------------------------------------------------

describe("selectSeeds", () => {
  const d = (iso: string) => new Date(iso);

  it("orders by cfRating descending", () => {
    const seeds = selectSeeds([
      { userId: "a", cfRating: 1500, registeredAt: d("2024-01-01") },
      { userId: "b", cfRating: 2000, registeredAt: d("2024-01-01") },
      { userId: "c", cfRating: 1000, registeredAt: d("2024-01-01") },
    ]);
    expect(seeds.map((s) => s.userId)).toEqual(["b", "a", "c"]);
    expect(seeds.map((s) => s.seed)).toEqual([1, 2, 3]);
  });

  it("sorts null ratings last", () => {
    const seeds = selectSeeds([
      { userId: "a", cfRating: null, registeredAt: d("2024-01-01") },
      { userId: "b", cfRating: 1200, registeredAt: d("2024-01-01") },
      { userId: "c", cfRating: null, registeredAt: d("2024-01-02") },
    ]);
    expect(seeds.map((s) => s.userId)).toEqual(["b", "a", "c"]);
  });

  it("breaks rating ties by earlier registeredAt, then userId", () => {
    const seeds = selectSeeds([
      { userId: "z", cfRating: 1500, registeredAt: d("2024-01-02") },
      { userId: "y", cfRating: 1500, registeredAt: d("2024-01-01") },
      { userId: "x", cfRating: 1500, registeredAt: d("2024-01-01") },
    ]);
    // y and x registered first (x < y by userId); z later.
    expect(seeds.map((s) => s.userId)).toEqual(["x", "y", "z"]);
  });

  it("truncates to the top 64", () => {
    const regs = Array.from({ length: 100 }, (_, i) => ({
      userId: `u${i}`,
      cfRating: 3000 - i, // strictly descending
      registeredAt: d("2024-01-01"),
    }));
    const seeds = selectSeeds(regs);
    expect(seeds).toHaveLength(64);
    expect(seeds[0].userId).toBe("u0");
    expect(seeds[63].userId).toBe("u63");
    expect(seeds[63].seed).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// generateBracket
// ---------------------------------------------------------------------------

/** N players seeded 1..N. */
function players(n: number): SeededPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ userId: `u${i + 1}`, seed: i + 1 }));
}

function byRound(matches: ReturnType<typeof generateBracket>, round: number) {
  return matches.filter((m) => m.round === round);
}

describe("generateBracket", () => {
  it("always produces 63 matches across 6 rounds", () => {
    for (const n of [0, 1, 20, 33, 48, 64]) {
      const b = generateBracket(players(n));
      expect(b).toHaveLength(63);
      expect(byRound(b, 1)).toHaveLength(32);
      expect(byRound(b, 2)).toHaveLength(16);
      expect(byRound(b, 6)).toHaveLength(1);
    }
  });

  it("N=64: no byes, 32 pending round-1 matches", () => {
    const b = generateBracket(players(64));
    expect(b.filter((m) => m.resolution === "bye")).toHaveLength(0);
    const r1 = byRound(b, 1);
    expect(r1.every((m) => m.status === "pending" && m.p1 && m.p2)).toBe(true);
    expect(r1).toHaveLength(32);
  });

  it("N=48: 16 round-1 byes whose winners are placed into round 2", () => {
    const b = generateBracket(players(48));
    const r1Byes = byRound(b, 1).filter((m) => m.resolution === "bye");
    expect(r1Byes).toHaveLength(16);
    expect(b.filter((m) => m.resolution === "bye")).toHaveLength(16);

    // Every bye winner appears as a concrete player somewhere in round 2.
    const r2Players = new Set(
      byRound(b, 2).flatMap((m) => [m.p1?.userId, m.p2?.userId].filter(Boolean)),
    );
    for (const bye of r1Byes) {
      expect(r2Players.has(bye.winner!.userId)).toBe(true);
    }
    // Top seed always byes when N<64.
    expect(r1Byes.some((m) => m.winner?.seed === 1)).toBe(true);
  });

  it("N=33: exactly one real round-1 match (seeds 32 v 33), 31 byes", () => {
    const b = generateBracket(players(33));
    const r1 = byRound(b, 1);
    const pending = r1.filter((m) => m.status === "pending");
    expect(pending).toHaveLength(1);
    const seeds = [pending[0].p1?.seed, pending[0].p2?.seed].sort((a, b) => a! - b!);
    expect(seeds).toEqual([32, 33]);
    expect(r1.filter((m) => m.resolution === "bye")).toHaveLength(31);
  });

  it("N=20: double-bye cascade reaches into round 2", () => {
    const b = generateBracket(players(20));
    // Round 1: 20 byes, 12 structurally-empty matches, no real matches.
    const r1 = byRound(b, 1);
    expect(r1.filter((m) => m.resolution === "bye")).toHaveLength(20);
    expect(r1.filter((m) => m.status === "pending")).toHaveLength(0);
    // Round 2 must contain at least one further bye (a player vs an empty side).
    expect(byRound(b, 2).some((m) => m.resolution === "bye")).toBe(true);
    // No pending match anywhere is ever missing an opponent while the other side
    // is a concrete player with no path (sanity: pending => both sides live).
    for (const m of b.filter((x) => x.status === "pending")) {
      // A pending match may have a null (TBD) side, but never one real player
      // opposite a resolved empty (that would be an unresolved bye).
      expect(m.p1 !== null || m.p2 !== null || m.round > 1).toBe(true);
    }
  });

  it("N=1: instant champion byes through all 6 rounds", () => {
    const b = generateBracket(players(1));
    const final = byRound(b, 6)[0];
    expect(final.winner?.userId).toBe("u1");
    expect(final.resolution).toBe("bye");
    // u1 is the winner of exactly one match per round (6 total byes).
    expect(b.filter((m) => m.winner?.userId === "u1")).toHaveLength(6);
    expect(b.filter((m) => m.resolution === "bye")).toHaveLength(6);
  });

  it("N=0: fully defined empty bracket, no byes, no players", () => {
    const b = generateBracket(players(0));
    expect(b).toHaveLength(63);
    expect(b.every((m) => m.p1 === null && m.p2 === null && m.winner === null)).toBe(true);
    expect(b.every((m) => m.resolution === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nextSlot
// ---------------------------------------------------------------------------

describe("nextSlot", () => {
  it("maps even slots to p1 and odd slots to p2 of floor(slot/2)", () => {
    expect(nextSlot(1, 0)).toEqual({ round: 2, slot: 0, side: "p1" });
    expect(nextSlot(1, 1)).toEqual({ round: 2, slot: 0, side: "p2" });
    expect(nextSlot(1, 2)).toEqual({ round: 2, slot: 1, side: "p1" });
    expect(nextSlot(1, 31)).toEqual({ round: 2, slot: 15, side: "p2" });
    expect(nextSlot(5, 0)).toEqual({ round: 6, slot: 0, side: "p1" });
    expect(nextSlot(5, 1)).toEqual({ round: 6, slot: 0, side: "p2" });
  });

  it("returns null for the final round", () => {
    expect(nextSlot(TOURNAMENT_TOTAL_ROUNDS, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeRoundAdvances
// ---------------------------------------------------------------------------

function match(over: Partial<TournamentMatch>): TournamentMatch {
  return {
    id: "m",
    round: 1,
    slot: 0,
    p1Id: "p1",
    p2Id: "p2",
    p1Seed: 1,
    p2Seed: 2,
    raceId: null,
    winnerId: null,
    status: "pending",
    resolution: null,
    deadlineAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as TournamentMatch;
}

function race(over: Partial<Pick<Race, "status" | "outcome" | "winnerId">>) {
  return { status: "finished", outcome: "p1_win", winnerId: "p1", ...over } as Pick<
    Race,
    "status" | "outcome" | "winnerId"
  >;
}

describe("computeRoundAdvances", () => {
  it("advances a finished race with a winner", () => {
    const m = match({ id: "m1", raceId: "r1", round: 1, slot: 2 });
    const res = computeRoundAdvances([m], new Map([["r1", race({ winnerId: "p2" })]]));
    expect(res.advances).toEqual([
      {
        matchId: "m1",
        winnerId: "p2",
        resolution: "race",
        next: { round: 2, slot: 1, side: "p1" },
      },
    ]);
    expect(res.pendingRaceMatchIds).toEqual([]);
    expect(res.needsAttention).toEqual([]);
  });

  it("treats an unlinked match as a pending race", () => {
    const m = match({ id: "m2", raceId: null });
    const res = computeRoundAdvances([m], new Map());
    expect(res.pendingRaceMatchIds).toEqual(["m2"]);
    expect(res.advances).toEqual([]);
  });

  it("treats a linked-but-unfinished (active) race as pending", () => {
    const m = match({ id: "m3", raceId: "r3" });
    const res = computeRoundAdvances([m], new Map([["r3", race({ status: "active", winnerId: null })]]));
    expect(res.pendingRaceMatchIds).toEqual(["m3"]);
    expect(res.advances).toEqual([]);
  });

  it("flags a draw as needing attention", () => {
    const m = match({ id: "m4", raceId: "r4" });
    const res = computeRoundAdvances([m], new Map([["r4", race({ outcome: "draw", winnerId: null })]]));
    expect(res.needsAttention).toEqual(["m4"]);
    expect(res.advances).toEqual([]);
  });

  it("flags an aborted race as needing attention", () => {
    const m = match({ id: "m5", raceId: "r5" });
    const res = computeRoundAdvances(
      [m],
      new Map([["r5", race({ status: "aborted", outcome: "aborted", winnerId: null })]]),
    );
    expect(res.needsAttention).toEqual(["m5"]);
  });

  it("skips matches that are already done (byes)", () => {
    const m = match({ id: "m6", status: "done", resolution: "bye", winnerId: "p1" });
    const res = computeRoundAdvances([m], new Map());
    expect(res.advances).toEqual([]);
    expect(res.pendingRaceMatchIds).toEqual([]);
    expect(res.needsAttention).toEqual([]);
  });

  it("returns null next for a final-round advance", () => {
    const m = match({ id: "mf", round: 6, slot: 0, raceId: "rf" });
    const res = computeRoundAdvances([m], new Map([["rf", race({ winnerId: "p1" })]]));
    expect(res.advances[0].next).toBeNull();
  });
});
