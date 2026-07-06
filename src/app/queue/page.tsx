"use client";

/**
 * Quick-match waiting room (issue #14).
 *
 * "Find a race" POSTs to /api/queue to enqueue (pairing may happen instantly),
 * then polls GET /api/queue every `QUEUE_POLL_INTERVAL_MS`, showing elapsed
 * wait time and the widening Elo band. On a match it redirects to the race;
 * "Leave queue" DELETEs the entry.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Swords, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QUEUE_POLL_INTERVAL_MS, type QueueStatusResponse } from "@/lib/types";

type Phase = "idle" | "searching" | "matched" | "error";

interface EnqueueResponse {
  matched: boolean;
  raceId?: string;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function QueuePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [needsCfLink, setNeedsCfLink] = useState(false);
  const [waitedSec, setWaitedSec] = useState(0);
  const [band, setBand] = useState<number | null>(null);
  const [enqueuedAt, setEnqueuedAt] = useState<number | null>(null);

  const goToRace = useCallback(
    (raceId: string) => {
      setPhase("matched");
      toast.success("Match found! Heading to the race…");
      router.push(`/race/${raceId}`);
    },
    [router],
  );

  const errorFor = useCallback((res: Response): string => {
    if (res.status === 401) return "Please sign in to find a race.";
    if (res.status === 403) return "Link your Codeforces account first.";
    return "Something went wrong. Please try again.";
  }, []);

  const findRace = useCallback(async () => {
    setError(null);
    setNeedsCfLink(false);
    setPhase("searching");
    setWaitedSec(0);
    setBand(null);
    setEnqueuedAt(Date.now());
    try {
      const res = await fetch("/api/queue", { method: "POST" });
      if (!res.ok) {
        const message = errorFor(res);
        setError(message);
        setNeedsCfLink(res.status === 403);
        setPhase("error");
        toast.error(message);
        return;
      }
      const data = (await res.json()) as EnqueueResponse;
      if (data.matched && data.raceId) {
        goToRace(data.raceId);
      }
    } catch {
      setError("Network error. Please try again.");
      setPhase("error");
      toast.error("Network error. Please try again.");
    }
  }, [errorFor, goToRace]);

  const leaveQueue = useCallback(async () => {
    try {
      await fetch("/api/queue", { method: "DELETE" });
    } catch {
      // Best-effort; the sweep cron reclaims ghost entries.
    }
    setPhase("idle");
    setWaitedSec(0);
    setBand(null);
    setEnqueuedAt(null);
  }, []);

  // Poll for a match while searching.
  useEffect(() => {
    if (phase !== "searching") return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/queue", { method: "GET" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as QueueStatusResponse;
        if (cancelled) return;
        if (data.state === "matched" && data.raceId) {
          goToRace(data.raceId);
        } else if (data.state === "idle") {
          // Entry vanished without a race (e.g. swept) — reset.
          setPhase("idle");
        } else {
          if (data.currentBand != null) setBand(data.currentBand);
          if (data.waitedSec != null) setWaitedSec(data.waitedSec);
        }
      } catch {
        // Transient — keep polling.
      }
    };

    const id = setInterval(poll, QUEUE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, goToRace]);

  // Local 1s ticker so elapsed time advances smoothly between polls.
  useEffect(() => {
    if (phase !== "searching" || enqueuedAt == null) return;
    const id = setInterval(() => {
      setWaitedSec(Math.max(0, Math.floor((Date.now() - enqueuedAt) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [phase, enqueuedAt]);

  const searching = phase === "searching" || phase === "matched";

  return (
    <main className="shell-narrow flex flex-1 flex-col py-16 md:py-24">
      <p className="font-mono text-xs text-muted-foreground">
        <span className="text-player-self">$</span> cd ~/cph2h/queue
      </p>

      <div className="mt-6 flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius)] border border-player-self/40 bg-player-self/10 text-player-self">
          <Swords className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl tracking-tight uppercase md:text-3xl">
            Find a race
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            Queue up and we&apos;ll match you with an opponent near your rating
            for a live 1v1. The rating band widens the longer you wait.
          </p>
        </div>
      </div>

      <div className="panel mt-10 p-5">
        <p className="font-display text-lg tracking-tight uppercase">
          {searching ? "Searching for an opponent…" : "Ready when you are"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {searching
            ? "Keep this tab open — you'll be dropped into the race automatically."
            : "We'll pair you with someone close to your Elo, then start a countdown."}
        </p>

        <div className="mt-6 flex flex-col gap-6">
          {searching && (
            <div className="grid grid-cols-2 gap-4">
              <div className="stat-plate p-4">
                <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                  Elapsed
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {formatElapsed(waitedSec)}
                </p>
              </div>
              <div className="stat-plate p-4">
                <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                  Rating band
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {band != null ? `±${band}` : "±100"}
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
              {needsCfLink && (
                <Button
                  render={<Link href="/settings/cf" />}
                  nativeButton={false}
                  variant="outline"
                  size="sm"
                  className="self-start"
                >
                  Link Codeforces account
                </Button>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            {!searching ? (
              <Button onClick={findRace} size="lg">
                <Swords aria-hidden />
                Find a race
              </Button>
            ) : (
              <>
                <Button variant="outline" size="lg" disabled>
                  <LoaderCircle className="animate-spin" aria-hidden />
                  {phase === "matched" ? "Match found!" : "Searching…"}
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={leaveQueue}
                  disabled={phase === "matched"}
                >
                  Leave queue
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
