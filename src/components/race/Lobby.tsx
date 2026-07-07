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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildJoinUrl } from "@/lib/race/join-url";
import { computeSkewMs, correctedNow } from "@/lib/race/countdown";
import { canCompete } from "@/lib/race/av-requirements";
import { useMicPermission } from "@/components/race/useMicPermission";
import { useOpponentVolume, VolumeSlider } from "@/components/race/VolumeControl";
import {
  CLIENT_POLL_INTERVAL_MS,
  PROBLEM_RATING_CEIL,
  PROBLEM_RATING_FLOOR,
} from "@/lib/types";
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
  const seenOpponentIdRef = useRef<string | null>(initialSnapshot?.p2?.id ?? null);
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

  // Compete gate (issue #100): a client-side-only requirement, checked here
  // so the "I'm ready" button can't be pressed muted or deaf. `useMicPermission`
  // works without any LiveKit context (the Lobby renders standalone, before
  // `LiveKitRoom` mounts in the active branch — see `RaceRoom.tsx`); the
  // opponent-volume setting persists across that transition via localStorage.
  const mic = useMicPermission();
  const opponentVolume = useOpponentVolume();
  const meetsCompeteGate = canCompete({
    micGranted: mic.micGranted,
    micLive: mic.micLive,
    volumeAudible: opponentVolume.volumeAudible,
  });

  // Applies any freshly-received `RaceSnapshot` — whether from the polling
  // `refresh()` fetch or a direct action response (`handleReady`,
  // `handleCancel`, `handleSaveFilters`) — through one path so clock-skew
  // correction and the "opponent joined" toast happen on every snapshot
  // receipt, not just the poll (mirrors `RaceRoom`'s `applySnapshot`; issue
  // #75 — previously the action handlers set the snapshot directly and never
  // recomputed skew, so a stale skew could linger through ready/cancel).
  const applySnapshot = useCallback((data: RaceSnapshot) => {
    setSkewMs(computeSkewMs(data.now, Date.now()));
    if (data.p2 && !seenOpponentIdRef.current) {
      toast.success(`${data.p2.username} joined — get ready!`);
    }
    seenOpponentIdRef.current = data.p2?.id ?? seenOpponentIdRef.current;
    setSnapshot(data);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/races/${raceId}`, { cache: "no-store" });
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

  // Initial fetch (if not seeded by the server) + poll while the race is
  // still in the lobby (pending/ready).
  useEffect(() => {
    if (!fetchedOnceRef.current) {
      refresh();
    }
    if (snapshot?.status && TERMINAL_STATUSES.has(snapshot.status)) {
      return;
    }
    const interval = setInterval(refresh, CLIENT_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
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
      const message = "Couldn't mark ready — check your connection and try again.";
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
      const message = "Couldn't cancel the race — check your connection and try again.";
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
      toast.success("Link copied to clipboard.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — your browser may be blocking clipboard access.");
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

  return (
    <LobbyShell className={className}>
      <div className="ticker justify-between px-4 py-2.5">
        <span>lobby &middot; {snapshot.status}</span>
        <span className="flex items-center gap-1.5 text-verdict-pending">
          <span className="size-1.5 rounded-full bg-verdict-pending motion-safe:animate-pulse" />
          live
        </span>
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

      {counting && secondsLeft != null && (
        <div className="flex flex-col items-center gap-1 border-t border-border py-5">
          <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
            Starts in
          </span>
          <span className="font-mono text-6xl font-semibold tabular-nums">
            {secondsLeft}
          </span>
        </div>
      )}

      {/* VS poster lockup: champion (gold) vs challenger (crimson) corners
          split by a thin gold rule, per docs/design.md. */}
      <div className="relative grid gap-3 border-t border-border p-5 sm:grid-cols-2 sm:gap-0 sm:p-0">
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
            editing={editingFilters}
            saving={savingFilters}
            onEdit={() => setEditingFilters(true)}
            onCancelEdit={() => setEditingFilters(false)}
            onSave={handleSaveFilters}
          />
        )}

        {(snapshot.status === "pending" || snapshot.status === "ready") && (
          <CompeteGate mic={mic} opponentVolume={opponentVolume} />
        )}

        {snapshot.status === "pending" && snapshot.challengeToken && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
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
          <Button
            type="button"
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
              "They're stalling…"
            ) : !meetsCompeteGate ? (
              "Mic on. Volume up."
            ) : (
              "I'm ready"
            )}
          </Button>
        )}

        {(snapshot.status === "pending" || snapshot.status === "ready") && (
          <Button
            type="button"
            variant="outline"
            className="text-destructive"
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
          </Button>
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
    <div className={cn("panel clip-notch overflow-hidden", className)}>
      {children}
    </div>
  );
}

/**
 * Compete-gate checklist (issue #100): "Mic on. Volume up. No excuses."
 * Shows mic ✓/✗ with a "Grant mic" action and volume ✓/✗ with the live
 * slider right there — camera is explicitly called out as not required.
 * Pure presentation; the actual gating predicate (`canCompete`) lives with
 * the hooks in the parent so it can also disable the ready button.
 */
function CompeteGate({
  mic,
  opponentVolume,
}: {
  mic: ReturnType<typeof useMicPermission>;
  opponentVolume: ReturnType<typeof useOpponentVolume>;
}) {
  const micOk = mic.micGranted && mic.micLive;
  const micLabel = !mic.supported
    ? "Mic unsupported in this browser"
    : mic.permissionState === "denied"
      ? "Mic blocked — allow it in your browser's site settings"
      : "Grant mic";

  return (
    <div className="stat-plate flex flex-col gap-3 p-3" data-testid="compete-gate">
      <div className="flex flex-col gap-0.5">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Compete requirements
        </p>
        <p className="text-sm">Mic on. Volume up. No excuses.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cn(
            "flex items-center gap-1.5 text-sm",
            micOk ? "text-verdict-ok" : "text-verdict-fail",
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

      <div className="flex items-center gap-2">
        <span
          className={cn(
            "shrink-0",
            opponentVolume.volumeAudible ? "text-verdict-ok" : "text-verdict-fail",
          )}
          data-testid="volume-requirement"
        >
          {opponentVolume.volumeAudible ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <X className="size-4" aria-hidden />
          )}
        </span>
        <VolumeSlider
          volume={opponentVolume.volume}
          onChange={opponentVolume.setVolume}
          className="flex-1"
          testId="volume-slider-lobby"
        />
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Video className="size-3.5 shrink-0" aria-hidden />
        Camera&apos;s optional — nobody needs to see you rage-quit.
      </p>
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
            "font-mono text-[11px] font-semibold tracking-[0.18em] uppercase",
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
          <p className="text-sm text-muted-foreground">Waiting to join…</p>
        )}
      </div>
      {user && (
        <Badge variant={ready ? "verdict-ok" : "verdict-pending"}>
          {ready ? "Ready" : "Not ready"}
        </Badge>
      )}
    </div>
  );
}

function statusHeading(snapshot: RaceSnapshot, nowMs: number): string {
  switch (snapshot.status) {
    case "pending":
      return "They're stalling.";
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
      return "Race started!";
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
        : "Good luck!";
    case "finished":
      return "This race has already ended.";
    case "aborted":
      return "This race was cancelled before it finished.";
    default:
      return "";
  }
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
// In-lobby problem filters (issue #66)
// ---------------------------------------------------------------------------

/** Wire shape for `PATCH /api/races/[id]/filters` (omit = "no constraint"). */
export interface FilterPayload {
  ratingMin?: number;
  ratingMax?: number;
  dateFrom?: string;
  dateTo?: string;
}

const EMPTY_FILTERS: RaceProblemFilters = {
  ratingMin: null,
  ratingMax: null,
  dateFrom: null,
  dateTo: null,
};

/** Every multiple of 100 in [PROBLEM_RATING_FLOOR, PROBLEM_RATING_CEIL]. */
const RATING_OPTIONS = Array.from(
  { length: (PROBLEM_RATING_CEIL - PROBLEM_RATING_FLOOR) / 100 + 1 },
  (_, i) => PROBLEM_RATING_FLOOR + i * 100,
);

type DatePreset = "any" | "1y" | "2y" | "5y" | "custom";

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "1y", label: "Last year" },
  { value: "2y", label: "Last 2 years" },
  { value: "5y", label: "Last 5 years" },
  { value: "custom", label: "Custom range" },
];

/** ISO `dateFrom` for a preset, or `null` for "any"/"custom". */
function presetDateFrom(preset: DatePreset): string | null {
  if (preset === "any" || preset === "custom") return null;
  const years = preset === "1y" ? 1 : preset === "2y" ? 2 : 5;
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString();
}

/** Start-of-day ISO for a `yyyy-mm-dd` value, or `null` if empty/invalid. */
function dayStartIso(dateInput: string): string | null {
  if (!dateInput) return null;
  const d = new Date(`${dateInput}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** End-of-day ISO for a `yyyy-mm-dd` value, or `null` if empty/invalid. */
function dayEndIso(dateInput: string): string | null {
  if (!dateInput) return null;
  const d = new Date(`${dateInput}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO -> `yyyy-mm-dd` for a `<input type="date">` value. */
function isoToDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/** One-line summary of the active filters, shown to both players. */
function filterSummary(filters: RaceProblemFilters): string {
  const parts: string[] = [];
  if (filters.ratingMin !== null || filters.ratingMax !== null) {
    const lo = filters.ratingMin ?? PROBLEM_RATING_FLOOR;
    const hi = filters.ratingMax ?? PROBLEM_RATING_CEIL;
    parts.push(`Rating ${lo}–${hi}`);
  }
  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ? isoToDateInput(filters.dateFrom) : "any";
    const to = filters.dateTo ? isoToDateInput(filters.dateTo) : "any";
    parts.push(`Contest ${from} → ${to}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No filters — any problem";
}

function FiltersSection({
  filters,
  failureReason,
  isChallenger,
  editing,
  saving,
  onEdit,
  onCancelEdit,
  onSave,
}: {
  filters: RaceProblemFilters | null;
  failureReason: ProblemSelectionFailureReason | null;
  isChallenger: boolean;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (payload: FilterPayload) => void;
}) {
  const showSummary = filters !== null || isChallenger;

  return (
    <div className="flex flex-col gap-3">
      {failureReason && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">Couldn&apos;t start the race</span>
            <span className="text-destructive/90">
              {selectionFailureMessage(failureReason, filters !== null)}{" "}
              {filters !== null
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
              <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                Problem filters
              </span>
              <span className="truncate font-mono text-xs">
                {filterSummary(filters ?? EMPTY_FILTERS)}
              </span>
            </div>
            {isChallenger && (
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

function FilterEditor({
  filters,
  saving,
  onCancel,
  onSave,
}: {
  filters: RaceProblemFilters | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: FilterPayload) => void;
}) {
  const [ratingMin, setRatingMin] = useState<number | null>(filters?.ratingMin ?? null);
  const [ratingMax, setRatingMax] = useState<number | null>(filters?.ratingMax ?? null);
  const [datePreset, setDatePreset] = useState<DatePreset>(
    filters?.dateFrom || filters?.dateTo ? "custom" : "any",
  );
  const [customDateFrom, setCustomDateFrom] = useState(
    isoToDateInput(filters?.dateFrom ?? null),
  );
  const [customDateTo, setCustomDateTo] = useState(
    isoToDateInput(filters?.dateTo ?? null),
  );

  const dateFrom = useMemo(
    () => (datePreset === "custom" ? dayStartIso(customDateFrom) : presetDateFrom(datePreset)),
    [datePreset, customDateFrom],
  );
  const dateTo = useMemo(
    () => (datePreset === "custom" ? dayEndIso(customDateTo) : null),
    [datePreset, customDateTo],
  );

  const ratingRangeInvalid =
    ratingMin !== null && ratingMax !== null && ratingMin > ratingMax;
  const dateRangeInvalid =
    dateFrom !== null && dateTo !== null && Date.parse(dateFrom) > Date.parse(dateTo);
  const invalid = ratingRangeInvalid || dateRangeInvalid;

  function submit() {
    if (invalid) return;
    onSave({
      ...(ratingMin !== null ? { ratingMin } : {}),
      ...(ratingMax !== null ? { ratingMax } : {}),
      ...(dateFrom !== null ? { dateFrom } : {}),
      ...(dateTo !== null ? { dateTo } : {}),
    });
  }

  return (
    <div className="stat-plate flex flex-col gap-4 p-3">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Problem rating range
        </span>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            value={ratingMin ?? ""}
            onChange={(e) => setRatingMin(e.target.value ? Number(e.target.value) : null)}
            aria-label="Minimum problem rating"
          >
            <option value="">Any</option>
            {RATING_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">to</span>
          <select
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            value={ratingMax ?? ""}
            onChange={(e) => setRatingMax(e.target.value ? Number(e.target.value) : null)}
            aria-label="Maximum problem rating"
          >
            <option value="">Any</option>
            {RATING_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        {ratingRangeInvalid && (
          <p role="alert" className="text-xs text-destructive">
            Minimum rating must be ≤ maximum rating.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Contest date
        </span>
        <div className="flex flex-wrap gap-2">
          {DATE_PRESETS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant={datePreset === opt.value ? "default" : "outline"}
              aria-pressed={datePreset === opt.value}
              onClick={() => setDatePreset(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        {datePreset === "custom" && (
          <div className="flex items-center gap-2 pt-1">
            <input
              type="date"
              className="h-8 rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              value={customDateFrom}
              onChange={(e) => setCustomDateFrom(e.target.value)}
              aria-label="Contest date from"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <input
              type="date"
              className="h-8 rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              value={customDateTo}
              onChange={(e) => setCustomDateTo(e.target.value)}
              aria-label="Contest date to"
            />
          </div>
        )}
        {dateRangeInvalid && (
          <p role="alert" className="text-xs text-destructive">
            Start date must be on or before end date.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={submit} disabled={saving || invalid}>
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Saving…
            </>
          ) : (
            "Save filters"
          )}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
