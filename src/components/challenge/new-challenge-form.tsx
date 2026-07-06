"use client";

/**
 * Shared challenge-creation form (issue #16; extracted to a standalone
 * component in issue #89 so the Play hub and the slim `/challenge/new` route
 * can both render it inline). Calls `POST /api/races` (issue #7) — the only
 * place a challenge race is actually created — then shows the returned
 * `joinUrl` with a copy button and a link into the race room, where the
 * `Lobby` component takes over.
 *
 * Issue #64 adds optional problem filters: a rating-range picker and a
 * contest-date preset/custom-range picker. Filter values are omitted from the
 * request entirely when left at "Any" — a filterless submit is byte-for-byte
 * what this route accepted before this issue. While any filter is set, a
 * debounced call to `GET /api/problems/availability` shows a live count and
 * disables submit at zero; a 422 `no_problems_in_range` from the POST itself
 * (the pool can shrink between the live check and submit) surfaces as a toast
 * exactly like the other error codes below.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Copy, Loader2, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_TIME_LIMIT_SEC,
  PROBLEM_RATING_CEIL,
  PROBLEM_RATING_FLOOR,
  type CreateRaceResponse,
} from "@/lib/types";

const TIME_LIMIT_OPTIONS = [
  { label: "20 min", seconds: 1200 },
  { label: "40 min", seconds: 2400 },
  { label: "60 min", seconds: 3600 },
  { label: "90 min", seconds: 5400 },
];

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

/** Debounce for the live availability check, so we don't fetch on every keystroke/click. */
const AVAILABILITY_DEBOUNCE_MS = 400;

/** ISO `dateFrom` for a preset, or `null` for "any time" / "custom" (custom uses the date inputs instead). */
function presetDateFrom(preset: DatePreset): string | null {
  if (preset === "any" || preset === "custom") return null;
  const years = preset === "1y" ? 1 : preset === "2y" ? 2 : 5;
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString();
}

/** Start-of-day ISO for a `yyyy-mm-dd` `<input type="date">` value, or `null` if empty/invalid. */
function dayStartIso(dateInput: string): string | null {
  if (!dateInput) return null;
  const d = new Date(`${dateInput}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** End-of-day ISO for a `yyyy-mm-dd` `<input type="date">` value, or `null` if empty/invalid. */
function dayEndIso(dateInput: string): string | null {
  if (!dateInput) return null;
  const d = new Date(`${dateInput}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function NewChallengeForm() {
  const [timeLimitSec, setTimeLimitSec] = useState(DEFAULT_TIME_LIMIT_SEC);

  const [ratingMin, setRatingMin] = useState<number | null>(null);
  const [ratingMax, setRatingMax] = useState<number | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>("any");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");

  const [availableCount, setAvailableCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [result, setResult] = useState<CreateRaceResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const ratingRangeInvalid =
    ratingMin !== null && ratingMax !== null && ratingMin > ratingMax;

  const dateFrom = useMemo(
    () => (datePreset === "custom" ? dayStartIso(customDateFrom) : presetDateFrom(datePreset)),
    [datePreset, customDateFrom],
  );
  const dateTo = useMemo(
    () => (datePreset === "custom" ? dayEndIso(customDateTo) : null),
    [datePreset, customDateTo],
  );
  const dateRangeInvalid =
    dateFrom !== null && dateTo !== null && Date.parse(dateFrom) > Date.parse(dateTo);

  const hasAnyFilter =
    ratingMin !== null || ratingMax !== null || dateFrom !== null || dateTo !== null;
  const filtersValid = !ratingRangeInvalid && !dateRangeInvalid;

  // Debounced live availability check — only while a filter is actually set
  // and the ranges are internally consistent (no point checking `min > max`).
  // Nothing here runs synchronously in the effect body: when the guard fails
  // we simply don't start a fetch (the render below derives "no count to
  // show" from `hasAnyFilter`/`filtersValid` instead of resetting state), and
  // all `setState` calls for the happy path happen inside the debounce
  // timer's callback.
  useEffect(() => {
    if (!hasAnyFilter || !filtersValid) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setCountLoading(true);
      void (async () => {
        try {
          const qs = new URLSearchParams();
          if (ratingMin !== null) qs.set("ratingMin", String(ratingMin));
          if (ratingMax !== null) qs.set("ratingMax", String(ratingMax));
          if (dateFrom !== null) qs.set("dateFrom", dateFrom);
          if (dateTo !== null) qs.set("dateTo", dateTo);

          const res = await fetch(`/api/problems/availability?${qs.toString()}`, {
            signal: controller.signal,
          });
          if (!res.ok) {
            setAvailableCount(null);
            return;
          }
          const data = await res.json().catch(() => ({}));
          setAvailableCount(typeof data?.count === "number" ? data.count : null);
        } catch (err) {
          if ((err as Error)?.name !== "AbortError") setAvailableCount(null);
        } finally {
          setCountLoading(false);
        }
      })();
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [hasAnyFilter, filtersValid, ratingMin, ratingMax, dateFrom, dateTo]);

  const displayCount = hasAnyFilter && filtersValid ? availableCount : null;
  const displayCountLoading = hasAnyFilter && filtersValid && countLoading;

  async function handleCreate() {
    setCreating(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await fetch("/api/races", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          timeLimitSec,
          ...(ratingMin !== null ? { ratingMin } : {}),
          ...(ratingMax !== null ? { ratingMax } : {}),
          ...(dateFrom !== null ? { dateFrom } : {}),
          ...(dateTo !== null ? { dateTo } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = createErrorMessage(data?.error);
        setError(message);
        setErrorCode(data?.error ?? null);
        toast.error(message);
        return;
      }
      setResult(data as CreateRaceResponse);
      toast.success("Challenge created — share the link with a friend.");
    } catch {
      setError("Network error — please try again.");
      toast.error("Network error — please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.joinUrl);
      setCopied(true);
      toast.success("Link copied to clipboard.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — your browser may be blocking clipboard access.");
    }
  }

  if (result) {
    return (
      <div className="panel max-w-lg p-5">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
            <Swords className="size-4 text-player-self" aria-hidden />
            Challenge created
          </h2>
          <p className="text-sm text-muted-foreground">
            Share this link with your opponent — it works until someone joins.
          </p>
        </div>
        <div className="mt-4 flex flex-col gap-4">
          <div className="stat-plate flex items-center gap-2 p-2.5">
            <code className="flex-1 truncate font-mono text-xs">
              {result.joinUrl}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={copyLink}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button render={<Link href={`/race/${result.raceId}`} />} nativeButton={false}>
            Go to race room
          </Button>
        </div>
      </div>
    );
  }

  const submitDisabled = creating || !filtersValid || displayCount === 0;

  return (
    <div className="panel max-w-lg p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Create a challenge
        </h2>
        <p className="text-sm text-muted-foreground">
          Pick a time limit and optional problem filters, then share the link with a friend.
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
            Time limit
          </span>
          <div className="flex flex-wrap gap-2">
            {TIME_LIMIT_OPTIONS.map((opt) => (
              <Button
                key={opt.seconds}
                type="button"
                size="sm"
                variant={timeLimitSec === opt.seconds ? "default" : "outline"}
                aria-pressed={timeLimitSec === opt.seconds}
                onClick={() => setTimeLimitSec(opt.seconds)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

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

        {hasAnyFilter && filtersValid && (
          <p role="status" className="text-xs text-muted-foreground">
            {displayCountLoading
              ? "Checking available problems…"
              : displayCount === null
                ? "Couldn't check problem availability."
                : displayCount === 0
                  ? "No cached problems match these filters — widen the range."
                  : `${displayCount} problem${displayCount === 1 ? "" : "s"} available.`}
          </p>
        )}

        {error && (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            {errorCode === "cf_not_linked" && (
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

        <Button type="button" onClick={handleCreate} disabled={submitDisabled}>
          {creating ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Creating…
            </>
          ) : (
            "Create challenge"
          )}
        </Button>
      </div>
    </div>
  );
}

function createErrorMessage(error?: string): string {
  if (error === "cf_not_linked") return "Link your Codeforces account first.";
  if (error === "unauthorized") return "Please sign in to create a challenge.";
  if (error === "no_problems_in_range") {
    return "No cached problems match your filters — widen the range and try again.";
  }
  return "Could not create the challenge. Try again.";
}
