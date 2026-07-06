import { describe, it, expect } from "vitest";
import {
  REFETCH_MIN_MS,
  refetchThrottleDecision,
} from "@/lib/race/refetch-throttle";

describe("refetchThrottleDecision", () => {
  it("fires immediately when there has never been a refetch (lastRefetchAt=0)", () => {
    expect(refetchThrottleDecision(0, 5_000)).toEqual({ action: "now" });
  });

  it("fires immediately when the window has fully elapsed (leading edge)", () => {
    expect(refetchThrottleDecision(10_000, 10_000 + REFETCH_MIN_MS)).toEqual({
      action: "now",
    });
  });

  it("fires immediately well after the window", () => {
    expect(refetchThrottleDecision(10_000, 10_000 + REFETCH_MIN_MS * 5)).toEqual({
      action: "now",
    });
  });

  it("schedules a trailing refetch inside the window, landing exactly at the boundary", () => {
    const result = refetchThrottleDecision(10_000, 10_400);
    expect(result).toEqual({ action: "trailing", delayMs: REFETCH_MIN_MS - 400 });
  });

  it("an event immediately after a refetch waits the full window", () => {
    expect(refetchThrottleDecision(10_000, 10_000)).toEqual({
      action: "trailing",
      delayMs: REFETCH_MIN_MS,
    });
  });

  it("one ms before the boundary still trails (by 1ms)", () => {
    expect(refetchThrottleDecision(10_000, 10_000 + REFETCH_MIN_MS - 1)).toEqual({
      action: "trailing",
      delayMs: 1,
    });
  });

  it("respects a custom window", () => {
    expect(refetchThrottleDecision(10_000, 10_100, 500)).toEqual({
      action: "trailing",
      delayMs: 400,
    });
    expect(refetchThrottleDecision(10_000, 10_500, 500)).toEqual({ action: "now" });
  });

  it("a flood collapses to leading + one trailing per window", () => {
    // Simulate the component's driver logic over a 100-events-in-1s flood:
    // ref-tracked lastRefetchAt + single pending trailing timer.
    let lastRefetchAt = 0;
    let trailingPendingUntil: number | null = null;
    let fired = 0;

    const deliver = (now: number) => {
      // A due trailing timer fires before the next event is processed.
      if (trailingPendingUntil !== null && now >= trailingPendingUntil) {
        lastRefetchAt = trailingPendingUntil;
        trailingPendingUntil = null;
        fired += 1;
      }
      const decision = refetchThrottleDecision(lastRefetchAt, now);
      if (decision.action === "now") {
        lastRefetchAt = now;
        fired += 1;
      } else if (trailingPendingUntil === null) {
        trailingPendingUntil = now + decision.delayMs;
      }
    };

    // 150 forged events, 10ms apart, from a realistic (non-zero) clock —
    // lastRefetchAt=0 means "never", which only reads as "long ago" when
    // `now` is a real epoch-ish timestamp. Spans ~1.5s.
    const t0 = 100_000;
    for (let i = 0; i < 150; i++) deliver(t0 + i * 10);

    // Leading edge at t0; the trailing refetch scheduled for t0+1000 fires
    // once the flood crosses it; a new trailing (t0+2000) then covers the
    // tail — everything else dropped. ~1.5s of flood → exactly 2 refetches.
    expect(fired).toBe(2);
    expect(trailingPendingUntil).not.toBeNull(); // tail of the flood still covered
  });
});
