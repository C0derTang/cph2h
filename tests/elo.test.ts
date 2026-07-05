/**
 * Tests for src/lib/elo.ts
 */

import { describe, it, expect } from "vitest";
import { expectedScore, kFor, applyResult } from "../src/lib/elo";

describe("elo", () => {
  describe("expectedScore", () => {
    it("should return 0.5 for equal ratings", () => {
      const score = expectedScore(1200, 1200);
      expect(score).toBeCloseTo(0.5, 5);
    });

    it("should return higher score for higher-rated player", () => {
      const score1 = expectedScore(1400, 1200);
      const score2 = expectedScore(1200, 1400);
      expect(score1).toBeGreaterThan(0.5);
      expect(score2).toBeLessThan(0.5);
      expect(score1 + score2).toBeCloseTo(1, 5);
    });

    it("should handle large rating differences", () => {
      const score = expectedScore(2000, 1000);
      expect(score).toBeGreaterThan(0.9);
      expect(score).toBeLessThan(1);
    });

    it("should satisfy symmetry: exp(a,b) + exp(b,a) = 1", () => {
      const a = 1200;
      const b = 1500;
      const expAB = expectedScore(a, b);
      const expBA = expectedScore(b, a);
      expect(expAB + expBA).toBeCloseTo(1, 5);
    });
  });

  describe("kFor", () => {
    it("should return ELO_K_PROVISIONAL (64) for racesPlayed < 10", () => {
      expect(kFor(0)).toBe(64);
      expect(kFor(1)).toBe(64);
      expect(kFor(9)).toBe(64);
    });

    it("should return ELO_K_STANDARD (32) for racesPlayed >= 10", () => {
      expect(kFor(10)).toBe(32);
      expect(kFor(11)).toBe(32);
      expect(kFor(100)).toBe(32);
    });

    it("should transition at exactly 10 races", () => {
      expect(kFor(9)).toBe(64);
      expect(kFor(10)).toBe(32);
    });
  });

  describe("applyResult", () => {
    it("should return {0, 0} for aborted races", () => {
      const result = applyResult(
        { elo: 1200, racesPlayed: 0 },
        { elo: 1200, racesPlayed: 0 },
        "aborted"
      );
      expect(result).toEqual({ d1: 0, d2: 0 });
    });

    it("should give ±16 when equal-rated players play with standard K (32)", () => {
      const result = applyResult(
        { elo: 1200, racesPlayed: 10 },
        { elo: 1200, racesPlayed: 10 },
        "p1_win"
      );
      expect(result.d1).toBe(16);
      expect(result.d2).toBe(-16);
    });

    it("should use ELO_K_PROVISIONAL (64) for players with < 10 races", () => {
      const result = applyResult(
        { elo: 1200, racesPlayed: 0 },
        { elo: 1200, racesPlayed: 10 },
        "p1_win"
      );
      // p1 uses K=64, p2 uses K=32
      // exp1 = 0.5, exp2 = 0.5
      // d1 = 64 * (1 - 0.5) = 32
      // d2 = 32 * (0 - 0.5) = -16
      expect(result.d1).toBe(32);
      expect(result.d2).toBe(-16);
    });

    it("should handle draws (0.5 points each)", () => {
      const result = applyResult(
        { elo: 1200, racesPlayed: 10 },
        { elo: 1200, racesPlayed: 10 },
        "draw"
      );
      // exp1 = 0.5, exp2 = 0.5
      // d1 = 32 * (0.5 - 0.5) = 0
      // d2 = 32 * (0.5 - 0.5) = 0
      expect(result.d1).toBe(0);
      expect(result.d2).toBe(0);
    });

    it("should move ratings toward each other in unequal draw", () => {
      const result = applyResult(
        { elo: 1000, racesPlayed: 10 },
        { elo: 1400, racesPlayed: 10 },
        "draw"
      );
      // Lower-rated player gains, higher-rated player loses
      expect(result.d1).toBeGreaterThan(0);
      expect(result.d2).toBeLessThan(0);
    });

    it("should satisfy symmetry: d1 = -d2 for same K non-draw", () => {
      const result = applyResult(
        { elo: 1200, racesPlayed: 10 },
        { elo: 1200, racesPlayed: 10 },
        "p1_win"
      );
      expect(result.d1).toBe(-result.d2);
    });

    it("should round deltas", () => {
      // Create a scenario that produces fractional deltas
      const result = applyResult(
        { elo: 1200, racesPlayed: 10 },
        { elo: 1208, racesPlayed: 10 },
        "p1_win"
      );
      // Both deltas should be integers
      expect(Number.isInteger(result.d1)).toBe(true);
      expect(Number.isInteger(result.d2)).toBe(true);
    });

    it("should clamp delta to not drop below ELO_FLOOR (100)", () => {
      const result = applyResult(
        { elo: 100, racesPlayed: 10 },
        { elo: 1200, racesPlayed: 10 },
        "p2_win"
      );
      // p1 loses, but can't go below 100
      const newElo = 100 + result.d1;
      expect(newElo).toBeGreaterThanOrEqual(100);
    });

    it("should clamp delta when player at floor loses to massive rating gap", () => {
      const result = applyResult(
        { elo: 100, racesPlayed: 10 },
        { elo: 2000, racesPlayed: 10 },
        "p2_win"
      );
      // p1 at floor loses, delta should be clamped to 0
      expect(result.d1).toBe(0);
      expect(100 + result.d1).toBeGreaterThanOrEqual(100);
    });

    it("should allow positive delta even at floor", () => {
      const result = applyResult(
        { elo: 100, racesPlayed: 10 },
        { elo: 1200, racesPlayed: 10 },
        "p1_win"
      );
      // p1 wins against higher-rated, should gain points
      expect(result.d1).toBeGreaterThan(0);
    });

    it("should handle p2_win outcome", () => {
      const result = applyResult(
        { elo: 1200, racesPlayed: 10 },
        { elo: 1200, racesPlayed: 10 },
        "p2_win"
      );
      expect(result.d1).toBe(-16);
      expect(result.d2).toBe(16);
    });

    it("should handle both players in provisional phase", () => {
      const result = applyResult(
        { elo: 1200, racesPlayed: 5 },
        { elo: 1200, racesPlayed: 8 },
        "p1_win"
      );
      // Both use K=64
      // exp1 = 0.5, exp2 = 0.5
      // d1 = 64 * (1 - 0.5) = 32
      // d2 = 64 * (0 - 0.5) = -32
      expect(result.d1).toBe(32);
      expect(result.d2).toBe(-32);
    });

    it("should preserve symmetry when K values differ", () => {
      const result = applyResult(
        { elo: 1200, racesPlayed: 5 },
        { elo: 1200, racesPlayed: 10 },
        "p1_win"
      );
      // p1 uses K=64, p2 uses K=32
      // d1 = 64 * (1 - 0.5) = 32
      // d2 = 32 * (0 - 0.5) = -16
      expect(result.d1).toBe(32);
      expect(result.d2).toBe(-16);
      // They should not be equal (asymmetric K)
      expect(result.d1).not.toBe(-result.d2);
    });

    it("should handle provisional player with much higher rating", () => {
      const result = applyResult(
        { elo: 1500, racesPlayed: 5 },
        { elo: 1000, racesPlayed: 10 },
        "p1_win"
      );
      // Provisional player (K=64) wins against lower-rated: gain with provisional K
      // Expected score for 1500 vs 1000 = ~0.91
      // Delta = 64 * (1 - 0.91) = ~5.7
      expect(result.d1).toBeGreaterThan(0);
      // Lower-rated player (K=32) loses
      expect(result.d2).toBeLessThan(0);
    });

    it("should handle provisional player with much lower rating winning", () => {
      const result = applyResult(
        { elo: 1000, racesPlayed: 5 },
        { elo: 2000, racesPlayed: 10 },
        "p1_win"
      );
      // Provisional low-rated wins upset: large gain
      expect(result.d1).toBeGreaterThan(32);
      // High-rated loses: large loss
      expect(result.d2).toBeLessThan(-16);
    });

    it("should clamp delta for two provisional players at floor losing", () => {
      // Two PROVISIONAL players both at ELO_FLOOR (100), K=64
      // p1 loses to p2
      const result = applyResult(
        { elo: 100, racesPlayed: 5 }, // p1: provisional, at floor
        { elo: 100, racesPlayed: 8 }, // p2: provisional, at floor
        "p2_win"
      );
      // exp1 = 0.5, exp2 = 0.5 (equal ratings)
      // rawD1 = 64 * (0 - 0.5) = -32
      // rawD2 = 64 * (1 - 0.5) = 32
      // d1 = round(-32) = -32
      // d2 = round(32) = 32
      // clampedD1 = max(-32, 100 - 100) = max(-32, 0) = 0
      // clampedD2 = max(32, 100 - 100) = max(32, 0) = 32
      expect(result.d1).toBe(0); // clamped from -32 to 0
      expect(result.d2).toBe(32);
      // Verify final ratings stay >= ELO_FLOOR
      expect(100 + result.d1).toBeGreaterThanOrEqual(100);
      expect(100 + result.d2).toBeGreaterThanOrEqual(100);
    });
  });
});
