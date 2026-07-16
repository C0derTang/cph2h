"use client";

/**
 * Admin growth charts (issue #222): signups/day + tournament
 * registrations/day, as a self-contained section. Self-fetches
 * `/api/admin/growth` with loading/error/retry states (the `ReportsQueue`
 * pattern), and renders two `ChartPanel`s (from `charts.tsx`) wrapping the
 * generic `BarChart` primitive — same geometry helpers as the other admin
 * charts. Wiring into `AdminDashboard.tsx` is a separate follow-up issue.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeBarChart, formatDayLabel } from "@/lib/admin/chart-data";
import type { AdminGrowth } from "@/lib/admin/growth";
import { BarChart } from "./BarChart";
import { ChartPanel } from "./charts";

type GrowthState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: AdminGrowth };

export function GrowthCharts() {
  const [state, setState] = useState<GrowthState>({ status: "loading" });

  const fetchGrowth = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/admin/growth", { cache: "no-store" });
      if (!res.ok) {
        setState({ status: "error" });
        return;
      }
      const data = (await res.json()) as AdminGrowth;
      setState({ status: "ready", data });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    async function run() {
      await fetchGrowth();
    }
    run();
  }, [fetchGrowth]);

  if (state.status === "loading") {
    return (
      <div className="panel p-4">
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="panel p-4">
        <div className="flex flex-col items-start gap-2 py-6">
          <p role="alert" className="text-sm text-destructive">
            Couldn&apos;t load growth charts.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => fetchGrowth()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const { signupsPerDay, registrationsPerDay } = state.data;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <GrowthChart
        title="Signups / day"
        data={signupsPerDay}
        noun="signup"
        emptyMessage="No signups yet."
      />
      <GrowthChart
        title="Tournament registrations / day"
        data={registrationsPerDay}
        noun="registration"
        emptyMessage="No registrations yet."
      />
    </div>
  );
}

function GrowthChart({
  title,
  data,
  noun,
  emptyMessage,
}: {
  title: string;
  data: { date: string; count: number }[];
  /** Singular noun for the caption, e.g. "signup" -> "N signups in 30d". */
  noun: string;
  emptyMessage: string;
}) {
  const geometry = computeBarChart(
    data.map((d) => ({ label: formatDayLabel(d.date), value: d.count })),
  );
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <ChartPanel
      title={title}
      caption={`${total} ${noun}${total === 1 ? "" : "s"} in 30d · peak ${geometry.maxValue}/day`}
    >
      <BarChart geometry={geometry} title={title} emptyMessage={emptyMessage} />
    </ChartPanel>
  );
}
