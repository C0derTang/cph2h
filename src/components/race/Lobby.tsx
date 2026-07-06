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
import { Check, Copy, Loader2, Swords, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildJoinUrl } from "@/lib/race/join-url";
import { CLIENT_POLL_INTERVAL_MS } from "@/lib/types";
import type { PublicUser, RaceSnapshot } from "@/lib/types";

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
  const [, forceTick] = useState(0);
  const notifiedActiveRef = useRef(false);
  const fetchedOnceRef = useRef(Boolean(initialSnapshot));
  const seenOpponentIdRef = useRef<string | null>(initialSnapshot?.p2?.id ?? null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/races/${raceId}`, { cache: "no-store" });
      if (!res.ok) {
        setError(fetchErrorMessage(res.status));
        return;
      }
      const data = (await res.json()) as RaceSnapshot;
      if (data.p2 && !seenOpponentIdRef.current) {
        toast.success(`${data.p2.username} joined — get ready!`);
      }
      seenOpponentIdRef.current = data.p2?.id ?? seenOpponentIdRef.current;
      setSnapshot(data);
      setError(null);
    } catch {
      setError("Couldn't reach the server. Retrying…");
    } finally {
      fetchedOnceRef.current = true;
      setLoading(false);
    }
  }, [raceId]);

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
    if (Date.now() >= startedAtMs) return;
    const tick = setInterval(() => {
      // Tick first so the final render reflects "started", then stop —
      // otherwise this would keep firing uselessly for the rest of the race.
      forceTick((n) => n + 1);
      if (Date.now() >= startedAtMs) clearInterval(tick);
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
        if (data?.race) setSnapshot(data.race as RaceSnapshot);
        return;
      }
      setSnapshot(data as RaceSnapshot);
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
        if (data?.race) setSnapshot(data.race as RaceSnapshot);
        return;
      }
      setSnapshot(data as RaceSnapshot);
    } catch {
      const message = "Couldn't cancel the race — check your connection and try again.";
      setError(message);
      toast.error(message);
    } finally {
      setCancelling(false);
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
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading race…
        </div>
      </LobbyShell>
    );
  }

  if (!snapshot) {
    return (
      <LobbyShell className={className}>
        <p role="alert" className="text-sm text-destructive">
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

  return (
    <LobbyShell className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Swords className="size-4 text-primary" aria-hidden />
          {statusHeading(snapshot)}
        </CardTitle>
        <CardDescription>{statusSubheading(snapshot)}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <PlayerRow user={you} ready={youReady} label="You" />
          <PlayerRow user={opponent} ready={opponentReady} label="Opponent" />
        </div>

        {snapshot.status === "pending" && snapshot.challengeToken && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                Share this link
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
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
            disabled={readying || cancelling || youReady}
          >
            {readying ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Marking ready…
              </>
            ) : youReady ? (
              "Waiting for opponent…"
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
                Cancelling…
              </>
            ) : (
              "Cancel challenge"
            )}
          </Button>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
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
  return <Card className={className}>{children}</Card>;
}

function PlayerRow({
  user,
  ready,
  label,
}: {
  user: PublicUser | null;
  ready: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground">
        <UserRound className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </p>
        {user ? (
          <p className="truncate text-sm font-medium">
            {user.username}{" "}
            <span className="font-normal text-muted-foreground">
              · {user.elo} elo
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Waiting to join…</p>
        )}
      </div>
      {user && (
        <Badge variant={ready ? "default" : "outline"}>
          {ready ? "Ready" : "Not ready"}
        </Badge>
      )}
    </div>
  );
}

function statusHeading(snapshot: RaceSnapshot): string {
  switch (snapshot.status) {
    case "pending":
      return "Waiting for opponent";
    case "ready":
      return "Get ready";
    case "active": {
      const startedAt = snapshot.startedAt ? new Date(snapshot.startedAt) : null;
      if (startedAt && Date.now() < startedAt.getTime()) {
        const secondsLeft = Math.max(
          0,
          Math.ceil((startedAt.getTime() - Date.now()) / 1000),
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

function statusSubheading(snapshot: RaceSnapshot): string {
  switch (snapshot.status) {
    case "pending":
      return "Share the link below — the race begins once your opponent joins.";
    case "ready":
      return "Both players must mark ready to start the countdown.";
    case "active":
      return snapshot.startedAt && Date.now() < new Date(snapshot.startedAt).getTime()
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
