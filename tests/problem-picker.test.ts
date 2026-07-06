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

/** Narrow a successful pick to its problem id, failing the test otherwise. */
function pickedId(result: ReturnType<typeof pickProblem>): string {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected an ok pick");
  return result.problem.id;
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
    expect(["2A", "3A"]).toContain(pickedId(result));
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
    expect(pickedId(result)).toBe("2A");
  });

  it("reports all_problems_seen when every in-band candidate has been seen", () => {
    const candidates = [problem("1A", 1200), problem("2A", 1300)];
    const result = pickProblem({
      candidates,
      seenIds: new Set(["1A", "2A"]),
      p1Rating: 1200,
      p2Rating: 1200,
      seed: 1,
    });
    expect(result).toEqual({ ok: false, reason: "all_problems_seen" });
  });

  it("reports no_problems_in_filters when there are no candidates at all", () => {
    const result = pickProblem({
      candidates: [],
      seenIds: new Set(),
      p1Rating: 1200,
      p2Rating: 1200,
      seed: 1,
    });
    expect(result).toEqual({ ok: false, reason: "no_problems_in_filters" });
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
    expect(pickedId(result)).toBe("1A");
  });

  it("gives up (no_problems_in_filters) if widening exhausts its bound", () => {
    // target 1200; candidate rating is far enough away that no bounded widen
    // reaches it, and no rating filter is set — an out-of-band problem must not
    // be forced onto a mismatched race.
    const candidates = [problem("1A", 3000)];
    const result = pickProblem({
      candidates,
      seenIds: new Set(),
      p1Rating: 1200,
      p2Rating: 1200,
      seed: 1,
    });
    expect(result).toEqual({ ok: false, reason: "no_problems_in_filters" });
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

  describe("hard rating filter (challenger filters)", () => {
    it("never picks below ratingMin even though it lies in the target band", () => {
      // target 1500, band [1400,1700] would include 1400; filter floor is 1500.
      const candidates = [problem("1A", 1400), problem("2A", 1500)];
      const result = pickProblem({
        candidates,
        seenIds: new Set(),
        p1Rating: 1400,
        p2Rating: 1600,
        seed: 3,
        ratingMin: 1500,
      });
      expect(pickedId(result)).toBe("2A");
    });

    it("never picks above ratingMax even though it lies in the target band", () => {
      // target 1500, band [1400,1700] includes 1700; filter ceil is 1500.
      const candidates = [problem("1A", 1500), problem("2A", 1700)];
      const result = pickProblem({
        candidates,
        seenIds: new Set(),
        p1Rating: 1400,
        p2Rating: 1600,
        seed: 3,
        ratingMax: 1500,
      });
      expect(pickedId(result)).toBe("1A");
    });

    it("no_problems_in_filters when nothing falls inside the filter bounds", () => {
      const candidates = [problem("1A", 1200), problem("2A", 1300)];
      const result = pickProblem({
        candidates,
        seenIds: new Set(),
        p1Rating: 1200,
        p2Rating: 1200,
        seed: 3,
        ratingMin: 2000,
        ratingMax: 2200,
      });
      expect(result).toEqual({ ok: false, reason: "no_problems_in_filters" });
    });

    it("all_problems_seen when in-filter problems exist but every one is seen", () => {
      const candidates = [problem("1A", 2000), problem("2A", 2100)];
      const result = pickProblem({
        candidates,
        seenIds: new Set(["1A", "2A"]),
        p1Rating: 1200,
        p2Rating: 1200,
        seed: 3,
        ratingMin: 1900,
        ratingMax: 2200,
      });
      expect(result).toEqual({ ok: false, reason: "all_problems_seen" });
    });

    it("falls back to a conforming problem outside the target's widening reach when a filter is set", () => {
      // target 1200 (reach maxes ~[600,1900]); only unseen conforming problem
      // is at 3000, well inside the wide filter [800,3500] -> must still pick it.
      const candidates = [problem("1A", 3000)];
      const result = pickProblem({
        candidates,
        seenIds: new Set(),
        p1Rating: 1200,
        p2Rating: 1200,
        seed: 3,
        ratingMin: 800,
        ratingMax: 3500,
      });
      expect(pickedId(result)).toBe("1A");
    });

    it("still prefers a near-target problem over a far conforming one", () => {
      const candidates = [problem("1A", 1200), problem("2A", 3400)];
      const result = pickProblem({
        candidates,
        seenIds: new Set(),
        p1Rating: 1200,
        p2Rating: 1200,
        seed: 3,
        ratingMin: 800,
        ratingMax: 3500,
      });
      expect(pickedId(result)).toBe("1A");
    });
  });
});
