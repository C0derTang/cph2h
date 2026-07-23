"use client";

/**
 * Admin race spectator (issue #296) — a read-only view of any race for admins
 * who are NOT participants. Deliberately does NOT reuse {@link RaceRoom}: no
 * LiveKit video, no verdict-poll POST, no player controls (ready/submit/draw).
 * It just polls the snapshot (`GET /api/races/[id]`, the source of truth) on
 * the same jittered cadence RaceRoom uses, stopping once the race is terminal.
 *
 * The server already gates the problem before `startedAt` in the snapshot
 * builder, so this component simply renders `snapshot.problem` when present —
 * it never bypasses that gate.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { EndRaceControls } from "@/components/admin/EndRaceControls";
import { formatEloDelta } from "@/lib/format";
import { jitteredDelayMs } from "@/lib/poll-timing";
import { CLIENT_POLL_INTERVAL_MS, type RaceSnapshot } from "@/lib/types";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

const TERMINAL = new Set<string>(["finished", "aborted"]);

function statusBadge(snapshot: RaceSnapshot): { variant: BadgeVariant; label: string } {
  switch (snapshot.status) {
    case "pending":
      return { variant: "outline", label: "Pending" };
    case "ready":
      return { variant: "outline", label: "Lobby" };
    case "active":
      return { variant: "verdict-pending", label: "Live" };
    case "aborted":
      return { variant: "verdict-fail", label: "Aborted" };
    case "finished": {
      if (snapshot.outcome === "draw") return { variant: "outline", label: "Draw" };
      const winner = winnerName(snapshot);
      return { variant: "verdict-ok", label: winner ? `${winner} won` : "Finished" };
    }
    default:
      return { variant: "outline", label: snapshot.status };
  }
}

function winnerName(snapshot: RaceSnapshot): string | null {
  if (snapshot.winnerId === snapshot.p1.id) return snapshot.p1.username;
  if (snapshot.p2 && snapshot.winnerId === snapshot.p2.id) return snapshot.p2.username;
  return null;
}

export function AdminRaceView({
  raceId,
  initialSnapshot,
}: {
  raceId: string;
  initialSnapshot: RaceSnapshot;
}) {
  const [snapshot, setSnapshot] = useState<RaceSnapshot>(initialSnapshot);
  const cancelledRef = useRef(false);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/races/${raceId}`, { cache: "no-store" });
      if (!res.ok || cancelledRef.current) return;
      const data = (await res.json()) as RaceSnapshot;
      if (!cancelledRef.current) setSnapshot(data);
    } catch {
      // Transient; the next tick retries. Events are hints, GET is truth.
    }
  }, [raceId]);

  // Poll while non-terminal, jittered like RaceRoom's loops; stop on terminal.
  useEffect(() => {
    cancelledRef.current = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await refetch();
      if (!cancelledRef.current) schedule();
    };
    const schedule = () => {
      timer = setTimeout(() => void tick(), jitteredDelayMs(CLIENT_POLL_INTERVAL_MS));
    };

    if (!TERMINAL.has(snapshot.status)) schedule();

    return () => {
      cancelledRef.current = true;
      clearTimeout(timer);
    };
  }, [refetch, snapshot.status]);

  const badge = statusBadge(snapshot);
  const isTerminal = TERMINAL.has(snapshot.status);
  const showReady = snapshot.status === "pending" || snapshot.status === "ready";

  return (
    <main className="shell-narrow flex flex-1 flex-col gap-6 py-10 md:py-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-muted-foreground">Admin view — spectating</p>
          <h1 className="mt-1 font-heading text-xl font-semibold tracking-tight md:text-2xl">
            Race
          </h1>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      {/* Players */}
      <div className="panel grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <PlayerCard
          label="Player 1"
          username={snapshot.p1.username}
          elo={snapshot.p1.elo}
          cfRating={snapshot.p1.cfRating}
          ready={showReady ? snapshot.p1Ready : null}
          isWinner={snapshot.winnerId === snapshot.p1.id}
        />
        <PlayerCard
          label="Player 2"
          username={snapshot.p2 ? snapshot.p2.username : "—"}
          elo={snapshot.p2?.elo ?? null}
          cfRating={snapshot.p2?.cfRating ?? null}
          ready={showReady && snapshot.p2 ? snapshot.p2Ready : null}
          isWinner={snapshot.p2 ? snapshot.winnerId === snapshot.p2.id : false}
        />
      </div>

      {/* Settings */}
      <div className="panel p-4">
        <p className="eyebrow text-muted-foreground">Settings</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs sm:grid-cols-3">
          <Setting label="Time limit" value={`${Math.round(snapshot.timeLimitSec / 60)}m`} />
          <Setting label="Rating" value={ratingLabel(snapshot)} />
          <Setting label="Dates" value={dateLabel(snapshot)} />
          <Setting label="Source" value={snapshot.readyDeadlineAt !== null ? "Matchmade" : "Challenge"} />
        </dl>
      </div>

      {/* Problem (server-gated: only present once started) */}
      {snapshot.problem && (
        <div className="panel p-4">
          <p className="eyebrow text-muted-foreground">Problem</p>
          <Link
            href={snapshot.problem.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
          >
            {snapshot.problem.id} · {snapshot.problem.name}
            <ExternalLink className="size-3.5" aria-hidden />
          </Link>
        </div>
      )}

      {/* Submissions */}
      <div className="panel p-4">
        <p className="eyebrow text-muted-foreground">Submissions</p>
        {snapshot.submissions.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No submissions yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {snapshot.submissions.map((s, i) => (
              <li
                key={`${s.userId}-${s.cfSubmissionId ?? i}`}
                className="flex flex-wrap items-center gap-3 py-2 font-mono text-xs"
              >
                <span className="text-muted-foreground">
                  {playerLabel(snapshot, s.userId)}
                </span>
                <Badge variant={verdictVariant(s.verdict)}>{s.verdict ?? "pending"}</Badge>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {new Date(s.submittedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Outcome (terminal) */}
      {isTerminal && (
        <div className="panel p-4">
          <p className="eyebrow text-muted-foreground">Outcome</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            {(snapshot.eloDeltaP1 !== null || snapshot.eloDeltaP2 !== null) && (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {snapshot.p1.username} {formatEloDelta(snapshot.eloDeltaP1)} /{" "}
                {snapshot.p2 ? snapshot.p2.username : "—"} {formatEloDelta(snapshot.eloDeltaP2)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Controls (non-terminal only) */}
      {!isTerminal && (
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <p className="eyebrow text-muted-foreground">Admin controls</p>
          <div className="ml-auto">
            <EndRaceControls
              raceId={raceId}
              status={snapshot.status}
              p1={{ id: snapshot.p1.id, username: snapshot.p1.username }}
              p2={snapshot.p2 ? { id: snapshot.p2.id, username: snapshot.p2.username } : null}
              onEnded={() => void refetch()}
            />
          </div>
        </div>
      )}
    </main>
  );
}

function PlayerCard({
  label,
  username,
  elo,
  cfRating,
  ready,
  isWinner,
}: {
  label: string;
  username: string;
  elo: number | null;
  cfRating: number | null;
  ready: boolean | null;
  isWinner: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{username}</span>
        {isWinner && <Badge variant="verdict-ok">winner</Badge>}
        {ready !== null && (
          <Badge variant={ready ? "verdict-ok" : "outline"}>
            {ready ? "ready" : "not ready"}
          </Badge>
        )}
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        Elo {elo ?? "—"}
        {cfRating !== null ? ` · CF ${cfRating}` : ""}
      </p>
    </div>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ratingLabel(snapshot: RaceSnapshot): string {
  const f = snapshot.filters;
  if (!f || (f.ratingMin === null && f.ratingMax === null)) return "any";
  return `${f.ratingMin ?? "min"}–${f.ratingMax ?? "max"}`;
}

function dateLabel(snapshot: RaceSnapshot): string {
  const f = snapshot.filters;
  if (!f || (f.dateFrom === null && f.dateTo === null)) return "any";
  const from = f.dateFrom ? new Date(f.dateFrom).toLocaleDateString() : "…";
  const to = f.dateTo ? new Date(f.dateTo).toLocaleDateString() : "…";
  return `${from} → ${to}`;
}

function playerLabel(snapshot: RaceSnapshot, userId: string): string {
  if (userId === snapshot.p1.id) return snapshot.p1.username;
  if (snapshot.p2 && userId === snapshot.p2.id) return snapshot.p2.username;
  return "unknown";
}

function verdictVariant(verdict: string | null): BadgeVariant {
  if (!verdict) return "verdict-pending";
  if (verdict === "OK") return "verdict-ok";
  if (verdict === "TESTING") return "verdict-pending";
  return "verdict-fail";
}
