/**
 * Pure point-math for the dashboard Elo trend sparkline.
 *
 * Coordinates are produced directly in the SVG viewBox's coordinate space
 * ({@link SPARKLINE_VIEWBOX_WIDTH} x {@link SPARKLINE_VIEWBOX_HEIGHT}), inset
 * by a small padding so the line and its endpoint dot always sit fully
 * inside the box — never clipped, never spilling into surrounding content.
 */

export const SPARKLINE_VIEWBOX_WIDTH = 100;
export const SPARKLINE_VIEWBOX_HEIGHT = 40;

const PAD_X = 2;
const PAD_Y = 4;

export interface SparklinePoint {
  x: number;
  y: number;
}

/**
 * Map a chronological series of Elo values to points inside the sparkline
 * viewBox. Higher Elo renders higher on the chart (lower y).
 *
 * - Empty input yields no points (caller should render an empty state).
 * - A single value yields one point centered in the box — a lone dot, no
 *   line — instead of the divide-by-zero (NaN) the naive `i / (n - 1)` math
 *   produces for n === 1.
 * - A flat (zero-range) series still spreads points across the x-axis and
 *   centers them vertically, rather than collapsing to the bottom edge.
 */
export function eloSparklinePoints(eloValues: number[]): SparklinePoint[] {
  if (eloValues.length === 0) return [];

  if (eloValues.length === 1) {
    return [
      { x: SPARKLINE_VIEWBOX_WIDTH / 2, y: SPARKLINE_VIEWBOX_HEIGHT / 2 },
    ];
  }

  const min = Math.min(...eloValues);
  const max = Math.max(...eloValues);
  const range = max - min || 1;

  const usableWidth = SPARKLINE_VIEWBOX_WIDTH - PAD_X * 2;
  const usableHeight = SPARKLINE_VIEWBOX_HEIGHT - PAD_Y * 2;

  return eloValues.map((elo, i) => {
    const x = PAD_X + (i / (eloValues.length - 1)) * usableWidth;
    const y = PAD_Y + usableHeight - ((elo - min) / range) * usableHeight;
    return { x, y };
  });
}
