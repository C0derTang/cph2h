"use client";

/**
 * Full-screen race-end overlay (issue #113).
 *
 * A loud, game-like VICTORY / DEFEAT / DRAW slam shown the instant a race the
 * player is watching ends, so the loser (whose mic just went quiet) gets an
 * unmissable signal instead of silence. It sits ON TOP of the persistent
 * {@link ResultCard} and dismisses — on click, or after {@link AUTO_DISMISS_MS}
 * — to reveal it. Purely presentational: the parent decides when to mount it
 * from an observed snapshot transition (see `detectOverlayOutcome`), and all
 * values shown here come from that snapshot, never a LiveKit event payload.
 *
 * Aesthetic follows the versus-poster lockup (champion gold / challenger
 * crimson, `stamp` display type) already used in the Lobby and ResultCard.
 */

import { useEffect } from "react";
import { Frown, Handshake, Trophy } from "lucide-react";

import { cn } from "@/lib/utils";
import type { OverlayOutcome } from "@/lib/race/overlay";

/** How long the overlay stays up before auto-dismissing to the result card. */
export const AUTO_DISMISS_MS = 5000;

export interface RaceEndOverlayProps {
  /** Never "none" here — the parent only mounts this on a real transition. */
  outcome: Exclude<OverlayOutcome, "none">;
  opponentUsername: string | null;
  /** The viewer's own Elo delta from the snapshot (± shown), or null. */
  eloDelta: number | null;
  /** Win/loss by forfeit or absence (no winning submission) vs. an actual solve. */
  byForfeit: boolean;
  onDismiss: () => void;
}

const HEADLINE: Record<RaceEndOverlayProps["outcome"], string> = {
  victory: "VICTORY",
  defeat: "DEFEAT",
  draw: "DRAW",
};

function subheadline(
  outcome: RaceEndOverlayProps["outcome"],
  opponent: string | null,
  byForfeit: boolean,
): string {
  const who = opponent ?? "your opponent";
  switch (outcome) {
    case "victory":
      return byForfeit
        ? `${who} bailed. The win is yours.`
        : `You beat ${who} to the solve.`;
    case "defeat":
      return byForfeit
        ? `You threw in the towel against ${who}.`
        : `${who} solved it first.`;
    case "draw":
      return "Neither of you closed it out.";
  }
}

export function RaceEndOverlay({
  outcome,
  opponentUsername,
  eloDelta,
  byForfeit,
  onDismiss,
}: RaceEndOverlayProps) {
  // Auto-dismiss after a beat; any click also dismisses (handled on the root).
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const isVictory = outcome === "victory";
  const isDefeat = outcome === "defeat";

  return (
    <div
      data-testid="race-end-overlay"
      role="alertdialog"
      aria-label={`${HEADLINE[outcome]} — race over`}
      onClick={onDismiss}
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-6 bg-background/85 p-6 text-center backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
    >
      <div
        aria-hidden
        className="spotlight pointer-events-none absolute inset-0 -z-10"
      />

      <span className="font-mono text-[11px] tracking-[0.4em] text-muted-foreground uppercase">
        Race over
      </span>

      <div className="flex flex-col items-center gap-3">
        <OverlayIcon outcome={outcome} />
        <h1
          data-testid="race-end-headline"
          className={cn(
            "stamp text-6xl sm:text-7xl md:text-8xl",
            isVictory && "text-player-self",
            isDefeat && "text-player-opponent",
            outcome === "draw" && "text-foreground",
          )}
        >
          {HEADLINE[outcome]}
        </h1>
      </div>

      <p className="max-w-md text-sm text-muted-foreground sm:text-base">
        {subheadline(outcome, opponentUsername, byForfeit)}
      </p>

      {eloDelta != null && (
        <div className="flex flex-col items-center gap-1">
          <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
            Elo
          </span>
          <span
            data-testid="race-end-elo"
            className={cn(
              "font-mono text-4xl font-semibold tabular-nums sm:text-5xl",
              eloDelta > 0 && "text-verdict-ok",
              eloDelta < 0 && "text-verdict-fail",
            )}
          >
            {eloDelta >= 0 ? "+" : ""}
            {eloDelta}
          </span>
        </div>
      )}

      <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground/70 uppercase">
        Click to continue
      </span>
    </div>
  );
}

function OverlayIcon({ outcome }: { outcome: RaceEndOverlayProps["outcome"] }) {
  switch (outcome) {
    case "victory":
      return <Trophy className="size-12 text-player-self" aria-hidden />;
    case "defeat":
      return <Frown className="size-12 text-player-opponent" aria-hidden />;
    case "draw":
      return <Handshake className="size-12 text-muted-foreground" aria-hidden />;
  }
}
