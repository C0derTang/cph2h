"use client";

/**
 * Race result card (issue #17).
 *
 * Shown for `finished`/`aborted` races: win/loss/draw from the viewer's
 * perspective, the winning submission (linked to Codeforces when known), the
 * Elo deltas, and next-step links (rematch → new challenge, back to dashboard).
 * Presentational — the parent decides when to render it from the snapshot.
 */

import Link from "next/link";
import { Frown, Handshake, Minus, Swords, Trophy } from "lucide-react";

import { SlabButton } from "@/components/menu/slab-button";
import { cn } from "@/lib/utils";
import type { RaceSnapshot } from "@/lib/types";

interface ResultCardProps {
  snapshot: RaceSnapshot;
  currentUserId: string;
  className?: string;
}

type Result = "win" | "loss" | "draw" | "aborted";

function resultFor(snapshot: RaceSnapshot, userId: string): Result {
  if (snapshot.status === "aborted" || snapshot.outcome === "aborted") {
    return "aborted";
  }
  if (snapshot.outcome === "draw") return "draw";
  if (snapshot.winnerId == null) return "draw";
  return snapshot.winnerId === userId ? "win" : "loss";
}

const HEADING: Record<Result, string> = {
  win: "Bodied.",
  loss: "You got bodied.",
  draw: "Draw",
  aborted: "Race cancelled",
};

const SUBHEADING: Record<Result, string> = {
  win: "First to a correct submission. Nicely done.",
  loss: "Your opponent solved it first. Run it back?",
  draw: "Neither player solved it in time.",
  aborted: "This race ended before a winner was decided.",
};

export function ResultCard({
  snapshot,
  currentUserId,
  className,
}: ResultCardProps) {
  const result = resultFor(snapshot, currentUserId);
  const isP1 = snapshot.p1.id === currentUserId;

  // Both sides' data is already on the snapshot — surfacing the opponent's
  // half too (winner glow / delta) is a display-only addition, no new
  // fetches or state.
  const p1IsWinner = snapshot.winnerId != null && snapshot.winnerId === snapshot.p1.id;
  const p2IsWinner =
    snapshot.winnerId != null && snapshot.p2 != null && snapshot.winnerId === snapshot.p2.id;

  const winningSub =
    snapshot.winnerId != null
      ? snapshot.submissions.find(
          (s) => s.userId === snapshot.winnerId && s.cfSubmissionId != null,
        )
      : undefined;

  const cfSubmissionUrl =
    winningSub?.cfSubmissionId != null && snapshot.problem
      ? `https://codeforces.com/contest/${snapshot.problem.contestId}/submission/${winningSub.cfSubmissionId}`
      : null;

  return (
    <div
      data-testid="result-card"
      className={cn("panel clip-notch w-full max-w-lg overflow-hidden", className)}
    >
      <div className="ticker justify-between px-4 py-2.5">
        <span>race &middot; result</span>
        <span className="flex items-center gap-1.5">
          <ResultIcon result={result} />
        </span>
      </div>

      <div className="flex flex-col items-center gap-3 p-6 text-center">
        {result === "win" || result === "loss" ? (
          <h2
            data-testid="result-heading"
            className={cn(
              "stamp text-3xl sm:text-4xl",
              result === "win" ? "text-player-self" : "text-foreground",
            )}
          >
            {HEADING[result]}
          </h2>
        ) : (
          <h2
            data-testid="result-heading"
            className="font-display text-2xl tracking-tight uppercase"
          >
            {HEADING[result]}
          </h2>
        )}
        <p className="text-sm text-muted-foreground">{SUBHEADING[result]}</p>
      </div>

      <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
        <PlayerResultTile
          username={snapshot.p1.username}
          eloDelta={snapshot.eloDeltaP1}
          winner={p1IsWinner}
          tone="self"
          isYou={isP1}
        />
        <PlayerResultTile
          username={snapshot.p2?.username ?? "—"}
          eloDelta={snapshot.eloDeltaP2}
          winner={p2IsWinner}
          tone="opponent"
          isYou={!isP1}
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-border p-5">
        {snapshot.problem && (
          <div className="stat-plate flex flex-col gap-1 p-3">
            <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
              Problem
            </span>
            <a
              href={snapshot.problem.url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm font-medium text-primary hover:underline"
            >
              {snapshot.problem.id} · {snapshot.problem.name}
            </a>
          </div>
        )}

        <div className="stat-plate flex items-center justify-between gap-2 p-3">
          <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
            Winning submission
          </span>
          <span className="font-mono text-sm font-semibold tabular-nums">
            {cfSubmissionUrl ? (
              <a
                href={cfSubmissionUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                #{winningSub?.cfSubmissionId}
              </a>
            ) : (
              "—"
            )}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-5 sm:flex-row">
        <SlabButton
          tone="self"
          className="flex-1"
          render={<Link href="/challenge/new" />}
          nativeButton={false}
          data-testid="rematch-btn"
        >
          <Swords aria-hidden />
          Rematch
        </SlabButton>
        <SlabButton
          tone="neutral"
          className="flex-1"
          render={<Link href="/dashboard" />}
          nativeButton={false}
        >
          Back to dashboard
        </SlabButton>
      </div>
    </div>
  );
}

function PlayerResultTile({
  username,
  eloDelta,
  winner,
  tone,
  isYou,
}: {
  username: string;
  eloDelta: number | null;
  winner: boolean;
  tone: "self" | "opponent";
  isYou: boolean;
}) {
  const isSelf = tone === "self";
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 p-4 text-center",
        winner && (isSelf ? "bg-player-self/10" : "bg-player-opponent/10"),
        !winner && "opacity-60",
      )}
    >
      <span
        className={cn(
          "flex size-9 items-center justify-center font-display text-sm font-bold",
          isSelf
            ? "bg-player-self text-player-self-foreground"
            : "bg-player-opponent text-player-opponent-foreground",
        )}
      >
        {username.charAt(0).toUpperCase()}
      </span>
      <p className="truncate text-sm font-medium">
        {username} {isYou && <span className="text-muted-foreground">(you)</span>}
      </p>
      <p
        className={cn(
          "font-mono text-lg font-semibold tabular-nums",
          eloDelta != null && eloDelta > 0 && "text-verdict-ok",
          eloDelta != null && eloDelta < 0 && "text-verdict-fail",
        )}
      >
        {eloDelta == null ? "—" : `${eloDelta >= 0 ? "+" : ""}${eloDelta}`}
      </p>
    </div>
  );
}

function ResultIcon({ result }: { result: Result }) {
  switch (result) {
    case "win":
      return <Trophy className="size-4 text-verdict-ok" aria-hidden />;
    case "loss":
      return <Frown className="size-4 text-verdict-fail" aria-hidden />;
    case "draw":
      return <Handshake className="size-4 text-muted-foreground" aria-hidden />;
    case "aborted":
      return <Minus className="size-4 text-muted-foreground" aria-hidden />;
  }
}
