import { describe, expect, it } from "vitest";
import {
  decodeRaceEvent,
  encodeRaceEvent,
  problemIdOf,
  problemUrl,
  type RaceEvent,
} from "@/lib/types";

describe("shared contracts", () => {
  it("round-trips race events through the data-channel encoding", () => {
    const event: RaceEvent = {
      type: "race_finished",
      outcome: "p1_win",
      winnerId: "u1",
      eloDeltas: { u1: 14, u2: -14 },
    };
    expect(decodeRaceEvent(encodeRaceEvent(event))).toEqual(event);
  });

  it("returns null for malformed event payloads", () => {
    expect(decodeRaceEvent(new TextEncoder().encode("not json"))).toBeNull();
  });

  it("derives problem ids and urls", () => {
    expect(problemIdOf({ contestId: 1794, index: "C" })).toBe("1794C");
    expect(problemUrl({ contestId: 1794, index: "C" })).toBe(
      "https://codeforces.com/problemset/problem/1794/C",
    );
  });
});
