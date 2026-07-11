import { describe, expect, it } from "vitest";
import {
  computeBarChart,
  eloHistogramBars,
  formatDayLabel,
  formatEloBucketLabel,
  racesPerDayBars,
  summarizeBars,
  verdictDistBars,
  verdictTone,
} from "@/lib/admin/chart-data";

describe("computeBarChart", () => {
  it("returns no bars for empty input", () => {
    const geometry = computeBarChart([]);
    expect(geometry.bars).toEqual([]);
    expect(geometry.maxValue).toBe(0);
  });

  it("never produces NaN geometry when every value is zero", () => {
    const geometry = computeBarChart([
      { label: "a", value: 0 },
      { label: "b", value: 0 },
    ]);
    expect(geometry.maxValue).toBe(0);
    for (const bar of geometry.bars) {
      expect(Number.isNaN(bar.height)).toBe(false);
      expect(bar.height).toBe(0);
      expect(bar.y).toBe(geometry.viewBoxHeight);
    }
  });

  it("scales the tallest bar to fill the full viewBox height", () => {
    const geometry = computeBarChart(
      [
        { label: "a", value: 5 },
        { label: "b", value: 10 },
      ],
      { height: 100 },
    );
    const tallest = geometry.bars[1];
    expect(tallest.height).toBeCloseTo(100);
    expect(tallest.y).toBeCloseTo(0);
    const shorter = geometry.bars[0];
    expect(shorter.height).toBeCloseTo(50);
    expect(shorter.y).toBeCloseTo(50);
  });

  it("lays bars out left-to-right without overlap and within the viewBox width", () => {
    const geometry = computeBarChart(
      [
        { label: "a", value: 1 },
        { label: "b", value: 2 },
        { label: "c", value: 3 },
      ],
      { width: 300 },
    );
    expect(geometry.bars).toHaveLength(3);
    for (let i = 1; i < geometry.bars.length; i++) {
      const prev = geometry.bars[i - 1];
      const cur = geometry.bars[i];
      expect(cur.x).toBeGreaterThan(prev.x);
    }
    const last = geometry.bars[geometry.bars.length - 1];
    expect(last.x + last.width).toBeLessThanOrEqual(300);
  });

  it("handles a single datum without dividing by zero", () => {
    const geometry = computeBarChart([{ label: "only", value: 4 }], {
      width: 100,
      height: 50,
    });
    expect(geometry.bars).toHaveLength(1);
    expect(geometry.bars[0].height).toBeCloseTo(50);
  });
});

describe("summarizeBars", () => {
  it("reports 'No data' for an empty series", () => {
    expect(summarizeBars([])).toBe("No data");
  });

  it("joins label:value pairs", () => {
    const geometry = computeBarChart([
      { label: "Mon", value: 3 },
      { label: "Tue", value: 5 },
    ]);
    expect(summarizeBars(geometry.bars)).toBe("Mon: 3, Tue: 5");
  });
});

describe("formatDayLabel", () => {
  it("converts an ISO date to MM/DD", () => {
    expect(formatDayLabel("2026-07-10")).toBe("07/10");
  });

  it("passes through malformed input unchanged", () => {
    expect(formatDayLabel("not-a-date-string")).toBe("not-a-date-string");
  });
});

describe("racesPerDayBars", () => {
  it("labels bars with MM/DD and preserves counts", () => {
    const geometry = racesPerDayBars([
      { date: "2026-07-01", count: 2 },
      { date: "2026-07-02", count: 6 },
    ]);
    expect(geometry.bars.map((b) => b.label)).toEqual(["07/01", "07/02"]);
    expect(geometry.bars.map((b) => b.value)).toEqual([2, 6]);
    expect(geometry.maxValue).toBe(6);
  });

  it("produces empty geometry for zero days", () => {
    expect(racesPerDayBars([]).bars).toEqual([]);
  });
});

describe("formatEloBucketLabel", () => {
  it("formats a 100-wide bucket range", () => {
    expect(formatEloBucketLabel(1200)).toBe("1200–1299");
  });
});

describe("eloHistogramBars", () => {
  it("labels bars with the bucket range", () => {
    const geometry = eloHistogramBars([
      { bucketFloor: 800, count: 1 },
      { bucketFloor: 1200, count: 9 },
    ]);
    expect(geometry.bars.map((b) => b.label)).toEqual(["800–899", "1200–1299"]);
  });
});

describe("verdictDistBars", () => {
  it("labels bars with the verdict string", () => {
    const geometry = verdictDistBars([
      { verdict: "OK", count: 10 },
      { verdict: "WRONG_ANSWER", count: 4 },
    ]);
    expect(geometry.bars.map((b) => b.label)).toEqual(["OK", "WRONG_ANSWER"]);
  });
});

describe("verdictTone", () => {
  it("classifies OK as ok", () => {
    expect(verdictTone("OK")).toBe("ok");
  });

  it("classifies other final verdicts as fail", () => {
    expect(verdictTone("WRONG_ANSWER")).toBe("fail");
    expect(verdictTone("TIME_LIMIT_EXCEEDED")).toBe("fail");
    expect(verdictTone("COMPILATION_ERROR")).toBe("fail");
  });

  it("classifies non-final verdicts as pending", () => {
    expect(verdictTone("TESTING")).toBe("pending");
    expect(verdictTone("QUEUED")).toBe("pending");
  });
});
