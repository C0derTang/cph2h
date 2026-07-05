import { describe, it, expect } from "vitest";
import { formatOutcome, formatEloDelta } from "@/lib/format";

describe("format helpers", () => {
  describe("formatOutcome", () => {
    it("returns 'Pending' for null outcome", () => {
      expect(formatOutcome(null, true)).toBe("Pending");
      expect(formatOutcome(null, false)).toBe("Pending");
    });

    it("returns 'Draw' for draw outcome regardless of perspective", () => {
      expect(formatOutcome("draw", true)).toBe("Draw");
      expect(formatOutcome("draw", false)).toBe("Draw");
    });

    it("returns 'Aborted' for aborted outcome regardless of perspective", () => {
      expect(formatOutcome("aborted", true)).toBe("Aborted");
      expect(formatOutcome("aborted", false)).toBe("Aborted");
    });

    it("resolves p1_win by perspective", () => {
      expect(formatOutcome("p1_win", true)).toBe("Win");
      expect(formatOutcome("p1_win", false)).toBe("Loss");
    });

    it("resolves p2_win by perspective", () => {
      expect(formatOutcome("p2_win", true)).toBe("Loss");
      expect(formatOutcome("p2_win", false)).toBe("Win");
    });
  });

  describe("formatEloDelta", () => {
    it("returns '—' for null delta", () => {
      expect(formatEloDelta(null)).toBe("—");
    });

    it("returns '+X' for positive delta", () => {
      expect(formatEloDelta(0)).toBe("+0");
      expect(formatEloDelta(15)).toBe("+15");
      expect(formatEloDelta(100)).toBe("+100");
    });

    it("returns 'X' for negative delta (minus sign included)", () => {
      expect(formatEloDelta(-5)).toBe("-5");
      expect(formatEloDelta(-50)).toBe("-50");
    });
  });
});
