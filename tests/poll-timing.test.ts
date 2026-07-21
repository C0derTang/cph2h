/**
 * Tests for src/lib/poll-timing.ts (issue #254) — the shared jitter helper
 * client poll loops use to desynchronize their next-tick delay. Deterministic
 * via an injected `random`, matching the spec's bounds: random=0 -> base,
 * random->1 -> 1.25*base.
 */

import { describe, it, expect } from "vitest";
import { jitteredDelayMs } from "../src/lib/poll-timing";

describe("jitteredDelayMs", () => {
  it("returns exactly the base delay when random() is 0", () => {
    expect(jitteredDelayMs(6000, () => 0)).toBe(6000);
    expect(jitteredDelayMs(30_000, () => 0)).toBe(30_000);
  });

  it("returns exactly 1.25x the base delay when random() is 1", () => {
    expect(jitteredDelayMs(6000, () => 1)).toBe(7500);
    expect(jitteredDelayMs(30_000, () => 1)).toBe(37_500);
  });

  it("scales linearly with random() in between", () => {
    expect(jitteredDelayMs(6000, () => 0.5)).toBe(6000 + 0.5 * 0.25 * 6000);
    expect(jitteredDelayMs(8000, () => 0.2)).toBe(8000 + 0.2 * 0.25 * 8000);
  });

  it("defaults to Math.random when no random fn is provided, staying within [base, 1.25*base]", () => {
    for (let i = 0; i < 50; i++) {
      const delay = jitteredDelayMs(6000);
      expect(delay).toBeGreaterThanOrEqual(6000);
      expect(delay).toBeLessThanOrEqual(7500);
    }
  });

  it("never exceeds the [base, 1.25*base] bounds for any random() in [0,1)", () => {
    for (const r of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 0.999999]) {
      const delay = jitteredDelayMs(1000, () => r);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1250);
    }
  });
});
