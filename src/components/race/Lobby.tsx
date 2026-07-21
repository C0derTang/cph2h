"use client";

/**
 * Pre-race lobby (issue #16): pending/ready states, ready toggle, and the
 * countdown once both players are ready.
 *
 * Self-contained by design so the race-room assembly (#17) can drop it in
 * without depending on that work: given a `raceId` and the viewer's
 * `currentUserId`, it fetches/polls its own snapshot (GET `/api/races/[id]`,
 * issue #7) and posts ready toggles (`/api/races/[id]/ready`, issue #7) —
 * it never reimplements race transitions, only calls them. Polling (rather
 * than a LiveKit push) matches the current stub: `publishRaceEvent` is a
 * no-op until #8/#17 land (see `src/lib/race/hooks.ts`).
 *
 * Once the race transitions to `active`, this component still renders a
 * countdown-then-started message but hands control back to the parent via
 * `onRaceActive` — the full race room (editor/problem pane/LiveKit) is out of
 * scope here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Loader2,
  Mic,
  SlidersHorizontal,
  Swords,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SlabButton } from "@/components/menu/slab-button";
import { HeroWord } from "@/components/hud/hero-word";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildJoinUrl } from "@/lib/race/join-url";
import { computeSkewMs, correctedNow } from "@/lib/race/countdown";
import { jitteredDelayMs } from "@/lib/poll-timing";
import { canCompete } from "@/lib/race/av-requirements";
import { useCamPermission, useMicPermission } from "@/components/race/useMicPermission";
import { AudioToggleButtons } from "@/components/race/AudioControls";
import { LiveTickerIndicator } from "@/components/race/LiveTickerIndicator";
import {
  EMPTY_FILTERS,
  filterSummary,
  FilterEditor,
  type FilterPayload,
} from "@/components/race/FilterEditor";
import { CLIENT_POLL_INTERVAL_MS } from "@/lib/types";
import type {
  ProblemSelectionFailureReason,
  RaceProblemFilters,
  PublicUser,
  RaceSnapshot,
} from "@/lib/types";

export interface LobbyProps {
  raceId: string;
  /** The `users.id` of the person viewing the lobby (must be p1 or p2). */
  currentUserId: string;
  /** Server-fetched snapshot to render immediately, skipping the first fetch. */
  initialSnapshot?: RaceSnapshot;
  /** Called once (per mount) when the race leaves the lobby for `active`. */
  onRaceActive?: (snapshot: RaceSnapshot) => void;
  className?: string;
}

const TERMINAL_STATUSES = new Set(["active", "finished", "aborted"]);

export function Lobby({
  raceId,
  currentUserId,
  initialSnapshot,
  onRaceActive,
  className,
}: LobbyProps) {
  const [snapshot, setSnapshot] = useState<RaceSnapshot | null>(
    initialSnapshot ?? null,
  );
  const [loading, setLoading] = useState(!initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [readying, setReadying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingFilters, setEditingFilters] = useState(false);
  const [savingFilters, setSavingFilters] = useState(false);
  // Tracks a real local timestamp (not a dummy counter) so the render body
  // can derive a skew-corrected "now" without calling `Date.now()` directly
  // during render. Updated by the countdown tick effect below.
  const [tickNow, setTickNow] = useState(() => Date.now());
  const notifiedActiveRef = useRef(false);
  const fetchedOnceRef = useRef(Boolean(initialSnapshot));
  // Guards the ready-deadline countdown's one-shot post-deadline refresh (see
  // the effect below) so it fires exactly once per deadline, not once per
  // render while the clamped countdown sits at zero.
  const deadlineRefreshedRef = useRef(false);
  // Clock skew (ms) between the local machine and the server, recomputed on
  // every snapshot receipt (see `src/lib/race/countdown.ts`) — the countdown
  // display must never trust a skewed local clock. Kept as state (read
  // during render) with a ref mirror for the tick effect below.
  const [skewMs, setSkewMs] = useState(() =>
    computeSkewMs(initialSnapshot?.now ?? new Date().toISOString(), Date.now()),
  );
  const skewMsRef = useRef(skewMs);
  useEffect(() => {
    skewMsRef.current = skewMs;
  }, [skewMs]);

  // Compete gate (issue #100, extended to camera by #171): a client-side-only
  // requirement, checked here so the "I'm ready" button can't be pressed
  // muted or invisible. `useMicPermission`/`useCamPermission` work without
  // any LiveKit context (the Lobby renders standalone, before `LiveKitRoom`
  // mounts in the active branch — see `RaceRoom.tsx`).
  const mic = useMicPermission();
  const cam = useCamPermission();
  const meetsCompeteGate = canCompete({
    micGranted: mic.micGranted,
    micLive: mic.micLive,
    camGranted: cam.camGranted,
    camLive: cam.camLive,
  });

  // Applies any freshly-received `RaceSnapshot` — whether from the polling
  // `refresh()` fetch or a direct action response (`handleReady`,
  // `handleCancel`, `handleSaveFilters`) — through one path so clock-skew
  // correction happens on every snapshot receipt, not just the poll (mirrors
  // `RaceRoom`'s `applySnapshot`; issue #75 — previously the action handlers
  // set the snapshot directly and never recomputed skew, so a stale skew
  // could linger through ready/cancel). Opponent-joined is surfaced by the VS
  // lockup flipping from "Nobody’s stepped up yet." rather than a redundant toast
  // (issue #141).
  const applySnapshot = useCallback((data: RaceSnapshot) => {
    setSkewMs(computeSkewMs(data.now, Date.now()));
    setSnapshot(data);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/races/${raceId}`, { cache: "no-store" });
      if (res.status === 429) {
        // Issue #254: our own future rate limiter (wave-10) — a soft skip,
        // not an error. Keep the previous snapshot/error state and let the
        // next poll tick retry.
        return;
      }
      if (!res.ok) {
        setError(fetchErrorMessage(res.status));
        return;
      }
      const data = (await res.json()) as RaceSnapshot;
      applySnapshot(data);
      setError(null);
    } catch {
      setError("Couldn't reach the server. Retrying…");
    } finally {
      fetchedOnceRef.current = true;
      setLoading(false);
    }
  }, [raceId, applySnapshot]);

  // Initial fetch (if not seeded by the server) + poll (self-rescheduling,
  // jittered — issue #254) while the race is still in the lobby
  // (pending/ready).
  useEffect(() => {
    if (!fetchedOnceRef.current) {
      refresh();
    }
    if (snapshot?.status && TERMINAL_STATUSES.has(snapshot.status)) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await refresh();
      if (!cancelled) schedule();
    };

    const schedule = () => {
      timer = setTimeout(() => void tick(), jitteredDelayMs(CLIENT_POLL_INTERVAL_MS));
    };

    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh, snapshot?.status]);

  // Local re-render tick while counting down so the "starts in Ns" label
  // stays live between polls. Self-clears the instant the countdown elapses
  // rather than ticking uselessly for the rest of the (possibly long) race.
  useEffect(() => {
    if (snapshot?.status !== "active" || !snapshot.startedAt) return;
    const startedAtMs = new Date(snapshot.startedAt).getTime();
    if (correctedNow(skewMsRef.current, Date.now()) >= startedAtMs) return;
    const tick = setInterval(() => {
      // Tick first so the final render reflects "started", then stop —
      // otherwise this would keep firing uselessly for the rest of the race.
      const localNowMs = Date.now();
      setTickNow(localNowMs);
      if (correctedNow(skewMsRef.current, localNowMs) >= startedAtMs) {
        clearInterval(tick);
      }
    }, 250);
    return () => clearInterval(tick);
  }, [snapshot?.status, snapshot?.startedAt]);

  // Matchmade ready-deadline countdown (issue #276): while the race is
  // `ready` and matchmade (`readyDeadlineAt` non-null), ticks once per second
  // so the M:SS label stays live, self-clearing the instant the deadline
  // passes. It then triggers exactly one `refresh()` so the resolved terminal
  // snapshot (walkover win or no-Elo abort — the server, not this timer,
  // decides the outcome) lands immediately rather than waiting out the normal
  // poll cadence.
  useEffect(() => {
    if (snapshot?.status !== "ready" || !snapshot.readyDeadlineAt) {
      deadlineRefreshedRef.current = false;
      return;
    }
    const deadlineMs = new Date(snapshot.readyDeadlineAt).getTime();
    const maybeRefreshOnce = () => {
      if (!deadlineRefreshedRef.current) {
        deadlineRefreshedRef.current = true;
        void refresh();
      }
    };
    if (correctedNow(skewMsRef.current, Date.now()) >= deadlineMs) {
      maybeRefreshOnce();
      return;
    }
    const tick = setInterval(() => {
      const localNowMs = Date.now();
      setTickNow(localNowMs);
      if (correctedNow(skewMsRef.current, localNowMs) >= deadlineMs) {
        clearInterval(tick);
        maybeRefreshOnce();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [snapshot?.status, snapshot?.readyDeadlineAt, refresh]);

  useEffect(() => {
    if (snapshot?.status === "active" && !notifiedActiveRef.current) {
      notifiedActiveRef.current = true;
      onRaceActive?.(snapshot);
    }
  }, [snapshot, onRaceActive]);

  async function handleReady() {
    setReadying(true);
    setError(null);
    try {
      const res = await fetch(`/api/races/${raceId}/ready`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = readyErrorMessage(data?.error);
        setError(message);
        toast.error(message);
        if (data?.race) applySnapshot(data.race as RaceSnapshot);
        return;
      }
      applySnapshot(data as RaceSnapshot);
    } catch {
      const message = "Couldn’t mark ready — check your connection and try again.";
      setError(message);
      toast.error(message);
    } finally {
      setReadying(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/races/${raceId}/abort`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = abortErrorMessage(data?.error);
        setError(message);
        toast.error(message);
        if (data?.race) applySnapshot(data.race as RaceSnapshot);
        return;
      }
      applySnapshot(data as RaceSnapshot);
    } catch {
      const message = "Couldn’t cancel the race — check your connection and try again.";
      setError(message);
      toast.error(message);
    } finally {
      setCancelling(false);
    }
  }

  async function handleSaveFilters(payload: FilterPayload) {
    setSavingFilters(true);
    setError(null);
    try {
      const res = await fetch(`/api/races/${raceId}/filters`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = filtersErrorMessage(data?.error);
        setError(message);
        toast.error(message);
        if (data?.race) applySnapshot(data.race as RaceSnapshot);
        return;
      }
      applySnapshot(data as RaceSnapshot);
      setEditingFilters(false);
      toast.success("Filters updated — ready up again to start.");
    } catch {
      const message = "Couldn't update filters — check your connection and try again.";
      setError(message);
      toast.error(message);
    } finally {
      setSavingFilters(false);
    }
  }

  async function copyLink() {
    if (!snapshot?.challengeToken) return;
    try {
      await navigator.clipboard.writeText(
        buildJoinUrl(window.location.origin, snapshot.challengeToken),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn’t copy — your browser may be blocking clipboard access.");
    }
  }

  if (loading && !snapshot) {
    return (
      <LobbyShell className={className}>
        <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading race…
        </div>
      </LobbyShell>
    );
  }

  if (!snapshot) {
    return (
      <LobbyShell className={className}>
        <p role="alert" className="p-5 text-sm text-destructive">
          {error ?? "Race not found."}
        </p>
      </LobbyShell>
    );
  }

  const isP1 = currentUserId === snapshot.p1.id;
  const you = isP1 ? snapshot.p1 : snapshot.p2;
  const opponent = isP1 ? snapshot.p2 : snapshot.p1;
  const youReady = isP1 ? snapshot.p1Ready : snapshot.p2Ready;
  const opponentReady = isP1 ? snapshot.p2Ready : snapshot.p1Ready;
  const nowMs = correctedNow(skewMs, tickNow);

  // Non-null `readyDeadlineAt` is the contract's discriminator for "this race
  // came from matchmaking" (challenge races never set it).
  const isMatchmade = snapshot.readyDeadlineAt !== null;

  // Pure display derivation (no new state) for the big broadcast countdown —
  // statusHeading/statusSubheading already compute the equivalent seconds
  // for the sr/status copy; this just surfaces it as the loud scoreboard
  // number the design calls for.
  const startedAtMs = snapshot.startedAt ? new Date(snapshot.startedAt).getTime() : null;
  const counting =
    snapshot.status === "active" && startedAtMs != null && nowMs < startedAtMs;
  const secondsLeft = counting && startedAtMs != null
    ? Math.max(0, Math.ceil((startedAtMs - nowMs) / 1000))
    : null;

  // Matchmade ready-deadline countdown display: only while still in `ready`
  // and not yet both-ready (once both are ready the race is about to
  // transition to `active` on the next poll — no need to keep flashing
  // stakes copy at a pair who already readied up).
  const deadlineMs = snapshot.readyDeadlineAt
    ? new Date(snapshot.readyDeadlineAt).getTime()
    : null;
  const deadlineSecondsLeft =
    snapshot.status === "ready" && isMatchmade && deadlineMs != null && !(youReady && opponentReady)
      ? Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000))
      : null;

  return (
    <LobbyShell className={className}>
      <div className="ticker justify-between px-4 py-2.5">
        <span>lobby &middot; {snapshot.status}</span>
        <LiveTickerIndicator />
      </div>

      <div className="flex flex-col gap-1 p-5 pb-4">
        <h2 className="flex items-center gap-2 font-display text-xl tracking-tight uppercase">
          <Swords className="size-4 text-player-self" aria-hidden />
          {statusHeading(snapshot, nowMs)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {statusSubheading(snapshot, nowMs)}
        </p>
      </div>

      {deadlineSecondsLeft != null && (
        <div className="px-5 pb-4">
          <div
            role="status"
            aria-live="polite"
            data-testid="ready-deadline-banner"
            className="flex items-start gap-2 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <span aria-hidden className="warning-glyph mt-0.5">
              !
            </span>
            <span>{readyDeadlineCopy(youReady, opponentReady, deadlineSecondsLeft)}</span>
          </div>
        </div>
      )}

      {counting && secondsLeft != null && (
        <div className="flex flex-col items-center gap-1 border-t border-border py-5">
          <span className="eyebrow text-muted-foreground">
            Starts in
          </span>
          <span className="font-mono text-6xl font-semibold tabular-nums">
            {secondsLeft}
          </span>
        </div>
      )}

      {/* VS poster lockup: self (acid yellow) vs opponent (crimson) corners
          split by a thin self-yellow rule, framed by corner brackets and
          hud-meta edge markers, per docs/design.md v4. */}
      <div className="bracket-frame relative grid gap-3 border-t border-border p-5 sm:grid-cols-2 sm:gap-0 sm:p-0">
        <span
          aria-hidden
          className="hud-meta absolute top-2 left-3 hidden sm:block"
        >
          {"// self"}
        </span>
        <span
          aria-hidden
          className="hud-meta absolute top-2 right-3 hidden sm:block"
        >
          {"opp //"}
        </span>
        <div
          aria-hidden
          className="absolute inset-y-6 left-1/2 hidden w-px -translate-x-1/2 bg-player-self/40 sm:block"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 z-10 hidden size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-player-self/50 bg-background font-display text-sm tracking-wide text-player-self sm:flex"
        >
          VS
        </div>
        <PlayerRow user={you} ready={youReady} label="Champion" variant="self" />
        <PlayerRow
          user={opponent}
          ready={opponentReady}
          label="Challenger"
          variant="opponent"
        />
      </div>

      <div className="flex flex-col gap-5 p-5">
        {(snapshot.status === "pending" || snapshot.status === "ready") && (
          <FiltersSection
            filters={snapshot.filters}
            failureReason={snapshot.problemSelectionFailedReason}
            isChallenger={isP1}
            isMatchmade={isMatchmade}
            editing={editingFilters}
            saving={savingFilters}
            onEdit={() => setEditingFilters(true)}
            onCancelEdit={() => setEditingFilters(false)}
            onSave={handleSaveFilters}
          />
        )}

        {(snapshot.status === "pending" || snapshot.status === "ready") && (
          <CompeteGate mic={mic} cam={cam} />
        )}

        {snapshot.status === "pending" && snapshot.challengeToken && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <p className="eyebrow text-muted-foreground">
                Share this link
              </p>
              <div className="stat-plate flex items-center gap-2 p-2.5">
                <code className="flex-1 truncate font-mono text-xs">
                  {buildJoinUrl(
                    typeof window !== "undefined" ? window.location.origin : "",
                    snapshot.challengeToken,
                  )}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={copyLink}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          </>
        )}

        {snapshot.status === "ready" && (
          <SlabButton
            type="button"
            tone="self"
            size="lg"
            className="w-full"
            onClick={handleReady}
            disabled={readying || cancelling || youReady || !meetsCompeteGate}
            data-testid="ready-btn"
          >
            {readying ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Marking ready…
              </>
            ) : youReady ? (
              "They’re still catching up."
            ) : !meetsCompeteGate ? (
              "Mic + camera on."
            ) : (
              "I'm ready"
            )}
          </SlabButton>
        )}

        {(snapshot.status === "pending" || snapshot.status === "ready") && (
          <SlabButton
            type="button"
            tone="destructive"
            className="w-full"
            onClick={handleCancel}
            disabled={cancelling || readying}
            data-testid="cancel-challenge-btn"
          >
            {cancelling ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Throwing in the towel…
              </>
            ) : (
              "Throw in the towel"
            )}
          </SlabButton>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </LobbyShell>
  );
}

function LobbyShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      {/* The screen's ONE hero word (docs/design.md placement map: lobby →
          "versus", foreground tone — the RGB glitch fringe carries the color).
          Straddles the plate's top edge at -z so the opaque panel masks its
          lower half; pure set dressing, the lobby reads without it. */}
      <HeroWord
        word="versus"
        tone="foreground"
        className="pointer-events-none absolute top-0 left-1/2 -z-10 -translate-x-1/2 -translate-y-[58%] whitespace-nowrap"
      />
      <span aria-hidden className="hud-meta absolute -bottom-5 right-1">
        {"cph2h // lobby"}
      </span>
      <div className="panel clip-notch overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * Compete-gate checklist (issue #100, extended by #171): "Mic and camera on.
 * No excuses." Shows mic ✓/✗ and camera ✓/✗, each with its own "Grant"
 * action, plus the SFX/BGM toggles. Pure presentation; the actual gating
 * predicate (`canCompete`) lives with the hooks in the parent so it can also
 * disable the ready button.
 */
function CompeteGate({
  mic,
  cam,
}: {
  mic: ReturnType<typeof useMicPermission>;
  cam: ReturnType<typeof useCamPermission>;
}) {
  const micOk = mic.micGranted && mic.micLive;
  const micLabel = !mic.supported
    ? "Mic unsupported in this browser"
    : mic.permissionState === "denied"
      ? "Mic blocked — allow it in your browser's site settings"
      : "Grant mic";

  const camOk = cam.camGranted && cam.camLive;
  const camLabel = !cam.supported
    ? "Camera unsupported in this browser"
    : cam.permissionState === "denied"
      ? "Camera blocked — allow it in your browser's site settings"
      : "Grant camera";

  return (
    <div className="stat-plate flex flex-col gap-3 p-3" data-testid="compete-gate">
      <div className="flex flex-col gap-0.5">
        <p className="eyebrow text-muted-foreground">
          Compete requirements
        </p>
        <p className="text-sm">Mic and camera on. No excuses.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cn(
            "flex items-center gap-1.5 text-sm",
            micOk ? "text-foreground" : "text-destructive",
          )}
          data-testid="mic-requirement"
        >
          {micOk ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
          {micOk ? "Mic on" : "Mic off"}
        </span>
        {!micOk && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void mic.requestMic()}
            disabled={mic.requesting || !mic.supported}
            data-testid="grant-mic-btn"
          >
            {mic.requesting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Mic className="size-4" aria-hidden />
            )}
            {micLabel}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cn(
            "flex items-center gap-1.5 text-sm",
            camOk ? "text-foreground" : "text-destructive",
          )}
          data-testid="cam-requirement"
        >
          {camOk ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
          {camOk ? "Camera on" : "Camera off"}
        </span>
        {!camOk && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void cam.requestCam()}
            disabled={cam.requesting || !cam.supported}
            data-testid="grant-cam-btn"
          >
            {cam.requesting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Video className="size-4" aria-hidden />
            )}
            {camLabel}
          </Button>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <AudioToggleButtons testIdSuffix="lobby" />
      </div>
    </div>
  );
}

function PlayerRow({
  user,
  ready,
  label,
  variant,
}: {
  user: PublicUser | null;
  ready: boolean;
  label: string;
  variant: "self" | "opponent";
}) {
  const isSelf = variant === "self";
  const identityText = isSelf ? "text-player-self" : "text-player-opponent";
  return (
    <div className="flex items-center gap-3 p-3 sm:p-5">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center font-display text-sm font-bold",
          isSelf
            ? "bg-player-self text-player-self-foreground"
            : "bg-player-opponent text-player-opponent-foreground",
        )}
      >
        {user ? (
          user.username.charAt(0).toUpperCase()
        ) : (
          <UserRound className="size-4" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "eyebrow",
            identityText,
          )}
        >
          {label}
        </p>
        {user ? (
          <>
            <p className="truncate font-display text-lg tracking-tight uppercase">
              {user.username}
            </p>
            <p className={cn("font-mono text-[13px] font-semibold tabular-nums", identityText)}>
              {user.elo} elo
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Nobody&rsquo;s stepped up yet.</p>
        )}
      </div>
      {user && (
        <Badge
          variant={ready ? "default" : "outline"}
          className={cn(
            ready &&
              (isSelf
                ? "border-transparent bg-player-self text-player-self-foreground"
                : "border-transparent bg-player-opponent text-player-opponent-foreground"),
            !ready && "text-muted-foreground",
          )}
        >
          {ready ? "Ready" : "Not ready"}
        </Badge>
      )}
    </div>
  );
}

function statusHeading(snapshot: RaceSnapshot, nowMs: number): string {
  switch (snapshot.status) {
    case "pending":
      return "They’re stalling.";
    case "ready":
      return "Get ready";
    case "active": {
      const startedAt = snapshot.startedAt ? new Date(snapshot.startedAt) : null;
      if (startedAt && nowMs < startedAt.getTime()) {
        const secondsLeft = Math.max(
          0,
          Math.ceil((startedAt.getTime() - nowMs) / 1000),
        );
        return `Starting in ${secondsLeft}s`;
      }
      return "Race started.";
    }
    case "finished":
      return "Race finished";
    case "aborted":
      return "Race cancelled";
    default:
      return "Race";
  }
}

function statusSubheading(snapshot: RaceSnapshot, nowMs: number): string {
  switch (snapshot.status) {
    case "pending":
      return "Share the link below — the race begins once your opponent joins.";
    case "ready":
      return "Both players must mark ready to start the countdown.";
    case "active":
      return snapshot.startedAt && nowMs < new Date(snapshot.startedAt).getTime()
        ? "Get ready — the problem unlocks when the countdown ends."
        : "Don’t choke.";
    case "finished":
      return "This race has already ended.";
    case "aborted":
      return "This race was cancelled before it finished.";
    default:
      return "";
  }
}

/** `M:SS` for a non-negative second count (e.g. `1:59`). */
function formatMinSec(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Stakes-unmistakable copy for the matchmade ready-deadline banner (issue
 * #276). A walkover is a full Elo loss for whoever fails to ready up, and a
 * double-timeout aborts with no Elo at all — both outcomes are named
 * explicitly so nobody discovers them only after the fact.
 */
function readyDeadlineCopy(
  youReady: boolean,
  opponentReady: boolean,
  secondsLeft: number,
): string {
  const mmss = formatMinSec(secondsLeft);
  if (!youReady && !opponentReady) {
    return `Ready up — match cancelled in ${mmss}`;
  }
  if (youReady && !opponentReady) {
    return `Waiting for opponent — they forfeit in ${mmss}`;
  }
  return `Opponent is ready — ready up or they win. ${mmss}`;
}

function fetchErrorMessage(status: number): string {
  if (status === 404) return "This race no longer exists.";
  if (status === 403) return "You are not a participant in this race.";
  if (status === 401) return "Please sign in to view this race.";
  return "Couldn't load the race. Retrying…";
}

function readyErrorMessage(error?: string): string {
  switch (error) {
    case "not_ready_phase":
      return "This race isn't in the ready phase anymore.";
    case "not_participant":
      return "You are not a participant in this race.";
    default:
      return "Couldn't mark ready. Try again.";
  }
}

function abortErrorMessage(error?: string): string {
  switch (error) {
    case "already_finished":
      return "This race has already ended.";
    case "not_participant":
      return "You are not a participant in this race.";
    default:
      return "Couldn't cancel the race. Try again.";
  }
}

function filtersErrorMessage(error?: string): string {
  switch (error) {
    case "not_challenger":
      return "Only the challenger can edit the problem filters.";
    case "not_editable":
      return "Filters can only be changed before the race starts.";
    case "invalid_body":
      return "Those filters aren't valid — check the rating and date ranges.";
    default:
      return "Couldn't update filters. Try again.";
  }
}

/**
 * Human-readable copy for a problem-selection failure. `hasFilters` softens
 * the wording for filterless races — blaming "the current filters" when none
 * are set would be misleading.
 */
function selectionFailureMessage(
  reason: ProblemSelectionFailureReason,
  hasFilters: boolean,
): string {
  switch (reason) {
    case "no_problems_in_filters":
      return hasFilters
        ? "No problems match. Widen the filters or keep hiding."
        : "Couldn't find a suitable problem — try again.";
    case "all_problems_seen":
      return hasFilters
        ? "You or your opponent has already attempted every matching problem."
        : "You or your opponent has already attempted every suitable problem.";
    default:
      return "Couldn't pick a problem for this race.";
  }
}

// ---------------------------------------------------------------------------
// In-lobby problem filters (issue #66; FilterEditor extracted to its own
// module in issue #276 — see src/components/race/FilterEditor.tsx)
// ---------------------------------------------------------------------------

function FiltersSection({
  filters,
  failureReason,
  isChallenger,
  isMatchmade,
  editing,
  saving,
  onEdit,
  onCancelEdit,
  onSave,
}: {
  filters: RaceProblemFilters | null;
  failureReason: ProblemSelectionFailureReason | null;
  isChallenger: boolean;
  isMatchmade: boolean;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (payload: FilterPayload) => void;
}) {
  const showSummary = filters !== null || isChallenger;
  // Matchmade races paired two players on overlapping filters — the stored
  // intersection is locked for both sides, so neither gets an Edit button and
  // the summary plate reads as an agreement, not a challenger-owned setting.
  const canEdit = isChallenger && !isMatchmade;

  return (
    <div className="flex flex-col gap-3">
      {failureReason && (
        <div
          role="alert"
          className="flex items-start gap-2 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span aria-hidden className="warning-glyph mt-0.5">
            !
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">Couldn&apos;t start the race</span>
            <span className="text-destructive/90">
              {selectionFailureMessage(failureReason, filters !== null)}{" "}
              {isMatchmade
                ? "The match cancels itself at the ready deadline if nobody readies up."
                : filters !== null
                  ? isChallenger
                    ? "Adjust the filters and ready up again."
                    : "Ask the challenger to adjust the filters."
                  : isChallenger
                    ? "Set filters below or ready up again."
                    : "Ready up again to retry."}
            </span>
          </div>
        </div>
      )}

      {editing ? (
        <FilterEditor
          filters={filters}
          saving={saving}
          onCancel={onCancelEdit}
          onSave={onSave}
        />
      ) : (
        showSummary && (
          <div className="stat-plate flex items-center justify-between gap-2 p-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="eyebrow text-muted-foreground">
                {isMatchmade ? "Agreed filters — locked for quick match" : "Problem filters"}
              </span>
              <span className="truncate font-mono text-xs">
                {filterSummary(filters ?? EMPTY_FILTERS)}
              </span>
            </div>
            {canEdit && (
              <Button type="button" variant="outline" size="sm" onClick={onEdit}>
                <SlidersHorizontal aria-hidden />
                Edit
              </Button>
            )}
          </div>
        )
      )}
    </div>
  );
}
