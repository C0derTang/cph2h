"use client";

/**
 * Admin dashboard content (issue #176): stat tile row, charts, and the
 * reports queue. The server-side admin gate lives in `src/app/admin/page.tsx`
 * (resolves the Clerk user → DB user, 404s non-admins); this component fetches
 * client-side (`GET /api/admin/overview`, per #175) which 404s non-admins
 * again server-side, so there's no window where the data is fetchable without
 * the gate.
 */

import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/stat";
import type { AdminOverview } from "@/lib/types";
import { EloHistogramChart, RacesPerDayChart, VerdictDistChart } from "./charts";
import { OpsPanel } from "./OpsPanel";
import { GrowthCharts } from "./GrowthCharts";
import { BracketPanel } from "./BracketPanel";
import { RegistrantsTable } from "./RegistrantsTable";
import { UserDirectory } from "./UserDirectory";
import { ReportsQueue } from "./ReportsQueue";

export function AdminDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/overview", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setError("Couldn't load the overview.");
          return;
        }
        const data = (await res.json()) as AdminOverview;
        if (!cancelled) setOverview(data);
      } catch {
        if (!cancelled) setError("Couldn't reach the server.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell relative flex flex-1 flex-col py-12 md:py-16">
      <div className="ticker rounded-[var(--radius)] px-4 py-2">
        <ShieldAlert className="size-3.5" aria-hidden />
        Admin
      </div>

      <h1 className="mt-6 font-display text-3xl tracking-tight uppercase md:text-4xl">
        Dashboard
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        Platform health, analytics, registrants, operations, and reports.
      </p>

      {loading && (
        <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </p>
      )}

      {!loading && error && (
        <div className="mt-8 flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && overview && (
        <div className="mt-8 flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Total users" value={overview.totalUsers} />
            <Stat label="Total races" value={overview.totalRaces} />
            <Stat label="Races (7d)" value={overview.races7d} />
            <Stat
              label="Open reports"
              value={overview.openReports}
              valueClassName={overview.openReports > 0 ? "text-destructive" : undefined}
            />
          </div>
        </div>
      )}

      {!loading && (
        <div className="mt-8 flex flex-col gap-6">
          <OpsPanel />
        </div>
      )}

      {!loading && !error && overview && (
        <div className="mt-8 flex flex-col gap-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="lg:col-span-2">
              <RacesPerDayChart racesPerDay={overview.racesPerDay} />
            </div>
            <VerdictDistChart verdictDist={overview.verdictDist} />
            <EloHistogramChart eloHistogram={overview.eloHistogram} />
          </div>
        </div>
      )}

      {!loading && (
        <div className="mt-8 flex flex-col gap-6">
          <GrowthCharts />
          <BracketPanel />
          <RegistrantsTable />
          <UserDirectory />
        </div>
      )}

      {!loading && !error && overview && (
        <div className="mt-8 flex flex-col gap-6">
          <ReportsQueue />
        </div>
      )}
    </main>
  );
}
