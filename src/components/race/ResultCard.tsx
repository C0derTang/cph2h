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

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  win: "You won!",
  loss: "You lost",
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
  const eloDelta = isP1 ? snapshot.eloDeltaP1 : snapshot.eloDeltaP2;

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
    <Card data-testid="result-card" className={cn("w-full max-w-lg", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ResultIcon result={result} />
          <span data-testid="result-heading">{HEADING[result]}</span>
        </CardTitle>
        <CardDescription>{SUBHEADING[result]}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {snapshot.problem && (
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card/40 p-3">
            <span className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
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

        <div className="grid grid-cols-2 gap-3">
          <Stat
            label="Elo change"
            value={
              eloDelta == null
                ? "—"
                : `${eloDelta >= 0 ? "+" : ""}${eloDelta}`
            }
            valueClassName={cn(
              eloDelta != null && eloDelta > 0 && "text-emerald-500",
              eloDelta != null && eloDelta < 0 && "text-destructive",
            )}
          />
          <Stat
            label="Winning submission"
            value={
              cfSubmissionUrl ? (
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
              )
            }
          />
        </div>
      </CardContent>

      <CardFooter className="gap-2">
        <Button
          render={<Link href="/challenge/new" />}
          nativeButton={false}
          data-testid="rematch-btn"
        >
          <Swords aria-hidden />
          Rematch
        </Button>
        <Button
          variant="outline"
          render={<Link href="/dashboard" />}
          nativeButton={false}
        >
          Back to dashboard
        </Button>
      </CardFooter>
    </Card>
  );
}

function ResultIcon({ result }: { result: Result }) {
  switch (result) {
    case "win":
      return <Trophy className="size-5 text-emerald-500" aria-hidden />;
    case "loss":
      return <Frown className="size-5 text-destructive" aria-hidden />;
    case "draw":
      return <Handshake className="size-5 text-muted-foreground" aria-hidden />;
    case "aborted":
      return <Minus className="size-5 text-muted-foreground" aria-hidden />;
  }
}

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card/40 p-3">
      <span className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className={cn("font-mono text-lg font-semibold", valueClassName)}>
        {value}
      </span>
    </div>
  );
}
