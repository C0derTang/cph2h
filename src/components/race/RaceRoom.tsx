"use client";

/**
 * Race room orchestrator (issue #17) — the integration capstone.
 *
 * Owns the client-side race state and wires the already-built pieces together:
 *   - pending/ready  → the standalone {@link Lobby} (#16)
 *   - active         → 3-pane race: {@link ProblemPane} (#9) | {@link CppEditor}
 *                      (#12) + {@link RunPanel} (#13) | {@link VideoTiles} +
 *                      {@link RaceHUD} + {@link VerdictFeed}
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
  Copy,
  ExternalLink,
  Flag,
  Handshake,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  RotateCcw,
  Send,
  WifiOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CppEditor, type CppEditorHandle } from "@/components/editor/CppEditor";
import { ProblemPane } from "@/components/race/ProblemPane";
import { RunPanel } from "@/components/race/RunPanel";
import { Lobby } from "@/components/race/Lobby";
import { RaceHUD } from "@/components/race/RaceHUD";
import { VerdictFeed } from "@/components/race/VerdictFeed";
import { ResultCard } from "@/components/race/ResultCard";
import { VideoTiles } from "@/components/race/VideoTiles";
import {
  CLIENT_POLL_INTERVAL_MS,
  LIVEKIT_DATA_TOPIC,
  decodeRaceEvent,
  type RaceSnapshot,
  type SubmitResponse,
} from "@/lib/types";

interface RaceRoomProps {
  raceId: string;
  currentUserId: string;
  initialSnapshot: RaceSnapshot;
  /** The viewer's saved C++ template — preloaded into the editor at race start. */
  cppTemplate: string;
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

const SUBMIT_ERROR_CODES = new Set<string>([
  "cf_error",
  "not_active",
  "rate_limited",
  "not_participant",
]);

/**
 * Coerce whatever `/api/races/[id]/submit` returned into a well-formed
 * {@link SubmitResponse}, so the UI never renders an empty error box when a
 * guard failure (e.g. `{ error: "not_found" }`, no `message`) short-circuits
 * before the route can build a full `SubmitResponse` body.
 */
function normalizeSubmitResponse(raw: unknown): SubmitResponse {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (obj && obj.ok === true && typeof obj.cfSubmissionId === "number") {
    return { ok: true, cfSubmissionId: obj.cfSubmissionId };
  }
  type SubmitErrorCode = Extract<SubmitResponse, { ok: false }>["error"];
  const rawError = obj && typeof obj.error === "string" ? obj.error : undefined;
  const error: SubmitErrorCode =
    rawError && SUBMIT_ERROR_CODES.has(rawError)
      ? (rawError as SubmitErrorCode)
      : "cf_error";
  const message =
    obj && typeof obj.message === "string" && obj.message.trim() !== ""
      ? obj.message
      : "Submission failed — try the manual fallback.";
  return { ok: false, error, message };
}

export function RaceRoom({
  raceId,
  currentUserId,
  initialSnapshot,
  cppTemplate,
}: RaceRoomProps) {
  const [snapshot, setSnapshot] = useState<RaceSnapshot>(initialSnapshot);
  const [code, setCode] = useState<string>(cppTemplate);
  const [lk, setLk] = useState<LivekitConn | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResponse | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [opponentLive, setOpponentLive] = useState(true);
  const [forfeiting, setForfeiting] = useState(false);
  const [drawActionPending, setDrawActionPending] = useState(false);
  const [pollDegraded, setPollDegraded] = useState(false);
  const editorRef = useRef<CppEditorHandle>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFailuresRef = useRef(0);

  const status = snapshot.status;

  // --- Snapshot refetch (source of truth) --------------------------------
  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/races/${raceId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as RaceSnapshot;
      if (data && typeof data.status === "string") setSnapshot(data);
    } catch {
      // Transient — the poll loop / next event will retry.
    }
  }, [raceId]);

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
        if (
          !cancelled &&
          data &&
          typeof data === "object" &&
          typeof (data as RaceSnapshot).status === "string"
        ) {
          setSnapshot(data as RaceSnapshot);
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
  }, [status, raceId]);

  // --- Submit -------------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    if (submitting || code.trim() === "") return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const res = await fetch(`/api/races/${raceId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const raw: unknown = await res.json().catch(() => null);
      const result = normalizeSubmitResponse(raw);
      setSubmitResult(result);
      if (result.ok) {
        toast.success(`Submitted to Codeforces (#${result.cfSubmissionId}).`);
      } else {
        toast.error(result.message);
      }
      // Reflect the new (pending) submission in the feed promptly.
      void refetch();
    } catch {
      const message = "Could not reach the server. Submit manually on Codeforces.";
      setSubmitResult({ ok: false, error: "cf_error", message });
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, code, raceId, refetch]);

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      toast.success("Code copied to clipboard.");
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — your browser may be blocking clipboard access.");
    }
  }, [code]);

  // --- Forfeit (existing abort route; caller forfeits, opponent wins) ----
  const handleForfeit = useCallback(async () => {
    if (forfeiting) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Forfeit this race? Your opponent will be awarded the win.",
      )
    ) {
      return;
    }
    setForfeiting(true);
    try {
      const res = await fetch(`/api/races/${raceId}/abort`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as RaceSnapshot | null;
      if (res.ok && data && typeof data.status === "string") {
        setSnapshot(data);
        toast.info("You forfeited the race.");
      } else {
        toast.error("Couldn't forfeit — try again.");
      }
    } catch {
      toast.error("Couldn't reach the server. Try again.");
    } finally {
      setForfeiting(false);
    }
  }, [forfeiting, raceId]);

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
          setSnapshot(data);
          if (action === "offer") {
            toast.info("Draw offer sent.");
          } else if (action === "accept") {
            toast.success("Draw agreed.");
          } else {
            toast.info("Draw offer cleared.");
          }
        } else {
          toast.error("Couldn't update the draw offer — try again.");
        }
      } catch {
        toast.error("Couldn't reach the server. Try again.");
      } finally {
        setDrawActionPending(false);
      }
    },
    [drawActionPending, raceId],
  );

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
          onRaceActive={(snap) => setSnapshot(snap)}
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

  const editorPane = (
    <section className="flex min-h-0 flex-col gap-3">
      <div className="min-h-[320px] flex-1 overflow-hidden rounded-xl border border-border">
        <CppEditor
          ref={editorRef}
          value={code}
          onChange={setCode}
          draftKey={`race:${raceId}`}
          className="size-full"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          data-testid="submit-btn"
          onClick={handleSubmit}
          disabled={submitting || code.trim() === "" || !problem}
        >
          {submitting ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Send aria-hidden />
          )}
          {submitting ? "Submitting…" : "Submit to Codeforces"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => editorRef.current?.reset(cppTemplate)}
        >
          <RotateCcw aria-hidden />
          Reset
        </Button>
        {!iOfferedDraw && !opponentOfferedDraw && (
          <Button
            type="button"
            variant="outline"
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
          variant="ghost"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={handleForfeit}
          disabled={forfeiting}
          data-testid="forfeit-btn"
        >
          {forfeiting ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Flag aria-hidden />
          )}
          {forfeiting ? "Forfeiting…" : "Forfeit"}
        </Button>
        {submitResult?.ok && (
          <span
            data-testid="submit-success"
            className="text-sm text-emerald-500"
          >
            Submitted (#{submitResult.cfSubmissionId}).
          </span>
        )}
      </div>

      {submitResult && !submitResult.ok && (
        <div
          data-testid="submit-error"
          className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <p>{submitResult.message}</p>
          {submitResult.error === "cf_error" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-destructive/90">
                Automatic submit failed — submit manually:
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyCode}
                data-testid="copy-code-btn"
              >
                <Copy aria-hidden />
                {codeCopied ? "Copied" : "Copy code"}
              </Button>
              {problem && (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={
                    <a href={problem.url} target="_blank" rel="noreferrer" />
                  }
                  data-testid="open-cf-btn"
                >
                  <ExternalLink aria-hidden />
                  Open on Codeforces
                </Button>
              )}
              {submitResult.message.toLowerCase().includes("not signed in") && (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<a href="/settings/cf" />}
                >
                  Re-link Codeforces account
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {statement && (
        <RunPanel raceId={raceId} code={code} samples={statement.samples} />
      )}
    </section>
  );

  const rightRail = (withVideo: boolean) => (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      {opponentOfferedDraw && (
        <div
          data-testid="draw-offer-banner"
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-600 dark:text-sky-400"
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
          className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400"
        >
          <div className="flex items-center gap-2 font-medium">
            <WifiOff className="size-4 shrink-0" aria-hidden />
            Your opponent appears to have disconnected.
          </div>
          <p className="text-amber-600/90 dark:text-amber-400/90">
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
          className="flex items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
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
      />
      {withVideo ? (
        <VideoTiles />
      ) : (
        <div className="rounded-xl border border-border bg-card/40 p-4 text-xs text-muted-foreground">
          Video is unavailable.
        </div>
      )}
      <VerdictFeed
        submissions={snapshot.submissions}
        currentUserId={currentUserId}
        className="flex-1"
      />
    </aside>
  );

  const problemPane = (
    <section className="flex min-h-0 flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card/30 p-4">
      <header className="flex flex-col gap-1">
        <span className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Problem
        </span>
        <h1
          data-testid="problem-title"
          className="font-heading text-lg font-semibold tracking-tight"
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
          <span className="text-xs text-muted-foreground">
            Rating {problem.rating}
          </span>
        )}
      </header>
      {statement ? (
        <ProblemPane statement={statement} className="flex-1" />
      ) : (
        <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
          The problem unlocks when the countdown ends.
        </div>
      )}
    </section>
  );

  const panes = (withVideo: boolean) => (
    <div
      data-testid="race-room"
      className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,340px)]"
    >
      {problemPane}
      {editorPane}
      {rightRail(withVideo)}
    </div>
  );

  return (
    <main className="flex flex-1 flex-col px-4 py-4">
      <span data-testid="race-status" className="sr-only">
        {status}
      </span>
      <div
        role="status"
        className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-600 lg:hidden dark:text-amber-400"
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
          <RaceEvents onEvent={refetch} onReconnected={refetch} />
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
 */
function RaceEvents({
  onEvent,
  onReconnected,
}: {
  onEvent: () => void;
  onReconnected: () => void;
}) {
  useDataChannel(LIVEKIT_DATA_TOPIC, (msg) => {
    // We only need to know an event arrived — the snapshot is authoritative.
    if (decodeRaceEvent(msg.payload)) onEvent();
  });

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
