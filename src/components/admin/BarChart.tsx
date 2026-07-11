/**
 * Generic accessible inline-SVG bar chart (issue #176). Renders pure
 * geometry from `src/lib/admin/chart-data.ts` — no chart library. The `<svg>`
 * carries `role="img"` and a full-detail `aria-label` (built from
 * `summarizeBars`) so screen-reader users get the same data sighted users
 * read off the bars, and every bar gets a native `<title>` tooltip.
 */

import type { BarChartGeometry, ChartBar } from "@/lib/admin/chart-data";
import { summarizeBars } from "@/lib/admin/chart-data";
import { cn } from "@/lib/utils";

export function BarChart({
  geometry,
  title,
  barClassName,
  emptyMessage = "No data yet.",
  height = 90,
}: {
  geometry: BarChartGeometry;
  /** Chart title, prefixed onto the accessible label. */
  title: string;
  /** Per-bar fill class, e.g. tone-coded verdict colors. Defaults to the self-yellow identity color. */
  barClassName?: (bar: ChartBar) => string;
  emptyMessage?: string;
  height?: number;
}) {
  if (geometry.bars.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <svg
      role="img"
      aria-label={`${title}. ${summarizeBars(geometry.bars)}`}
      viewBox={`0 0 ${geometry.viewBoxWidth} ${geometry.viewBoxHeight}`}
      className="w-full overflow-visible"
      style={{ height }}
      preserveAspectRatio="none"
    >
      {geometry.bars.map((bar, i) => (
        <rect
          key={`${bar.label}-${i}`}
          x={bar.x}
          y={bar.y}
          width={Math.max(bar.width, 0)}
          height={Math.max(bar.height, 0)}
          rx={Math.min(1.5, bar.width / 4)}
          className={cn("fill-player-self", barClassName?.(bar))}
        >
          <title>{`${bar.label}: ${bar.value}`}</title>
        </rect>
      ))}
    </svg>
  );
}
