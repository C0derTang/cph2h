/**
 * Tests for src/lib/race/poll-interval.ts — the dynamic verdict-poll window
 * (issue #238). Pure arithmetic: floor at POLL_MIN_INTERVAL_SEC, then linear in
 * the active-race count at SECONDS_PER_ACTIVE_RACE seconds each.
 */

import { describe, it, expect } from "vitest";
import {
  dynamicPollIntervalSec,
  SECONDS_PER_ACTIVE_RACE,
} from "../src/lib/race/poll-interval";
import { POLL_MIN_INTERVAL_SEC } from "../src/lib/types";

describe("dynamicPollIntervalSec", () => {
  it("floors at POLL_MIN_INTERVAL_SEC for low active-race counts", () => {
    // 0 races and the boundary count both clamp to the static floor.
    expect(dynamicPollIntervalSec(0)).toBe(POLL_MIN_INTERVAL_SEC);
    expect(dynamicPollIntervalSec(1)).toBe(POLL_MIN_INTERVAL_SEC); // 1*4=4 < 5

    // The largest count that the floor still dominates.
    const floorCount = Math.floor(POLL_MIN_INTERVAL_SEC / SECONDS_PER_ACTIVE_RACE);
    expect(dynamicPollIntervalSec(floorCount)).toBe(POLL_MIN_INTERVAL_SEC);
  });

  it("scales linearly at SECONDS_PER_ACTIVE_RACE once above the floor", () => {
    // Above the floor the value is exactly activeRaces * SECONDS_PER_ACTIVE_RACE.
    expect(dynamicPollIntervalSec(2)).toBe(2 * SECONDS_PER_ACTIVE_RACE); // 8
    expect(dynamicPollIntervalSec(8)).toBe(8 * SECONDS_PER_ACTIVE_RACE); // 32
    expect(dynamicPollIntervalSec(16)).toBe(16 * SECONDS_PER_ACTIVE_RACE); // 64

    // Each additional active race adds exactly SECONDS_PER_ACTIVE_RACE seconds.
    for (let n = 2; n < 40; n++) {
      expect(dynamicPollIntervalSec(n + 1) - dynamicPollIntervalSec(n)).toBe(
        SECONDS_PER_ACTIVE_RACE,
      );
    }
  });

  it("yields 128s at the 32-concurrent-race tournament ceiling", () => {
    expect(dynamicPollIntervalSec(32)).toBe(128);
  });

  it("never returns below the floor for any non-negative count", () => {
    for (let n = 0; n <= 64; n++) {
      expect(dynamicPollIntervalSec(n)).toBeGreaterThanOrEqual(
        POLL_MIN_INTERVAL_SEC,
      );
    }
  });
});
