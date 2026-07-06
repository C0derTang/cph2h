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

import { Badge } from "@/components/ui/badge";
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
      className={cn("panel flex min-h-0 flex-col overflow-hidden", className)}
    >
      <div className="ticker justify-between px-4 py-2">
        <span>verdicts</span>
        <span className="flex items-center gap-1.5 text-verdict-pending">
          <span className="size-1.5 rounded-full bg-verdict-pending motion-safe:animate-pulse" />
          live
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
              const variant = pending
                ? "verdict-pending"
                : accepted
                  ? "verdict-ok"
                  : "verdict-fail";
              return (
                <li
                  key={`${s.userId}-${s.submittedAt}`}
                  data-testid="verdict-item"
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border bg-muted/20 px-2.5 py-1.5 text-xs"
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
                  <Badge variant={variant} className="font-mono">
                    {pending ? "judging…" : s.verdict}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
