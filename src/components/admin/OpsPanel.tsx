"use client";

/**
 * Admin live-ops panel (issue #223): queue depth + races-active-now stat
 * tiles, and a recent-races list. Self-contained — owns its own fetching
 * against `GET /api/admin/ops` (#223), the same "component fetches its own
 * data" pattern as `ReportsQueue`/`AdminDashboard`. Polls every 30s so the
 * queue/active counts stay live; the initial fetch shows a loading skeleton,
 * but background refreshes update in place without flashing it — a
 * `cancelledRef` (checked before every `setState` in `fetchOps`) guards
 * against updates after unmount, and the interval is cleared on unmount.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Stat } from "@/components/ui/stat";
import { EndRaceControls } from "@/components/admin/EndRaceControls";
import { formatEloDelta } from "@/lib/format";
import { jitteredDelayMs } from "@/lib/poll-timing";
import type { AdminOps, RecentRaceDTO, RecentRacePlayer } from "@/lib/admin/ops";
import type { VariantProps } from "class-variance-authority";

const TERMINAL_STATUSES = new Set(["finished", "aborted"]);

const POLL_INTERVAL_MS = 30_000;

type OpsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AdminOps };

export function OpsPanel() {
  const [state, setState] = useState<OpsState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const cancelledRef = useRef(false);

  const fetchOps = useCallback(async (background: boolean) => {
    if (background) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/ops", { cache: "no-store" });
      if (cancelledRef.current) return;
      if (!res.ok) {
        if (!background) setState({ status: "error", message: "Couldn't load live ops." });
        return;
      }
      const data = (await res.json()) as AdminOps;
      if (cancelledRef.current) return;
      setState({ status: "ready", data });
    } catch {
      if (cancelledRef.current) return;
      if (!background) setState({ status: "error", message: "Couldn't reach the server." });
    } finally {
      if (!cancelledRef.current && background) setRefreshing(false);
    }
  }, []);

  // Self-rescheduling, jittered (issue #254) — desyncs admins' tabs instead
  // of every open panel polling on the same fixed 30s wall-clock beat.
  useEffect(() => {
    cancelledRef.current = false;
    let timer: ReturnType<typeof setTimeout>;

    async function load(background: boolean) {
      await fetchOps(background);
    }

    const tick = async () => {
      await load(true);
      if (!cancelledRef.current) schedule();
    };

    const schedule = () => {
      timer = setTimeout(() => void tick(), jitteredDelayMs(POLL_INTERVAL_MS));
    };

    load(false);
    schedule();

    return () => {
      cancelledRef.current = true;
      clearTimeout(timer);
    };
  }, [fetchOps]);

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow text-muted-foreground">Live ops</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => fetchOps(true)}
          disabled={refreshing}
        >
          {refreshing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          Refresh
        </Button>
      </div>

      <div className="mt-4">
        {state.status === "loading" && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading…
          </p>
        )}

        {state.status === "error" && (
          <div className="flex flex-col items-start gap-2 py-6">
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => fetchOps(false)}>
              Retry
            </Button>
          </div>
        )}

        {state.status === "ready" && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat
                label="In queue"
                value={state.data.queueDepth}
                valueClassName={state.data.queueDepth > 0 ? "text-accent" : undefined}
              />
              <Stat
                label="Races live now"
                value={state.data.activeRaces}
                valueClassName={state.data.activeRaces > 0 ? "text-accent" : undefined}
              />
            </div>

            <div>
              <p className="eyebrow text-muted-foreground">Recent races</p>
              {state.data.recentRaces.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">No races yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {state.data.recentRaces.map((race) => (
                    <RecentRaceRow
                      key={race.id}
                      race={race}
                      onEnded={() => fetchOps(true)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Outcome badge variant + label for a recent race row. Now that the list
 * includes every status (issue #296), pending/ready rows must NOT be mislabeled
 * "Live" — each pre-active status gets its own badge; only `active` is Live.
 */
function outcomeBadge(
  race: RecentRaceDTO,
): { variant: VariantProps<typeof badgeVariants>["variant"]; label: string } {
  if (race.status === "pending") return { variant: "outline", label: "Pending" };
  if (race.status === "ready") return { variant: "outline", label: "Lobby" };
  if (race.status === "active") return { variant: "verdict-pending", label: "Live" };

  // Terminal (finished / aborted).
  if (race.outcome === "draw") return { variant: "outline", label: "Draw" };
  if (race.outcome === "aborted") return { variant: "verdict-fail", label: "Aborted" };

  const winner = winnerPlayer(race);
  return { variant: "verdict-ok", label: winner ? `${winner.username} won` : "Unknown" };
}

/** One-line race-settings summary for a recent race row (issue #296). */
function settingsSummary(race: RecentRaceDTO): string {
  const parts: string[] = [`${Math.round(race.timeLimitSec / 60)}m`];

  parts.push(
    race.ratingMin === null && race.ratingMax === null
      ? "any"
      : `${race.ratingMin ?? "min"}–${race.ratingMax ?? "max"}`,
  );

  if (race.problemDateFrom !== null || race.problemDateTo !== null) {
    const from = race.problemDateFrom
      ? new Date(race.problemDateFrom).toLocaleDateString()
      : "…";
    const to = race.problemDateTo
      ? new Date(race.problemDateTo).toLocaleDateString()
      : "…";
    parts.push(`${from}→${to}`);
  }

  if (race.problemId !== null) parts.push(race.problemId);

  return parts.join(" · ");
}

function winnerPlayer(race: RecentRaceDTO): RecentRacePlayer | null {
  if (race.winnerId === race.p1.id) return race.p1;
  if (race.p2 && race.winnerId === race.p2.id) return race.p2;
  return null;
}

function RecentRaceRow({
  race,
  onEnded,
}: {
  race: RecentRaceDTO;
  onEnded: () => void;
}) {
  const badge = outcomeBadge(race);
  const timestamp = race.finishedAt ?? race.startedAt ?? race.createdAt;
  const isTerminal = TERMINAL_STATUSES.has(race.status);

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={badge.variant}>{badge.label}</Badge>

        <span className="font-mono text-xs">
          <span className="text-player-self">{race.p1.username}</span>
          <span className="text-muted-foreground"> vs </span>
          <span className="text-player-opponent">
            {race.p2 ? race.p2.username : "—"}
          </span>
        </span>

        {(race.eloDeltaP1 !== null || race.eloDeltaP2 !== null) && (
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatEloDelta(race.eloDeltaP1)} / {formatEloDelta(race.eloDeltaP2)}
          </span>
        )}

        {timestamp && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {new Date(timestamp).toLocaleString()}
          </span>
        )}

        <Link
          href={`/race/${race.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          Race
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">
          {settingsSummary(race)}
        </span>
        {race.readyDeadlineAt !== null && (
          <Badge variant="outline">MM</Badge>
        )}

        {!isTerminal && (
          <div className="ml-auto">
            <EndRaceControls
              raceId={race.id}
              status={race.status}
              p1={race.p1}
              p2={race.p2}
              onEnded={onEnded}
            />
          </div>
        )}
      </div>
    </li>
  );
}
