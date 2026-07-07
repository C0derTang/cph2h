"use client";

/**
 * Race room orchestrator (issue #17) — the integration capstone.
 *
 * Owns the client-side race state and wires the already-built pieces together:
 *   - pending/ready  → the standalone {@link Lobby} (#16)
 *   - active         → the stage (issue #99): {@link ProblemPane} (#9) beside a
 *                      dominant center stage of {@link VideoTiles} (opponent
 *                      spotlight + self PiP) with the {@link TauntPicker} and
 *                      big Submit/Check actions attached, and a {@link RaceHUD}
 *                      + {@link VerdictFeed} rail. No in-room editor: racers
 *                      write in their own environment and submit on codeforces.com.
 *   - finished/aborted → {@link ResultCard}
 *
 * The `GET /api/races/[id]` snapshot is the single source of truth. LiveKit
 * data-channel `RaceEvent`s are treated as *hints*: any event (and every
 * (re)connect / mount) triggers a snapshot refetch. While active, the client
 * also POSTs `/api/races/[id]/poll` on a jittered interval to drive CF verdict
 * polling, stopping once the race is terminal.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConnectionState } from "livekit-client";
import {
  LiveKitRoom,
  useConnectionState,
  useDataChannel,
  useRemoteParticipants,
} from "@livekit/components-react";
import {
  Check,
  ExternalLink,
  Flag,
  Handshake,
  Loader2,
  MicOff,
  MonitorSmartphone,
  RefreshCw,
  WifiOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProblemPane } from "@/components/race/ProblemPane";
import { Lobby } from "@/components/race/Lobby";
import { RaceHUD } from "@/components/race/RaceHUD";
import { VerdictFeed } from "@/components/race/VerdictFeed";
import { ResultCard } from "@/components/race/ResultCard";
import { VideoTiles } from "@/components/race/VideoTiles";
import { TauntPicker } from "@/components/race/TauntPicker";
import { useMicPermission } from "@/components/race/useMicPermission";
import {
  CLIENT_POLL_INTERVAL_MS,
  LIVEKIT_DATA_TOPIC,
  decodeRaceEvent,
  type RaceSnapshot,
} from "@/lib/types";
import {
  classifyPollResponse,
  computeSkewMs,
  correctedNow,
  nextRetryDelay,
  unlockRescheduleDelay,
} from "@/lib/race/countdown";
import { addTaunt, expireTaunt, type TauntBubbles } from "@/lib/race/taunts";
import { refetchThrottleDecision } from "@/lib/race/refetch-throttle";

interface RaceRoomProps {
  raceId: string;
  currentUserId: string;
  initialSnapshot: RaceSnapshot;
}

interface LivekitConn {
  token: string;
  url: string;
}

/** How long the opponent's video track must be absent before we surface a
 *  disconnect banner (avoids flapping on brief network blips / reconnects). */
const DISCONNECT_GRACE_MS = 20_000;

/** Consecutive failed verdict polls before we show a "having trouble" banner
 *  with a manual retry — a single blip is normal and shouldn't alarm anyone. */
const POLL_FAILURE_THRESHOLD = 3;

/** Build the Codeforces submit page URL for a contest problem. */
function cfSubmitUrl(contestId: number): string {
  return `https://codeforces.com/contest/${contestId}/submit`;
}

export function RaceRoom({
  raceId,
  currentUserId,
  initialSnapshot,
}: RaceRoomProps) {
  const [snapshot, setSnapshot] = useState<RaceSnapshot>(initialSnapshot);
  const [lk, setLk] = useState<LivekitConn | null>(null);
  const [checking, setChecking] = useState(false);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [opponentLive, setOpponentLive] = useState(true);
  const [forfeiting, setForfeiting] = useState(false);
  const [drawActionPending, setDrawActionPending] = useState(false);
  const [pollDegraded, setPollDegraded] = useState(false);
  const [taunts, setTaunts] = useState<TauntBubbles>({});
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFailuresRef = useRef(0);

  const status = snapshot.status;

  // --- Mid-race mic revocation (issue #100) --------------------------------
  // The compete gate only blocks the ready button; once a race is active it
  // is grace-only, per the issue — a revoked mic never forfeits or blocks
  // play, it just surfaces a banner. `everGrantedMic` tracks "we saw it
  // granted at some point this mount" (mirrors `VideoTiles`'
  // `everConnected` pattern) so a browser that never had the Permissions API
  // (permissionState stays `null` throughout) never shows a false "revoked"
  // banner it was never in a position to detect.
  const mic = useMicPermission();
  const everGrantedMicRef = useRef(false);
  const [everGrantedMic, setEverGrantedMic] = useState(false);
  useEffect(() => {
    if (mic.micGranted && !everGrantedMicRef.current) {
      everGrantedMicRef.current = true;
      setEverGrantedMic(true);
    }
  }, [mic.micGranted]);
  const micRevokedMidRace = status === "active" && everGrantedMic && !mic.micGranted;

  // --- Clock skew correction ----------------------------------------------
  // The server's `now` (snapshot build time) vs. the local clock at receipt —
  // recomputed on every snapshot receipt so countdown/unlock timing never
  // trusts a skewed local clock (see `src/lib/race/countdown.ts`). Kept as
  // state (not just a ref) because RaceHUD needs the current value at render
  // time; a ref mirror is synced separately for use inside timer callbacks
  // (effects/timeouts) so those don't need to depend on — and restart on —
  // every skew update.
  const [skewMs, setSkewMs] = useState(() =>
    computeSkewMs(initialSnapshot.now, Date.now()),
  );
  const skewMsRef = useRef(skewMs);
  useEffect(() => {
    skewMsRef.current = skewMs;
  }, [skewMs]);

  // Mirrors `snapshot` for read access inside timer callbacks without
  // recreating them on every snapshot update.
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const applySnapshot = useCallback((data: RaceSnapshot) => {
    setSkewMs(computeSkewMs(data.now, Date.now()));
    setSnapshot(data);
  }, []);

  // --- Snapshot refetch (source of truth) --------------------------------
  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/races/${raceId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as RaceSnapshot;
      if (data && typeof data.status === "string") applySnapshot(data);
    } catch {
      // Transient — the poll loop / next event will retry.
    }
  }, [raceId, applySnapshot]);

  // Refetch once on mount (per spec: mount is a refetch trigger). Deferred so
  // the async setState never runs synchronously inside the effect body.
  useEffect(() => {
    const id = setTimeout(() => void refetch(), 0);
    return () => clearTimeout(id);
  }, [refetch]);

  // --- LiveKit token (best-effort; race still works without video) --------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raceId }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { token?: string; url?: string };
        if (!cancelled && data.token && data.url) {
          setLk({ token: data.token, url: data.url });
        }
      } catch {
        // No video — the rest of the room degrades gracefully.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  // --- Lobby snapshot poll (pending/ready only, jittered) -----------------
  // `Lobby` polls its own copy of the snapshot to drive its own UI, but that
  // state never flows back up — RaceRoom's `snapshot` (which selects this
  // pending/ready branch and drives `race-status`) was previously only
  // refreshed by the one-time mount refetch and LiveKit hints, which aren't
  // mounted until the active branch. Without a LiveKit event, RaceRoom could
  // stay stuck showing `pending` even after the opponent readies up. Poll
  // `refetch()` here too so RaceRoom advances pending → ready → active on its
  // own, consistent with "events are hints, GET is truth."
  useEffect(() => {
    if (status !== "pending" && status !== "ready") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await refetch();
      if (!cancelled) schedule();
    };

    const schedule = () => {
      const jitter = Math.floor(Math.random() * 1500);
      timer = setTimeout(() => void tick(), CLIENT_POLL_INTERVAL_MS + jitter);
    };

    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, refetch]);

  // --- Verdict poll loop (active only, jittered) --------------------------
  useEffect(() => {
    if (status !== "active") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch(`/api/races/${raceId}/poll`, { method: "POST" });
        if (!res.ok) throw new Error(`poll failed (${res.status})`);
        const data: unknown = await res.json().catch(() => null);
        const classified = classifyPollResponse(data);
        if (!cancelled) {
          if (classified.kind === "snapshot") {
            applySnapshot(classified.snapshot);
          } else if (
            classified.kind === "skipped" &&
            snapshotRef.current.status === "active" &&
            snapshotRef.current.statement == null
          ) {
            // We lost the poll mutex (someone else claimed it) and we're
            // still locked out of the statement — don't just drop the tick,
            // fall back to a plain refetch so a losing streak can't strand
            // us behind the winner (issue #62).
            void refetch();
          }
        }
        // A response (even `{ skipped: true }`) means the connection to our
        // own API is healthy — clear any "having trouble" banner.
        pollFailuresRef.current = 0;
        if (!cancelled) setPollDegraded(false);
      } catch {
        // Snapshot refetch on the next event/tick covers a single blip; only
        // surface UI after several consecutive failures.
        pollFailuresRef.current += 1;
        if (!cancelled && pollFailuresRef.current >= POLL_FAILURE_THRESHOLD) {
          setPollDegraded(true);
        }
      } finally {
        if (!cancelled) schedule();
      }
    };

    const schedule = () => {
      const jitter = Math.floor(Math.random() * 1500);
      timer = setTimeout(tick, CLIENT_POLL_INTERVAL_MS + jitter);
    };

    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      pollFailuresRef.current = 0;
      setPollDegraded(false);
    };
  }, [status, raceId, applySnapshot, refetch]);

  // --- Unlock timer --------------------------------------------------------
  // Bridges the gap between countdown end and the next verdict-poll mutex
  // win: fires a plain (non-mutex) refetch right at the skew-corrected unlock
  // instant, then retries per UNLOCK_REFETCH_BACKOFF_MS until the statement
  // shows up (or the race leaves `active`). Reads live state via refs rather
  // than depending on `snapshot.statement`/skew directly so a losing-streak
  // backoff isn't reset by unrelated snapshot updates (issue #62).
  //
  // `rescheduleUnlockRef` (issue #75) lets the effect below rearm the pending
  // *initial* wait when `skewMs` is corrected (e.g. by the mount refetch
  // healing SSR-hydration-latency-inflated skew) without this effect
  // depending on `skewMs` directly — that would re-run on every snapshot
  // receipt and reset the backoff progression the #62 comment above protects.
  const rescheduleUnlockRef = useRef<((skew: number) => void) | null>(null);

  useEffect(() => {
    if (status !== "active") return;
    const startedAtIso = snapshot.startedAt;
    if (!startedAtIso) return;
    if (snapshot.statement) return; // already unlocked — nothing to schedule

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let initialFired = false;

    const stillLocked = () =>
      snapshotRef.current.status === "active" && snapshotRef.current.statement == null;

    const attempt = (attemptNumber: number, delayMs: number) => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        if (attemptNumber === 0) initialFired = true;
        await refetch();
        if (cancelled || !stillLocked()) return;
        attempt(attemptNumber + 1, nextRetryDelay(attemptNumber));
      }, delayMs);
    };

    rescheduleUnlockRef.current = (skew: number) => {
      const delay = unlockRescheduleDelay(startedAtIso, skew, initialFired);
      if (delay === null || cancelled) return;
      clearTimeout(timer);
      attempt(0, delay);
    };

    rescheduleUnlockRef.current(skewMsRef.current);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      rescheduleUnlockRef.current = null;
    };
  }, [status, snapshot.startedAt, snapshot.statement, refetch]);

  // Rearm the pending initial unlock wait whenever skew is corrected (e.g.
  // the mount refetch healing SSR-hydration latency baked into the initial
  // skew reading) — a no-op once the initial attempt has already fired or no
  // wait is currently pending (see `unlockRescheduleDelay`).
  useEffect(() => {
    rescheduleUnlockRef.current?.(skewMs);
  }, [skewMs]);

  // --- Manual submission: check now ---------------------------------------
  // Users submit on codeforces.com themselves (their real browser passes
  // Cloudflare); an immediate poll picks the verdict up without waiting for the
  // next jittered poll tick. The poll route detects any submission to the race
  // problem after startedAt and upserts it into the feed.
  const handleCheckNow = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/races/${raceId}/poll`, { method: "POST" });
      const data: unknown = await res.json().catch(() => null);
      const classified = classifyPollResponse(data);
      if (res.ok && classified.kind === "snapshot") {
        applySnapshot(classified.snapshot);
        toast.success("Checked Codeforces for your latest verdict.");
      } else {
        // Poll may have been skipped (mutex/cooldown) — fall back to a snapshot.
        await refetch();
        toast.info("Checked — no new verdict yet.");
      }
    } catch {
      toast.error("Couldn't reach the server. Try again.");
    } finally {
      setChecking(false);
    }
  }, [checking, raceId, refetch, applySnapshot]);

  // --- Forfeit (existing abort route; caller forfeits, opponent wins) ----
  const handleForfeit = useCallback(async () => {
    if (forfeiting) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Throw in the towel? Your opponent takes the win.",
      )
    ) {
      return;
    }
    setForfeiting(true);
    try {
      const res = await fetch(`/api/races/${raceId}/abort`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as RaceSnapshot | null;
      if (res.ok && data && typeof data.status === "string") {
        applySnapshot(data);
        toast.info("You threw in the towel.");
      } else {
        toast.error("Couldn't forfeit — try again.");
      }
    } catch {
      toast.error("Couldn't reach the server. Try again.");
    } finally {
      setForfeiting(false);
    }
  }, [forfeiting, raceId, applySnapshot]);

  // --- Draw offers (offer / accept / decline / withdraw) -----------------
  const handleDrawAction = useCallback(
    async (action: "offer" | "accept" | "decline") => {
      if (drawActionPending) return;
      setDrawActionPending(true);
      try {
        const res = await fetch(`/api/races/${raceId}/draw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = (await res.json().catch(() => null)) as RaceSnapshot | null;
        if (res.ok && data && typeof data.status === "string") {
          applySnapshot(data);
          if (action === "offer") {
            toast.info("Draw offer sent.");
          } else if (action === "accept") {
            toast.success("Draw agreed.");
          } else {
            toast.info("Draw offer cleared.");
          }
        } else {
          // The offer state moved under us (e.g. the opponent withdrew before
          // our accept landed → 409). Refetch so the UI reflects the truth
          // instead of leaving a stale banner/button.
          toast.error("Couldn't update the draw offer — it may have changed.");
          void refetch();
        }
      } catch {
        toast.error("Couldn't reach the server. Try again.");
      } finally {
        setDrawActionPending(false);
      }
    },
    [drawActionPending, raceId, refetch, applySnapshot],
  );

  // --- Taunts (issue #84) — purely presentational, never refetch-driven ---
  // `handleTauntReceived` applies an opponent's (or, harmlessly, an echoed
  // self-) taunt arriving over the LiveKit data channel; `handleTauntSent`
  // applies this client's own bubble optimistically the instant it sends,
  // since LiveKit never echoes a publisher's own data message back to it.
  // `handleTauntExpire` clears a bubble once its display window elapses,
  // guarded by `sentAt` so a stale timer can't clobber a newer replacement.
  const handleTauntReceived = useCallback((byUserId: string, tauntId: string) => {
    setTaunts((prev) => addTaunt(prev, byUserId, tauntId, Date.now()));
  }, []);

  const handleTauntSent = useCallback(
    (tauntId: string) => {
      setTaunts((prev) => addTaunt(prev, currentUserId, tauntId, Date.now()));
    },
    [currentUserId],
  );

  const handleTauntExpire = useCallback((byUserId: string, sentAt: number) => {
    setTaunts((prev) => expireTaunt(prev, byUserId, sentAt));
  }, []);

  // --- Opponent disconnect grace: only counts a *sustained* absence, so a
  // brief reconnect blip never flashes the banner. -------------------------
  const handlePresenceChange = useCallback((present: boolean) => {
    setOpponentLive(present);
    if (present) {
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      setOpponentDisconnected(false);
      return;
    }
    if (disconnectTimerRef.current) return;
    disconnectTimerRef.current = setTimeout(() => {
      disconnectTimerRef.current = null;
      setOpponentDisconnected(true);
    }, DISCONNECT_GRACE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
    };
  }, []);

  const isP1 = currentUserId === snapshot.p1.id;
  const you = isP1 ? snapshot.p1 : snapshot.p2 ?? snapshot.p1;
  const opponent = isP1 ? snapshot.p2 : snapshot.p1;

  // --- Draw offer state (active race only) --------------------------------
  const drawOfferBy = snapshot.drawOfferBy;
  const iOfferedDraw = drawOfferBy !== null && drawOfferBy === currentUserId;
  const opponentOfferedDraw =
    drawOfferBy !== null && opponent !== null && drawOfferBy === opponent.id;

  // --- Lobby (pending / ready) -------------------------------------------
  if (status === "pending" || status === "ready") {
    return (
      <main className="shell-narrow flex flex-1 flex-col py-12 md:py-16">
        <span data-testid="race-status" className="sr-only">
          {status}
        </span>
        <Lobby
          raceId={raceId}
          currentUserId={currentUserId}
          initialSnapshot={snapshot}
          onRaceActive={applySnapshot}
        />
      </main>
    );
  }

  // --- Result (finished / aborted) ---------------------------------------
  if (status === "finished" || status === "aborted") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <span data-testid="race-status" className="sr-only">
          {status}
        </span>
        <ResultCard snapshot={snapshot} currentUserId={currentUserId} />
      </main>
    );
  }

  // --- Active race --------------------------------------------------------
  const statement = snapshot.statement;
  const problem = snapshot.problem;

  // Once the skew-corrected clock reaches startedAt the countdown is over and
  // the statement is merely still in flight — showing the pre-start "unlocks
  // when the countdown ends" copy then is misleading, so swap to a loading
  // state (issue #99). Render-only: the existing unlock-timer refetch / poll
  // loop re-renders drive this flip; the unlock-timer effect is untouched.
  const startedAtMs = snapshot.startedAt ? Date.parse(snapshot.startedAt) : null;
  const countdownEnded = startedAtMs != null && correctedNow(skewMs) >= startedAtMs;

  const selfTaunt = taunts[currentUserId] ?? null;
  const opponentTaunt = opponent ? taunts[opponent.id] ?? null : null;

  // Big, impossible-to-miss action bar — the two things a racer actually does
  // (submit on codeforces.com, then have us check the verdict) are the loud
  // primary pair; draw / forfeit are prominent secondary. Handlers unchanged.
  const actions = (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2 sm:flex-row">
        {problem && (
          <Button
            type="button"
            size="lg"
            data-testid="submit-btn"
            className="h-11 flex-1 text-sm"
            nativeButton={false}
            render={
              <a
                href={cfSubmitUrl(problem.contestId)}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <ExternalLink aria-hidden />
            Submit on Codeforces
          </Button>
        )}
        <Button
          type="button"
          size="lg"
          data-testid="check-now-btn"
          className="h-11 flex-1 text-sm"
          onClick={handleCheckNow}
          disabled={checking}
        >
          {checking ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Check aria-hidden />
          )}
          {checking ? "Checking…" : "I submitted — check now"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!iOfferedDraw && !opponentOfferedDraw && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            data-testid="draw-offer-btn"
            onClick={() => void handleDrawAction("offer")}
            disabled={drawActionPending}
          >
            <Handshake aria-hidden />
            Offer draw
          </Button>
        )}
        {iOfferedDraw && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Draw offered — waiting for opponent</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="draw-withdraw-btn"
              onClick={() => void handleDrawAction("decline")}
              disabled={drawActionPending}
            >
              Withdraw
            </Button>
          </div>
        )}
        <Button
          type="button"
          variant="destructive"
          size="lg"
          className="ml-auto"
          onClick={handleForfeit}
          disabled={forfeiting}
          data-testid="forfeit-btn"
        >
          {forfeiting ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Flag aria-hidden />
          )}
          {forfeiting ? "Throwing in the towel…" : "Throw in the towel"}
        </Button>
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        Submit your solution on Codeforces — your browser passes their
        Cloudflare check — then hit{" "}
        <span className="font-medium">&ldquo;I submitted — check now&rdquo;</span>{" "}
        and we detect the verdict automatically.
      </p>
    </div>
  );

  // Center stage — the opponent's face under the spotlight is the dominant
  // element (issue #99): the video spotlight + attached "Spit a bar" picker,
  // with the big action bar directly beneath. VideoTiles / TauntPicker read
  // LiveKit room context, so they only mount when video is connected.
  const centerStage = (withVideo: boolean) => (
    <section className="relative flex min-h-0 flex-col gap-3 overflow-y-auto">
      <div
        aria-hidden
        className="spotlight pointer-events-none absolute inset-0 -z-10"
      />
      {withVideo ? (
        <>
          <VideoTiles
            selfTaunt={selfTaunt}
            opponentTaunt={opponentTaunt}
            onSelfTauntExpire={
              selfTaunt
                ? () => handleTauntExpire(currentUserId, selfTaunt.sentAt)
                : undefined
            }
            onOpponentTauntExpire={
              opponentTaunt && opponent
                ? () => handleTauntExpire(opponent.id, opponentTaunt.sentAt)
                : undefined
            }
          />
          <TauntPicker currentUserId={currentUserId} onSent={handleTauntSent} />
        </>
      ) : (
        <div className="panel flex aspect-video items-center justify-center p-4 text-xs text-muted-foreground">
          Video is unavailable.
        </div>
      )}
      {actions}
    </section>
  );

  const problemPane = (
    <section className="panel flex min-h-0 flex-col gap-3 overflow-hidden p-4">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Problem
        </span>
        <h1
          data-testid="problem-title"
          className="font-display text-lg tracking-tight uppercase"
        >
          {problem ? (
            <a
              href={problem.url}
              target="_blank"
              rel="noreferrer"
              className="hover:text-primary hover:underline"
            >
              {problem.id} · {problem.name}
            </a>
          ) : (
            "Problem locked"
          )}
        </h1>
        {problem && (
          <span className="font-mono text-xs text-muted-foreground">
            Rating {problem.rating}
          </span>
        )}
      </header>
      {statement ? (
        <ProblemPane statement={statement} className="flex-1" />
      ) : countdownEnded ? (
        <div
          data-testid="problem-loading"
          role="status"
          className="flex flex-1 items-center justify-center gap-2 text-center text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Pulling up the problem…
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
          The problem unlocks when the countdown ends.
        </div>
      )}
    </section>
  );

  const sideRail = (withVideo: boolean) => (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      {micRevokedMidRace && (
        <div
          data-testid="mic-revoked-banner"
          role="alert"
          className="flex items-center gap-2 rounded-[var(--radius)] border border-verdict-fail/40 bg-verdict-fail/10 p-3 text-xs text-verdict-fail"
        >
          <MicOff className="size-4 shrink-0" aria-hidden />
          Your mic permission was revoked. Trash talk paused — you&apos;re
          still in the race, re-grant it from your browser&apos;s site
          settings whenever you want back in.
        </div>
      )}
      {opponentOfferedDraw && (
        <div
          data-testid="draw-offer-banner"
          role="alert"
          className="flex flex-col gap-2 rounded-[var(--radius)] border border-verdict-pending/40 bg-verdict-pending/10 p-3 text-xs text-verdict-pending"
        >
          <div className="flex items-center gap-2 font-medium">
            <Handshake className="size-4 shrink-0" aria-hidden />
            Your opponent offers a draw.
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="draw-accept-btn"
              onClick={() => void handleDrawAction("accept")}
              disabled={drawActionPending}
            >
              Accept
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="draw-decline-btn"
              onClick={() => void handleDrawAction("decline")}
              disabled={drawActionPending}
            >
              Decline
            </Button>
          </div>
        </div>
      )}
      {opponentDisconnected && (
        <div
          data-testid="opponent-disconnected-banner"
          role="alert"
          className="flex flex-col gap-2 rounded-[var(--radius)] border border-verdict-pending/40 bg-verdict-pending/10 p-3 text-xs text-verdict-pending"
        >
          <div className="flex items-center gap-2 font-medium">
            <WifiOff className="size-4 shrink-0" aria-hidden />
            Your opponent appears to have disconnected.
          </div>
          <p className="text-verdict-pending/90">
            They may reconnect at any time. If they don&apos;t come back,
            you can forfeit to end the race — your opponent would be awarded
            the win.
          </p>
        </div>
      )}
      {pollDegraded && (
        <div
          data-testid="poll-degraded-banner"
          role="alert"
          className="flex items-center justify-between gap-2 rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <span>Having trouble syncing verdicts.</span>
          <Button type="button" variant="outline" size="xs" onClick={() => void refetch()}>
            <RefreshCw aria-hidden />
            Retry
          </Button>
        </div>
      )}
      <RaceHUD
        snapshot={snapshot}
        you={you}
        opponent={opponent}
        opponentPresent={withVideo ? opponentLive : undefined}
        skewMs={skewMs}
      />
      <VerdictFeed
        submissions={snapshot.submissions}
        currentUserId={currentUserId}
        className="flex-1"
      />
    </aside>
  );

  // Opponent spotlight dominates the middle; the problem pane sits to its left
  // (narrower), the HUD + verdict feed rail to its right.
  const panes = (withVideo: boolean) => (
    <div
      data-testid="race-room"
      className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_minmax(0,320px)]"
    >
      {problemPane}
      {centerStage(withVideo)}
      {sideRail(withVideo)}
    </div>
  );

  return (
    <main className="flex flex-1 flex-col px-4 py-4">
      <span data-testid="race-status" className="sr-only">
        {status}
      </span>
      <div
        role="status"
        className="mb-3 flex items-center gap-2 rounded-[var(--radius)] border border-verdict-pending/40 bg-verdict-pending/10 p-2.5 text-xs text-verdict-pending lg:hidden"
      >
        <MonitorSmartphone className="size-4 shrink-0" aria-hidden />
        The race room is designed for larger screens — some panes may be
        cramped here. Rotate or switch to a laptop/desktop for the best
        experience.
      </div>
      {lk ? (
        <LiveKitRoom
          serverUrl={lk.url}
          token={lk.token}
          connect
          audio
          video
          className="flex min-h-0 flex-1 flex-col"
        >
          <RaceEvents
            onEvent={refetch}
            onReconnected={refetch}
            onTaunt={handleTauntReceived}
          />
          {opponent && (
            <PresenceWatcher
              opponentId={opponent.id}
              onPresenceChange={handlePresenceChange}
            />
          )}
          {panes(true)}
        </LiveKitRoom>
      ) : (
        panes(false)
      )}
    </main>
  );
}

/**
 * In-room listener: forwards LiveKit data-channel `RaceEvent`s (hints) and
 * (re)connections to the parent as snapshot-refetch triggers. Renders nothing.
 *
 * `taunt` events are the one exception (issue #84): they are purely
 * presentational and MUST NOT trigger a snapshot refetch (spamming taunts
 * would otherwise hammer `GET /api/races/[id]`), so they're filtered into
 * `onTaunt` before the `onEvent` refetch path ever sees them. The sender
 * identity is taken from LiveKit's own `msg.from` (assigned at token mint,
 * unforgeable by the client) rather than trusted from the payload's
 * `byUserId` field — clients can publish arbitrary data on this channel
 * (see `mintToken` in `src/lib/livekit.ts`), so a forged `byUserId` must not
 * be able to impersonate another player's bubble. A mismatch is dropped
 * silently, same as any other malformed/unknown taunt payload.
 *
 * The NON-taunt branch is throttled (PR #85 security review): because
 * clients hold data-publish rights, a malicious opponent could publish
 * forged non-taunt events (e.g. `{type:"verdict"}`) at arbitrary rate,
 * turning each into a `GET /api/races/[id]` from the victim's browser — a
 * 1:1 amplification DoS against our own API. Events collapse to at most one
 * refetch per `REFETCH_MIN_MS`, leading + trailing edge (the pure timing
 * math lives in `@/lib/race/refetch-throttle`): the first event of a burst
 * refetches immediately, and one trailing refetch covers the tail so a
 * legitimate final event (e.g. `race_finished`) is never dropped.
 * `onReconnected` is deliberately NOT throttled — connection state is
 * LiveKit-server-driven, not attacker-controllable.
 */
function RaceEvents({
  onEvent,
  onReconnected,
  onTaunt,
}: {
  onEvent: () => void;
  onReconnected: () => void;
  onTaunt: (byUserId: string, tauntId: string) => void;
}) {
  const lastRefetch = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror the latest onEvent so a trailing timer scheduled before a parent
  // re-render still calls the current callback when it fires.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useDataChannel(LIVEKIT_DATA_TOPIC, (msg) => {
    const event = decodeRaceEvent(msg.payload);
    if (!event) return;
    if (event.type === "taunt") {
      const senderId = msg.from?.identity;
      if (senderId && senderId === event.byUserId) {
        onTaunt(event.byUserId, event.tauntId);
      }
      return;
    }
    // We only need to know a (non-taunt) event arrived — the snapshot is
    // authoritative. Throttled: leading edge fires now, a burst's tail is
    // covered by a single trailing refetch, everything in between drops.
    const decision = refetchThrottleDecision(lastRefetch.current, Date.now());
    if (decision.action === "now") {
      lastRefetch.current = Date.now();
      onEventRef.current();
    } else if (!trailing.current) {
      trailing.current = setTimeout(() => {
        trailing.current = null;
        lastRefetch.current = Date.now();
        onEventRef.current();
      }, decision.delayMs);
    }
  });

  // Clear a pending trailing refetch on unmount (room teardown).
  useEffect(() => {
    return () => {
      if (trailing.current) clearTimeout(trailing.current);
    };
  }, []);

  const connState = useConnectionState();
  const prevState = useRef(connState);
  useEffect(() => {
    if (
      connState === ConnectionState.Connected &&
      prevState.current !== ConnectionState.Connected
    ) {
      onReconnected();
    }
    prevState.current = connState;
  }, [connState, onReconnected]);

  return null;
}

/**
 * In-room listener: reports whether the opponent (matched by LiveKit identity
 * === `users.id`, see `/api/livekit/token`) currently has a live connection.
 * The parent debounces this into a grace-period disconnect banner. Renders
 * nothing.
 */
function PresenceWatcher({
  opponentId,
  onPresenceChange,
}: {
  opponentId: string;
  onPresenceChange: (present: boolean) => void;
}) {
  const remoteParticipants = useRemoteParticipants();
  const present = remoteParticipants.some((p) => p.identity === opponentId);

  useEffect(() => {
    onPresenceChange(present);
  }, [present, onPresenceChange]);

  return null;
}
