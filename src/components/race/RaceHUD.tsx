"use client";

/**
 * Race heads-up display (issue #17).
 *
 * Purely presentational: given the race timing fields and the two players, it
 * renders the pre-start countdown (derived from `startedAt`) which flips into a
 * live remaining/elapsed timer (derived from `endsAt`) once the race is
 * underway, plus a compact opponent-presence indicator. A local 250ms tick
 * keeps the labels live between snapshot refetches — no state is owned here.
 */

import { useEffect, useState } from "react";
import { Circle, Clock, Timer } from "lucide-react";

import { cn } from "@/lib/utils";
import { correctedNow } from "@/lib/race/countdown";
import type { PublicUser, RaceSnapshot } from "@/lib/types";

interface RaceHUDProps {
  snapshot: RaceSnapshot;
  you: PublicUser;
  opponent: PublicUser | null;
  /** LiveKit presence — whether the opponent is currently in the room. */
  opponentPresent?: boolean;
  /**
   * Clock skew (ms) between the local machine and the server, computed on
   * every snapshot receipt (see `src/lib/race/countdown.ts`). Applied to the
   * local tick so the countdown/timer never trust a skewed local clock.
   */
  skewMs?: number;
  className?: string;
}

/** Re-render on an interval so time-derived labels stay live. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function fmtClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function RaceHUD({
  snapshot,
  you,
  opponent,
  opponentPresent,
  skewMs = 0,
  className,
}: RaceHUDProps) {
  const localNow = useNow(250);
  const now = correctedNow(skewMs, localNow);
  const startedAt = snapshot.startedAt ? new Date(snapshot.startedAt).getTime() : null;
  const endsAt = snapshot.endsAt ? new Date(snapshot.endsAt).getTime() : null;

  const counting = startedAt != null && now < startedAt;
  const remainingToStart = startedAt != null ? (startedAt - now) / 1000 : 0;
  const remaining = endsAt != null ? (endsAt - now) / 1000 : 0;
  const elapsed = startedAt != null ? (now - startedAt) / 1000 : 0;

  return (
    <div
      data-testid="race-hud"
      // The HUD is the stage's hero plate — the ONE surface on the active race
      // stage allowed to carry `bracket-frame` corner chrome (docs/design.md).
      className={cn("panel bracket-frame flex flex-col overflow-hidden", className)}
    >
      <div className="ticker justify-between px-4 py-2">
        <span>race &middot; clock</span>
        <span className="flex items-center gap-1.5 text-verdict-pending">
          <span className="size-1.5 rounded-full bg-verdict-pending motion-safe:animate-pulse" />
          live
        </span>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {counting ? (
          <div className="flex flex-col items-center gap-1 py-2">
            <span className="flex items-center gap-1.5 eyebrow text-muted-foreground">
              <Timer className="size-3.5" aria-hidden />
              Starts in
            </span>
            <span
              data-testid="race-countdown"
              className="font-mono text-4xl font-semibold tabular-nums"
            >
              {Math.max(0, Math.ceil(remainingToStart))}
            </span>
            <span className="text-xs text-muted-foreground">
              The problem unlocks when the countdown ends.
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="flex items-center gap-1.5 eyebrow text-muted-foreground">
                <Clock className="size-3.5" aria-hidden />
                Remaining
              </span>
              <span
                data-testid="race-timer"
                className={cn(
                  "font-mono text-3xl font-semibold tabular-nums",
                  // Low time is a threat, not a judge outcome — destructive
                  // ink, never `verdict-fail` (docs/design.md verdict-scope rule).
                  remaining <= 120 && "text-destructive",
                )}
              >
                {fmtClock(remaining)}
              </span>
            </div>
            <div className="flex flex-col items-end text-right">
              <span className="eyebrow text-muted-foreground">
                Elapsed
              </span>
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {fmtClock(elapsed)}
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-xs">
          <PresenceRow label="You" name={you.username} present variant="self" />
          <PresenceRow
            label="Opponent"
            name={opponent?.username ?? "—"}
            present={Boolean(opponent) && opponentPresent !== false}
            variant="opponent"
          />
        </div>
      </div>
    </div>
  );
}

function PresenceRow({
  label,
  name,
  present,
  variant,
}: {
  label: string;
  name: string;
  present: boolean;
  /** Which identity hue the online dot wears — self acid yellow vs opponent
   *  crimson. Presence is identity/neutral only, never a verdict token. */
  variant: "self" | "opponent";
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Circle
        className={cn(
          "size-2 shrink-0",
          present
            ? variant === "self"
              ? "fill-player-self text-player-self"
              : "fill-player-opponent text-player-opponent"
            : "fill-muted-foreground/40 text-muted-foreground/40",
        )}
        aria-hidden
      />
      <span className="text-muted-foreground">{label}:</span>
      <span className="truncate font-medium">{name}</span>
    </div>
  );
}
