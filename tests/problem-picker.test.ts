/**
 * Tests for src/lib/cf/problem-picker.ts
 */

import { describe, it, expect } from "vitest";
import { pickProblem, targetRating } from "../src/lib/cf/problem-picker";
import type { ProblemRef } from "../src/lib/types";

function problem(id: string, rating: number): ProblemRef {
  const contestId = Number(id.slice(0, -1));
  const index = id.slice(-1);
  return {
    id,
    contestId,
    index,
    name: `Problem ${id}`,
    rating,
    url: `https://codeforces.com/problemset/problem/${contestId}/${index}`,
  };
}

describe("targetRating", () => {
  it("averages both ratings and rounds to the nearest 100", () => {
    expect(targetRating(1400, 1600)).toBe(1500);
    expect(targetRating(1250, 1349)).toBe(1300);
  });

  it("defaults unrated players (null) to 1200", () => {
    expect(targetRating(null, null)).toBe(1200);
    expect(targetRating(1800, null)).toBe(1500);
  });
});

describe("pickProblem", () => {
  it("computes the target band and only picks within [target-100, target+200]", () => {
    // p1=1400, p2=1600 -> target 1500 -> band [1400, 1700]
    const candidates = [
      problem("1A", 1300), // below band
      problem("2A", 1400), // low edge, in band
      problem("3A", 1700), // high edge, in band
      problem("4A", 1800), // above band
    ];
    const result = pickProblem({
      candidates,
      seenIds: new Set(),
      p1Rating: 1400,
      p2Rating: 1600,
      seed: 1,
    });
    expect(result).not.toBeNull();
    expect(["2A", "3A"]).toContain(result!.id);
  });

  it("excludes seen problems even when they're in-band", () => {
    const candidates = [problem("1A", 1200), problem("2A", 1200)];
    const result = pickProblem({
      candidates,
      seenIds: new Set(["1A"]),
      p1Rating: 1200,
      p2Rating: 1200,
      seed: 1,
    });
    expect(result).not.toBeNull();
    expect(result!.id).toBe("2A");
  });

  it("returns null when every in-band candidate has been seen", () => {
    const candidates = [problem("1A", 1200), problem("2A", 1300)];
    const result = pickProblem({
      candidates,
      seenIds: new Set(["1A", "2A"]),
      p1Rating: 1200,
      p2Rating: 1200,
      seed: 1,
    });
    expect(result).toBeNull();
  });

  it("returns null when there are no candidates at all", () => {
    const result = pickProblem({
      candidates: [],
      seenIds: new Set(),
      p1Rating: 1200,
      p2Rating: 1200,
      seed: 1,
    });
    expect(result).toBeNull();
  });

  it("widens the window by ±100 per retry until it finds a candidate", () => {
    // target 1200 -> initial band [1100, 1400] is empty; only after widening
    // by 100 (band [1000, 1500]) does 1000 fall in range.
    const candidates = [problem("1A", 1000)];
    const result = pickProblem({
      candidates,
      seenIds: new Set(),
      p1Rating: 1200,
      p2Rating: 1200,
      seed: 1,
    });
    expect(result).not.toBeNull();
    expect(result!.id).toBe("1A");
  });

  it("gives up and returns null if widening exhausts its bound", () => {
    // target 1200; candidate rating is far enough away that no bounded widen
    // reaches it.
    const candidates = [problem("1A", 3000)];
    const result = pickProblem({
      candidates,
      seenIds: new Set(),
      p1Rating: 1200,
      p2Rating: 1200,
      seed: 1,
    });
    expect(result).toBeNull();
  });

  it("is deterministic: same candidates + same seed always pick the same problem", () => {
    const candidates = [
      problem("1A", 1200),
      problem("2A", 1210),
      problem("3A", 1220),
      problem("4A", 1230),
      problem("5A", 1240),
    ];
    const opts = {
      candidates,
      seenIds: new Set<string>(),
      p1Rating: 1200,
      p2Rating: 1200,
      seed: 42,
    };
    const first = pickProblem(opts);
    const second = pickProblem(opts);
    const third = pickProblem({ ...opts, candidates: [...candidates] });
    expect(first).toEqual(second);
    expect(first).toEqual(third);
  });

  it("does not mutate the candidates array", () => {
    const candidates = [problem("1A", 1200), problem("2A", 1210)];
    const snapshot = [...candidates];
    pickProblem({
      candidates,
      seenIds: new Set(),
      p1Rating: 1200,
      p2Rating: 1200,
      seed: 7,
    });
    expect(candidates).toEqual(snapshot);
  });
});
