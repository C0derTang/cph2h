/**
 * Tests for src/lib/race/call-persistence.ts — the pure "keep the post-race
 * call mounted" detector (issue #121).
 *
 * The call must persist on the result screen ONLY for a client that observed
 * the race active while mounted; a direct load onto an already-finished race
 * (never saw `active`) must never keep a call alive.
 */

import { describe, it, expect } from "vitest";
import { shouldKeepCallMounted } from "../src/lib/race/call-persistence";
import type { RaceStatus } from "../src/lib/types";

describe("shouldKeepCallMounted", () => {
  it("keeps the call when an observed-active race is now finished", () => {
    expect(shouldKeepCallMounted(true, "finished")).toBe(true);
  });

  it("keeps the call when an observed-active race is now aborted", () => {
    expect(shouldKeepCallMounted(true, "aborted")).toBe(true);
  });

  it("does not keep a call on a direct load of a finished race (never saw active)", () => {
    expect(shouldKeepCallMounted(false, "finished")).toBe(false);
  });

  it("does not keep a call on a direct load of an aborted race (never saw active)", () => {
    expect(shouldKeepCallMounted(false, "aborted")).toBe(false);
  });

  it("returns false for non-terminal statuses even after observing active", () => {
    const nonTerminal: RaceStatus[] = ["pending", "ready", "active"];
    for (const status of nonTerminal) {
      expect(shouldKeepCallMounted(true, status)).toBe(false);
    }
  });

  it("returns false for non-terminal statuses when active was never observed", () => {
    const nonTerminal: RaceStatus[] = ["pending", "ready", "active"];
    for (const status of nonTerminal) {
      expect(shouldKeepCallMounted(false, status)).toBe(false);
    }
  });
});
