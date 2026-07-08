"use client";

/**
 * Verdict feed (issue #17).
 *
 * Presentational running list of submission verdicts, derived from the race
 * snapshot's `submissions` (the source of truth — LiveKit `verdict` events are
 * only hints that trigger a refetch). Each entry reads e.g.
 * "You: WRONG_ANSWER" / "Opponent: OK". Pending (un-judged) submissions show as
 * "judging…".
 */

import { CheckCircle2, Clock3, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import type { RaceSubmissionInfo } from "@/lib/types";

interface VerdictFeedProps {
  submissions: RaceSubmissionInfo[];
  currentUserId: string;
  /**
   * Seconds since the last successful verdict-poll response (including a
   * `{ skipped: true }` mutex miss — that still proves the loop is alive),
   * or null before the first response has landed. Drives the "Watching CF"
   * auto-poll indicator (issue #107) so the invisible background poll isn't
   * mistaken for the UI being stuck.
   */
  lastCheckedSecondsAgo: number | null;
  className?: string;
}

function isAccepted(verdict: string | null): boolean {
  return verdict === "OK" || verdict === "ACCEPTED";
}

export function VerdictFeed({
  submissions,
  currentUserId,
  lastCheckedSecondsAgo,
  className,
}: VerdictFeedProps) {
  // Most recent first.
  const ordered = [...submissions].sort(
    (a, b) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );

  return (
    <div
      data-testid="verdict-feed"
      className={cn("panel flex min-h-0 flex-col overflow-hidden", className)}
    >
      <div className="ticker justify-between px-4 py-2">
        <span>verdicts</span>
        <span
          data-testid="verdict-poll-indicator"
          className="flex items-center gap-1.5 text-verdict-pending"
        >
          <span className="size-1.5 rounded-full bg-verdict-pending motion-safe:animate-pulse" />
          {lastCheckedSecondsAgo != null ? (
            <>
              Watching CF · checked{" "}
              <span className="font-mono tabular-nums">
                {lastCheckedSecondsAgo}s
              </span>{" "}
              ago
            </>
          ) : (
            "Watching CF"
          )}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {ordered.length === 0 ? (
          <p className="text-xs text-muted-foreground">No submissions yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 overflow-y-auto">
            {ordered.map((s) => {
              const who = s.userId === currentUserId ? "You" : "Opponent";
              const pending = s.verdict == null;
              const accepted = isAccepted(s.verdict);
              const tone = pending
                ? "text-verdict-pending"
                : accepted
                  ? "text-verdict-ok"
                  : "text-verdict-fail";
              return (
                <li
                  key={`${s.userId}-${s.submittedAt}`}
                  data-testid="verdict-item"
                  // Hard-edged hairline row: flat inset fill, no rounding —
                  // the HUD plate language at feed-row scale.
                  className="flex items-center justify-between gap-2 rounded-none border border-border bg-background/40 px-2.5 py-1.5 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {pending ? (
                      <Clock3 className="size-3.5 shrink-0 text-verdict-pending" aria-hidden />
                    ) : accepted ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-verdict-ok" aria-hidden />
                    ) : (
                      <XCircle className="size-3.5 shrink-0 text-verdict-fail" aria-hidden />
                    )}
                    <span className="font-medium">{who}</span>
                  </span>
                  {/* The stamp marks a judged verdict moment ONLY (AC / WA…);
                      a still-pending submission is not a verdict yet, so it
                      stays plain mono. Data stays data — the raw CF verdict
                      string is always the label, hue never carries alone. */}
                  {pending ? (
                    <span className={cn("shrink-0 font-mono text-[10px] uppercase tracking-[0.12em]", tone)}>
                      judging…
                    </span>
                  ) : (
                    <span className={cn("stamp shrink-0 text-[10px]", tone)}>
                      {s.verdict}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
