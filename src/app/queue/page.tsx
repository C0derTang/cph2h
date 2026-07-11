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
import { HeroWord } from "@/components/hud/hero-word";
import { SlabButton } from "@/components/menu/slab-button";
import {
  QUEUE_POLL_INTERVAL_MS,
  PRESENCE_POLL_INTERVAL_MS,
  type QueueStatusResponse,
  type PresenceCounts,
} from "@/lib/types";

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
  const [presence, setPresence] = useState<PresenceCounts | null>(null);

  const goToRace = useCallback(
    (raceId: string) => {
      setPhase("matched");
      toast.success("Opponent found. Get in.");
      router.push(`/race/${raceId}`);
    },
    [router],
  );

  const errorFor = useCallback((res: Response, body: { error?: string }): string => {
    if (res.status === 401) return "Please sign in to find a race.";
    if (body.error === "cheater_blocked") {
      return "This Codeforces account is on a public cheating blocklist and can’t race.";
    }
    if (res.status === 403) return "Link your Codeforces account first.";
    return "Queue choked. Run it back.";
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
        const body = await res.json().catch(() => ({}) as { error?: string });
        const message = errorFor(res, body);
        setError(message);
        setNeedsCfLink(res.status === 403 && body.error !== "cheater_blocked");
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

  // Live queued/playing counters — polled independently of the match search so
  // they update whether or not you're currently queued.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/presence");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as PresenceCounts;
        if (!cancelled) setPresence(data);
      } catch {
        // Transient — keep the last value and retry next tick.
      }
    };
    load();
    const id = setInterval(load, PRESENCE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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
    <main className="shell-narrow relative flex flex-1 flex-col py-16 md:py-24">
      <HeroWord
        word="seek"
        className="pointer-events-none absolute -left-1 top-5 -z-10 opacity-20"
      />
      <div className="ticker rounded-[var(--radius)] px-4 py-2">
        <Swords className="size-3.5" aria-hidden />
        Quick match
      </div>

      <h1 className="mt-6 font-display text-3xl tracking-tight uppercase md:text-4xl">
        Find a race
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
        Queue up and we&apos;ll match you with an opponent near your rating
        for a live 1v1. The rating band widens the longer you wait.
      </p>

      {presence && (
        <p
          aria-live="polite"
          className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs text-muted-foreground"
        >
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-verdict-ok motion-safe:animate-pulse"
            />
            <span className="font-semibold text-foreground tabular-nums">
              {presence.queued}
            </span>
            queued
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full bg-player-self" />
            <span className="font-semibold text-foreground tabular-nums">
              {presence.playing}
            </span>
            playing
          </span>
        </p>
      )}

      <div className="panel bracket-frame relative mt-10 p-5">
        {searching && (
          <span
            aria-hidden
            className="hud-meta pointer-events-none absolute right-4 top-2.5 hidden sm:block"
          >
            {"// scan.active"}
          </span>
        )}
        <p className="font-display text-lg tracking-tight uppercase">
          {searching ? "Searching for an opponent…" : "Ready when you are"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {searching
            ? "Keep this tab open — you’ll be dropped into the race automatically."
            : "We’ll pair you with someone close to your Elo, then start a countdown."}
        </p>

        <div className="mt-6 flex flex-col gap-6">
          {searching && (
            <div className="grid grid-cols-2 gap-4">
              <div className="stat-plate p-4">
                <p className="eyebrow text-muted-foreground">
                  Elapsed
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {formatElapsed(waitedSec)}
                </p>
              </div>
              <div className="stat-plate p-4">
                <p className="eyebrow text-muted-foreground">
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

          <div className="flex flex-wrap items-center gap-3">
            {!searching ? (
              <SlabButton tone="self" size="lg" onClick={findRace}>
                <Swords aria-hidden />
                Find a race
              </SlabButton>
            ) : (
              <>
                <SlabButton tone="neutral" size="lg" disabled>
                  <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
                  {phase === "matched" ? "Opponent found." : "Searching…"}
                </SlabButton>
                <SlabButton
                  tone="destructive"
                  size="lg"
                  onClick={leaveQueue}
                  disabled={phase === "matched"}
                >
                  Leave queue
                </SlabButton>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
