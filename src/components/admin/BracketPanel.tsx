"use client";

/**
 * Admin bracket panel (issue #241): UI for the bracket engine (#240) —
 * `GET /api/admin/tournament/bracket` plus seed / create-races / resolve /
 * walkover. Self-contained — owns its own fetching, same
 * loading|error|ready state union, 30s poll, and `cancelledRef` unmount
 * guard as `OpsPanel`.
 *
 * All mutating actions (seed, force re-seed, create races, resolve round,
 * walkover) are inline two-step arm/confirm — no browser `confirm()`. Force
 * re-seed additionally renders with `variant="destructive"` throughout and
 * explicit wipe-warning copy, since it silently discards the entire
 * existing bracket.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  defaultRatingRange,
  matchStatusBadge,
  playerLabel,
  roundLabel,
} from "@/lib/admin/bracket-display";
import type {
  CreateRoundRacesResponse,
  ResolveRoundResponse,
  SeedBracketResponse,
  TournamentBracketDTO,
  TournamentMatchDTO,
} from "@/lib/types";
import { TOURNAMENT_TOTAL_ROUNDS } from "@/lib/types";

const POLL_INTERVAL_MS = 30_000;

type BracketState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: TournamentBracketDTO };

type RatingInputs = Record<number, { min: string; max: string }>;

export function BracketPanel() {
  const [state, setState] = useState<BracketState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ratingInputs, setRatingInputs] = useState<RatingInputs>({});
  const cancelledRef = useRef(false);

  const fetchBracket = useCallback(async (background: boolean) => {
    if (background) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/tournament/bracket", { cache: "no-store" });
      if (cancelledRef.current) return;
      if (!res.ok) {
        if (!background) setState({ status: "error", message: "Couldn't load the bracket." });
        return;
      }
      const data = (await res.json()) as TournamentBracketDTO;
      if (cancelledRef.current) return;
      setState({ status: "ready", data });
    } catch {
      if (cancelledRef.current) return;
      if (!background) setState({ status: "error", message: "Couldn't reach the server." });
    } finally {
      if (!cancelledRef.current && background) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    async function load(background: boolean) {
      await fetchBracket(background);
    }

    load(false);
    const interval = setInterval(() => {
      load(true);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, [fetchBracket]);

  function ratingRangeFor(round: number): { min: string; max: string } {
    const existing = ratingInputs[round];
    if (existing) return existing;
    const d = defaultRatingRange(round);
    return { min: String(d.min), max: String(d.max) };
  }

  function setRatingInput(round: number, field: "min" | "max", value: string) {
    setRatingInputs((prev) => ({
      ...prev,
      [round]: { ...ratingRangeFor(round), [field]: value },
    }));
  }

  /** Shared run-and-refetch wrapper for every mutating action below. */
  async function runAction<T>(
    key: string,
    request: () => Promise<Response>,
    onSuccess: (data: T) => void,
    failureMessage: string,
  ) {
    setBusy(key);
    try {
      const res = await request();
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ? `${failureMessage} (${body.error})` : failureMessage);
        return;
      }
      const data = (await res.json()) as T;
      onSuccess(data);
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      if (!cancelledRef.current) {
        setBusy(null);
        setArmed(null);
      }
      await fetchBracket(true);
    }
  }

  function doSeed(force: boolean) {
    void runAction<SeedBracketResponse>(
      force ? "reseed" : "seed",
      () =>
        fetch("/api/admin/tournament/seed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force }),
        }),
      (data) => toast.success(`Seeded ${data.created} matches (${data.byes} byes).`),
      force ? "Couldn't re-seed the bracket." : "Couldn't seed the bracket.",
    );
  }

  function doCreateRaces(round: number) {
    const range = ratingRangeFor(round);
    const ratingMin = Number(range.min);
    const ratingMax = Number(range.max);
    void runAction<CreateRoundRacesResponse>(
      `create-${round}`,
      () =>
        fetch("/api/admin/tournament/create-races", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            round,
            ratingMin: Number.isFinite(ratingMin) ? ratingMin : undefined,
            ratingMax: Number.isFinite(ratingMax) ? ratingMax : undefined,
          }),
        }),
      (data) =>
        toast.success(
          `${roundLabel(round)}: created ${data.created} race(s), skipped ${data.skipped}.`,
        ),
      `Couldn't create races for ${roundLabel(round)}.`,
    );
  }

  function doResolve(round: number) {
    void runAction<ResolveRoundResponse>(
      `resolve-${round}`,
      () =>
        fetch("/api/admin/tournament/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ round }),
        }),
      (data) => {
        const attention = data.needsAttention.length;
        toast.success(
          `${roundLabel(round)}: resolved ${data.resolved}, advanced ${data.advanced}` +
            (attention > 0 ? `, ${attention} need attention.` : "."),
        );
      },
      `Couldn't resolve ${roundLabel(round)}.`,
    );
  }

  function doWalkover(matchId: string, winnerId: string, winnerName: string) {
    void runAction<{ ok: true }>(
      `walkover-${matchId}-${winnerId}`,
      () =>
        fetch("/api/admin/tournament/walkover", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ matchId, winnerId }),
        }),
      () => toast.success(`Walkover: ${winnerName} advances.`),
      "Couldn't apply the walkover.",
    );
  }

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow text-muted-foreground">Tournament bracket</p>
        <div className="flex items-center gap-2">
          {state.status === "ready" && state.data.seeded && (
            <ArmedAction
              actionKey="reseed"
              armed={armed}
              busy={busy}
              onArm={() => setArmed("reseed")}
              onCancel={() => setArmed(null)}
              onConfirm={() => doSeed(true)}
              label="Force re-seed"
              confirmLabel="Wipe & re-seed"
              variant="destructive"
              size="sm"
            />
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fetchBracket(true)}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            Refresh
          </Button>
        </div>
      </div>

      <div className="mt-4">
        {state.status === "loading" && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading…
          </p>
        )}

        {state.status === "error" && (
          <div className="flex flex-col items-start gap-2 py-6">
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => fetchBracket(false)}>
              Retry
            </Button>
          </div>
        )}

        {state.status === "ready" && !state.data.seeded && (
          <div className="flex flex-col items-start gap-3 py-6">
            <p className="text-sm text-muted-foreground">
              No bracket yet — seed it from current registrations.
            </p>
            <ArmedAction
              actionKey="seed"
              armed={armed}
              busy={busy}
              onArm={() => setArmed("seed")}
              onCancel={() => setArmed(null)}
              onConfirm={() => doSeed(false)}
              label="Seed bracket"
              confirmLabel="Confirm seed"
            />
          </div>
        )}

        {state.status === "ready" && state.data.seeded && (
          <div className="flex flex-col gap-6">
            {Array.from({ length: TOURNAMENT_TOTAL_ROUNDS }, (_, i) => i + 1).map((round) => (
              <RoundSection
                key={round}
                round={round}
                matches={state.data.matches.filter((m) => m.round === round)}
                ratingRange={ratingRangeFor(round)}
                onRatingChange={(field, value) => setRatingInput(round, field, value)}
                armed={armed}
                busy={busy}
                setArmed={setArmed}
                onCreateRaces={() => doCreateRaces(round)}
                onResolve={() => doResolve(round)}
                onWalkover={doWalkover}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RoundSection({
  round,
  matches,
  ratingRange,
  onRatingChange,
  armed,
  busy,
  setArmed,
  onCreateRaces,
  onResolve,
  onWalkover,
}: {
  round: number;
  matches: TournamentMatchDTO[];
  ratingRange: { min: string; max: string };
  onRatingChange: (field: "min" | "max", value: string) => void;
  armed: string | null;
  busy: string | null;
  setArmed: (key: string | null) => void;
  onCreateRaces: () => void;
  onResolve: () => void;
  onWalkover: (matchId: string, winnerId: string, winnerName: string) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow text-muted-foreground">{roundLabel(round)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Min
            <input
              type="number"
              value={ratingRange.min}
              onChange={(e) => onRatingChange("min", e.target.value)}
              aria-label={`${roundLabel(round)} rating min`}
              className="h-7 w-20 rounded-[var(--radius)] border border-border bg-background px-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Max
            <input
              type="number"
              value={ratingRange.max}
              onChange={(e) => onRatingChange("max", e.target.value)}
              aria-label={`${roundLabel(round)} rating max`}
              className="h-7 w-20 rounded-[var(--radius)] border border-border bg-background px-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <ArmedAction
            actionKey={`create-${round}`}
            armed={armed}
            busy={busy}
            onArm={() => setArmed(`create-${round}`)}
            onCancel={() => setArmed(null)}
            onConfirm={onCreateRaces}
            label="Create races"
            confirmLabel="Confirm"
          />
          <ArmedAction
            actionKey={`resolve-${round}`}
            armed={armed}
            busy={busy}
            onArm={() => setArmed(`resolve-${round}`)}
            onCancel={() => setArmed(null)}
            onConfirm={onResolve}
            label="Resolve round"
            confirmLabel="Confirm"
          />
        </div>
      </div>

      {matches.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">No matches in this round.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {matches.map((match) => (
            <MatchRow
              key={match.id}
              match={match}
              armed={armed}
              busy={busy}
              setArmed={setArmed}
              onWalkover={onWalkover}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MatchRow({
  match,
  armed,
  busy,
  setArmed,
  onWalkover,
}: {
  match: TournamentMatchDTO;
  armed: string | null;
  busy: string | null;
  setArmed: (key: string | null) => void;
  onWalkover: (matchId: string, winnerId: string, winnerName: string) => void;
}) {
  const badge = matchStatusBadge(match);
  const canWalkover = match.status === "pending" && match.p1 !== null && match.p2 !== null;

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <Badge variant={badge.variant}>{badge.label}</Badge>

      <span className="font-mono text-xs">
        <span className="text-player-self">{playerLabel(match.p1)}</span>
        <span className="text-muted-foreground"> vs </span>
        <span className="text-player-opponent">{playerLabel(match.p2)}</span>
      </span>

      {match.raceId && (
        <Link
          href={`/race/${match.raceId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          Race
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      )}

      {canWalkover && (
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <ArmedAction
            actionKey={`walkover-${match.id}-${match.p1!.userId}`}
            armed={armed}
            busy={busy}
            onArm={() => setArmed(`walkover-${match.id}-${match.p1!.userId}`)}
            onCancel={() => setArmed(null)}
            onConfirm={() => onWalkover(match.id, match.p1!.userId, match.p1!.username)}
            label={`W: ${match.p1!.username}`}
            confirmLabel="Confirm"
          />
          <ArmedAction
            actionKey={`walkover-${match.id}-${match.p2!.userId}`}
            armed={armed}
            busy={busy}
            onArm={() => setArmed(`walkover-${match.id}-${match.p2!.userId}`)}
            onCancel={() => setArmed(null)}
            onConfirm={() => onWalkover(match.id, match.p2!.userId, match.p2!.username)}
            label={`W: ${match.p2!.username}`}
            confirmLabel="Confirm"
          />
        </span>
      )}
    </li>
  );
}

/**
 * Inline two-step arm/confirm control shared by every mutating action in
 * this panel. First click arms (shows Confirm + Cancel in place of the
 * trigger); second click runs the action. No browser `confirm()`.
 */
function ArmedAction({
  actionKey,
  armed,
  busy,
  onArm,
  onCancel,
  onConfirm,
  label,
  confirmLabel,
  variant = "outline",
  size = "sm",
}: {
  actionKey: string;
  armed: string | null;
  busy: string | null;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  label: string;
  confirmLabel: string;
  variant?: "outline" | "destructive";
  size?: "sm" | "xs";
}) {
  const isArmed = armed === actionKey;
  const isBusy = busy === actionKey;
  const anyBusy = busy !== null;

  if (!isArmed) {
    return (
      <Button type="button" size={size} variant={variant} onClick={onArm} disabled={anyBusy}>
        {label}
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        type="button"
        size={size}
        variant="destructive"
        onClick={onConfirm}
        disabled={isBusy}
      >
        {isBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
        {confirmLabel}
      </Button>
      <Button type="button" size={size} variant="ghost" onClick={onCancel} disabled={isBusy}>
        Cancel
      </Button>
    </span>
  );
}
