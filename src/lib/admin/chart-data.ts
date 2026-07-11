/**
 * Pure chart-geometry helpers for the admin dashboard (issue #176).
 *
 * No I/O, no React — these shape `AdminOverview` arrays into SVG-ready bar
 * geometry so the dashboard's inline-SVG charts (races/day, verdict
 * distribution, Elo histogram) stay thin presentational components. Mirrors
 * the existing `src/lib/elo-sparkline.ts` pattern: coordinates are produced
 * directly in the SVG viewBox's coordinate space.
 */

import { isFinalVerdict } from "@/lib/cf/verdicts";
import type { AdminOverview } from "@/lib/types";

// ---------------------------------------------------------------------------
// Generic bar-chart geometry
// ---------------------------------------------------------------------------

export interface BarDatum {
  label: string;
  value: number;
}

export interface ChartBar extends BarDatum {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BarChartGeometry {
  bars: ChartBar[];
  /** Largest value in the input (0 for empty input) — useful for a y-axis cap label. */
  maxValue: number;
  viewBoxWidth: number;
  viewBoxHeight: number;
}

const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 90;
/** Fraction of each bar's slot left empty as inter-bar gap. */
const DEFAULT_GAP_RATIO = 0.25;

export interface BarChartOptions {
  width?: number;
  height?: number;
  gapRatio?: number;
}

/**
 * Map a series of (label, value) pairs to bar rectangles inside a
 * `viewBoxWidth` x `viewBoxHeight` SVG viewBox. Bars grow up from the bottom
 * edge (y=height); an all-zero or empty series never produces NaN geometry.
 */
export function computeBarChart(
  data: BarDatum[],
  options: BarChartOptions = {},
): BarChartGeometry {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const gapRatio = options.gapRatio ?? DEFAULT_GAP_RATIO;

  if (data.length === 0) {
    return { bars: [], maxValue: 0, viewBoxWidth: width, viewBoxHeight: height };
  }

  const maxValue = Math.max(...data.map((d) => d.value), 0);
  const slot = width / data.length;
  const barWidth = slot * (1 - gapRatio);
  const gap = slot * gapRatio;

  const bars: ChartBar[] = data.map((d, i) => {
    const barHeight = maxValue > 0 ? (d.value / maxValue) * height : 0;
    return {
      ...d,
      x: i * slot + gap / 2,
      y: height - barHeight,
      width: barWidth,
      height: barHeight,
    };
  });

  return { bars, maxValue, viewBoxWidth: width, viewBoxHeight: height };
}

/** Full-detail description of a bar series, for chart `aria-label`s. */
export function summarizeBars(bars: ChartBar[]): string {
  if (bars.length === 0) return "No data";
  return bars.map((b) => `${b.label}: ${b.value}`).join(", ");
}

// ---------------------------------------------------------------------------
// Domain-specific wrappers over AdminOverview's arrays
// ---------------------------------------------------------------------------

/** `"YYYY-MM-DD"` -> `"MM/DD"`. String slicing avoids TZ-sensitive Date parsing. */
export function formatDayLabel(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  return `${parts[1]}/${parts[2]}`;
}

export function racesPerDayBars(
  racesPerDay: AdminOverview["racesPerDay"],
  options?: BarChartOptions,
): BarChartGeometry {
  return computeBarChart(
    racesPerDay.map((d) => ({ label: formatDayLabel(d.date), value: d.count })),
    options,
  );
}

export function verdictDistBars(
  verdictDist: AdminOverview["verdictDist"],
  options?: BarChartOptions,
): BarChartGeometry {
  return computeBarChart(
    verdictDist.map((d) => ({ label: d.verdict, value: d.count })),
    options,
  );
}

/** `bucketFloor` -> `"800–899"` (100-wide bucket, matching the server's grouping). */
export function formatEloBucketLabel(bucketFloor: number): string {
  return `${bucketFloor}–${bucketFloor + 99}`;
}

export function eloHistogramBars(
  eloHistogram: AdminOverview["eloHistogram"],
  options?: BarChartOptions,
): BarChartGeometry {
  return computeBarChart(
    eloHistogram.map((d) => ({
      label: formatEloBucketLabel(d.bucketFloor),
      value: d.count,
    })),
    options,
  );
}

// ---------------------------------------------------------------------------
// Verdict color classification (shares the OK / non-final logic already used
// by the CF verdict parser, so the chart and the race UI agree on what
// "pending" means).
// ---------------------------------------------------------------------------

export type VerdictTone = "ok" | "fail" | "pending";

/** Classify a verdict string into the same ok/fail/pending buckets the rest
 * of the app uses (`--color-verdict-*` tokens). */
export function verdictTone(verdict: string): VerdictTone {
  if (!isFinalVerdict(verdict)) return "pending";
  return verdict === "OK" ? "ok" : "fail";
}
