/**
 * Admin dashboard charts (issue #176): races/day, verdict distribution, and
 * the Elo histogram. Thin presentational wrappers over the pure geometry in
 * `src/lib/admin/chart-data.ts` and the generic `BarChart` primitive — no
 * chart library, theme-aware via the existing `--color-*` CSS variables.
 */

import {
  eloHistogramBars,
  racesPerDayBars,
  verdictDistBars,
  verdictTone,
} from "@/lib/admin/chart-data";
import type { AdminOverview } from "@/lib/types";
import { BarChart } from "./BarChart";

export function ChartPanel({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel p-4">
      <p className="eyebrow text-muted-foreground">{title}</p>
      <div className="mt-3">{children}</div>
      {caption && (
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">{caption}</p>
      )}
    </div>
  );
}

export function RacesPerDayChart({
  racesPerDay,
}: {
  racesPerDay: AdminOverview["racesPerDay"];
}) {
  const geometry = racesPerDayBars(racesPerDay);
  const first = racesPerDay[0];
  const last = racesPerDay[racesPerDay.length - 1];
  const total = racesPerDay.reduce((sum, d) => sum + d.count, 0);

  return (
    <ChartPanel
      title="Races per day (last 30 days)"
      caption={
        first && last
          ? `${first.date} → ${last.date} · ${total} race${total === 1 ? "" : "s"} total · peak ${geometry.maxValue}/day`
          : undefined
      }
    >
      <BarChart
        geometry={geometry}
        title="Races per day, last 30 days"
        emptyMessage="No races yet."
      />
    </ChartPanel>
  );
}

export function VerdictDistChart({
  verdictDist,
}: {
  verdictDist: AdminOverview["verdictDist"];
}) {
  const geometry = verdictDistBars(verdictDist);

  return (
    <ChartPanel title="Verdict distribution">
      <BarChart
        geometry={geometry}
        title="Verdict distribution"
        emptyMessage="No submissions yet."
        barClassName={(bar) => {
          const tone = verdictTone(bar.label);
          if (tone === "ok") return "fill-verdict-ok";
          if (tone === "fail") return "fill-verdict-fail";
          return "fill-verdict-pending";
        }}
      />
      {verdictDist.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
          {verdictDist.map((d) => (
            <span key={d.verdict} className="whitespace-nowrap">
              {d.verdict} <span className="text-foreground">{d.count}</span>
            </span>
          ))}
        </div>
      )}
    </ChartPanel>
  );
}

export function EloHistogramChart({
  eloHistogram,
}: {
  eloHistogram: AdminOverview["eloHistogram"];
}) {
  const geometry = eloHistogramBars(eloHistogram);

  return (
    <ChartPanel title="Elo distribution">
      <BarChart
        geometry={geometry}
        title="Elo distribution, 100-point buckets"
        emptyMessage="No rated players yet."
      />
      {eloHistogram.length > 0 && (
        <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>{eloHistogram[0].bucketFloor}</span>
          <span>{eloHistogram[eloHistogram.length - 1].bucketFloor + 99}</span>
        </div>
      )}
    </ChartPanel>
  );
}
