import { describe, it, expect } from "vitest";
import { formatOutcome, formatEloDelta } from "./format";

describe("format helpers", () => {
  describe("formatOutcome", () => {
    it("returns 'Pending' for null outcome", () => {
      expect(formatOutcome(null)).toBe("Pending");
    });

    it("returns 'Draw' for draw outcome", () => {
      expect(formatOutcome("draw")).toBe("Draw");
    });

    it("returns 'Unknown' for win outcomes (caller determines perspective)", () => {
      expect(formatOutcome("p1_win")).toBe("Unknown");
      expect(formatOutcome("p2_win")).toBe("Unknown");
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
