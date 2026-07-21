"use client";

/**
 * Quick-match waiting room (issue #14).
 *
 * "Find a race" POSTs to /api/queue to enqueue (pairing may happen instantly),
 * then polls GET /api/queue every `QUEUE_POLL_INTERVAL_MS`, showing elapsed
 * wait time and the widening Elo band. On a match it redirects to the race;
 * "Leave queue" DELETEs the entry.
 *
 * Issue #276 adds two things: rehydration (a mount-time GET so a page refresh
 * while queued resumes the countdown instead of flashing "Find a race" and
 * silently orphaning the server-side queue row) and pre-queue problem
 * filters, mirroring `Lobby`'s in-race filter editor/summary but owned here
 * since a queue entry — unlike a race — has no PATCH endpoint of its own; the
 * chosen filters are simply POSTed along with the enqueue request.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Swords, LoaderCircle, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroWord } from "@/components/hud/hero-word";
import { SlabButton } from "@/components/menu/slab-button";
import {
  EMPTY_FILTERS,
  filterSummary,
  FilterEditor,
  type FilterPayload,
} from "@/components/race/FilterEditor";
import {
  QUEUE_POLL_INTERVAL_MS,
  PRESENCE_POLL_INTERVAL_MS,
  type QueueStatusResponse,
  type PresenceCounts,
  type RaceProblemFilters,
} from "@/lib/types";
import { jitteredDelayMs } from "@/lib/poll-timing";

type Phase = "restoring" | "idle" | "searching" | "matched" | "error";

interface EnqueueResponse {
  matched: boolean;
  raceId?: string;
}

/** Error-path enqueue response body — a 409 carries the race the caller is already in. */
interface QueueErrorBody {
  error?: string;
  raceId?: string;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** `RaceProblemFilters` (full, nullable) -> the enqueue POST's omit-null wire shape. */
function filtersToPayload(filters: RaceProblemFilters): FilterPayload {
  return {
    ...(filters.ratingMin !== null ? { ratingMin: filters.ratingMin } : {}),
    ...(filters.ratingMax !== null ? { ratingMax: filters.ratingMax } : {}),
    ...(filters.dateFrom !== null ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo !== null ? { dateTo: filters.dateTo } : {}),
  };
}

/** The `FilterEditor`'s save payload (omit-null) -> the full nullable shape we store. */
function payloadToFilters(payload: FilterPayload): RaceProblemFilters {
  return {
    ratingMin: payload.ratingMin ?? null,
    ratingMax: payload.ratingMax ?? null,
    dateFrom: payload.dateFrom ?? null,
    dateTo: payload.dateTo ?? null,
  };
}

export default function QueuePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("restoring");
  const [error, setError] = useState<string | null>(null);
  const [needsCfLink, setNeedsCfLink] = useState(false);
  const [waitedSec, setWaitedSec] = useState(0);
  const [band, setBand] = useState<number | null>(null);
  const [enqueuedAt, setEnqueuedAt] = useState<number | null>(null);
  const [presence, setPresence] = useState<PresenceCounts | null>(null);
  const [filters, setFilters] = useState<RaceProblemFilters>(EMPTY_FILTERS);
  const [editingFilters, setEditingFilters] = useState(false);

  const goToRace = useCallback(
    (raceId: string) => {
      setPhase("matched");
      toast.success("Opponent found. Get in.");
      router.push(`/race/${raceId}`);
    },
    [router],
  );

  const errorFor = useCallback((res: Response, body: QueueErrorBody): string => {
    if (res.status === 401) return "Please sign in to find a race.";
    if (body.error === "cheater_blocked") {
      return "This Codeforces account is on a public cheating blocklist and can’t race.";
    }
    if (res.status === 403) return "Link your Codeforces account first.";
    if (res.status === 422 && body.error === "no_problems_in_range") {
      return "No problems match those filters — widen them.";
    }
    return "Queue choked. Run it back.";
  }, []);

  // Rehydration (issue #276): a mount-time GET so a page refresh (or any
  // remount) while a queue row already exists resumes the search in place —
  // without this, the page would flash "Find a race" over a queue row the
  // server still holds, and a click would stack a second (harmless but
  // confusing) enqueue on top of it. Runs once; fails open to "idle" on any
  // non-restorable state or error so the user is never stuck on a dead
  // "Checking queue…" screen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/queue", { method: "GET" });
        if (cancelled) return;
        if (!res.ok) {
          setPhase("idle");
          return;
        }
        const data = (await res.json()) as QueueStatusResponse;
        if (cancelled) return;
        if (data.state === "matched" && data.raceId) {
          goToRace(data.raceId);
          return;
        }
        if (data.state === "queued") {
          const waited = data.waitedSec ?? 0;
          setWaitedSec(waited);
          setBand(data.currentBand);
          setEnqueuedAt(Date.now() - waited * 1000);
          setFilters(data.filters ?? EMPTY_FILTERS);
          // The existing poll effect (keyed off `phase === "searching"`)
          // takes over from here.
          setPhase("searching");
          return;
        }
        setPhase("idle");
      } catch {
        if (!cancelled) setPhase("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [goToRace]);

  const findRace = useCallback(async () => {
    setError(null);
    setNeedsCfLink(false);
    setPhase("searching");
    setWaitedSec(0);
    setBand(null);
    setEnqueuedAt(Date.now());
    try {
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(filtersToPayload(filters)),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as QueueErrorBody);
        if (res.status === 409 && body.error === "already_in_race" && body.raceId) {
          goToRace(body.raceId);
          return;
        }
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
  }, [errorFor, goToRace, filters]);

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
    setEditingFilters(false);
  }, []);

  // Poll for a match while searching (self-rescheduling, jittered — issue
  // #254). A 429 (our own future rate limiter, wave-10) falls into the same
  // `!res.ok` no-op as any other transient failure: skip this tick's state
  // update and keep polling at the normal jittered cadence.
  useEffect(() => {
    if (phase !== "searching") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

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
      } finally {
        if (!cancelled) schedule();
      }
    };

    const schedule = () => {
      timer = setTimeout(() => void poll(), jitteredDelayMs(QUEUE_POLL_INTERVAL_MS));
    };

    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, goToRace]);

  // Live queued/playing counters — polled independently of the match search
  // (including while restoring) so they update whether or not you're
  // currently queued. Self-rescheduling and jittered (issue #254); a 429 is
  // just another transient `!res.ok` no-op — keep the last value, keep
  // polling.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const res = await fetch("/api/presence");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as PresenceCounts;
        if (!cancelled) setPresence(data);
      } catch {
        // Transient — keep the last value and retry next tick.
      } finally {
        if (!cancelled) schedule();
      }
    };

    const schedule = () => {
      timer = setTimeout(() => void load(), jitteredDelayMs(PRESENCE_POLL_INTERVAL_MS));
    };

    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
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

  const restoring = phase === "restoring";
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
          {restoring
            ? "Checking queue…"
            : searching
              ? "Searching for an opponent…"
              : "Ready when you are"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {restoring
            ? "One second — restoring your session…"
            : searching
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

          {!restoring && (
            <div className="flex flex-col gap-3" data-testid="queue-filters">
              {editingFilters && !searching ? (
                <FilterEditor
                  filters={filters}
                  saving={false}
                  onCancel={() => setEditingFilters(false)}
                  onSave={(payload) => {
                    setFilters(payloadToFilters(payload));
                    setEditingFilters(false);
                  }}
                  submitLabel="Apply filters"
                />
              ) : (
                <div className="stat-plate flex flex-col gap-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="eyebrow text-muted-foreground">
                        Problem filters
                      </span>
                      <span className="truncate font-mono text-xs">
                        {filterSummary(filters)}
                      </span>
                    </div>
                    {!searching && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingFilters(true)}
                      >
                        <SlidersHorizontal aria-hidden />
                        Edit
                      </Button>
                    )}
                  </div>
                  {searching && (
                    <p className="text-xs text-muted-foreground">
                      Locked while queued.
                    </p>
                  )}
                </div>
              )}
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
            {restoring ? (
              <SlabButton tone="neutral" size="lg" disabled>
                <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
                Checking queue…
              </SlabButton>
            ) : !searching ? (
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
