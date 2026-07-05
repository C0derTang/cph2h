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
  className?: string;
}

function isAccepted(verdict: string | null): boolean {
  return verdict === "OK" || verdict === "ACCEPTED";
}

export function VerdictFeed({
  submissions,
  currentUserId,
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
      className={cn(
        "flex min-h-0 flex-col gap-2 rounded-xl border border-border bg-card/40 p-4",
        className,
      )}
    >
      <h2 className="font-heading text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        Verdicts
      </h2>
      {ordered.length === 0 ? (
        <p className="text-xs text-muted-foreground">No submissions yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 overflow-y-auto">
          {ordered.map((s) => {
            const who = s.userId === currentUserId ? "You" : "Opponent";
            const pending = s.verdict == null;
            const accepted = isAccepted(s.verdict);
            return (
              <li
                key={`${s.userId}-${s.submittedAt}`}
                data-testid="verdict-item"
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
                  pending
                    ? "border-border bg-muted/30 text-muted-foreground"
                    : accepted
                      ? "border-emerald-500/30 bg-emerald-500/10"
                      : "border-destructive/30 bg-destructive/10 text-destructive",
                )}
              >
                {pending ? (
                  <Clock3 className="size-3.5 shrink-0" aria-hidden />
                ) : accepted ? (
                  <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
                ) : (
                  <XCircle className="size-3.5 shrink-0" aria-hidden />
                )}
                <span className="font-medium">{who}:</span>
                <span className="truncate font-mono">
                  {pending ? "judging…" : s.verdict}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
