"use client";

/**
 * In-lobby problem filter editor (issue #66; extracted to a standalone module
 * in issue #276 so the pre-queue filter panel on `/queue` (issue #276) can
 * reuse it without duplicating the picker UI). Exports the filter wire shape,
 * defaults, options, date-preset helpers, and the summary formatter alongside
 * the editor component itself — `Lobby` re-imports all of it.
 *
 * Deliberately not shared with `src/components/challenge/new-challenge-form.tsx`,
 * which has its own near-duplicate rating/date picker wired to a different
 * submit flow (challenge creation, not an existing race's filters) — the two
 * are kept independent by design.
 */

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PROBLEM_RATING_CEIL, PROBLEM_RATING_FLOOR } from "@/lib/types";
import type { RaceProblemFilters } from "@/lib/types";

/** Wire shape for `PATCH /api/races/[id]/filters` (omit = "no constraint"). */
export interface FilterPayload {
  ratingMin?: number;
  ratingMax?: number;
  dateFrom?: string;
  dateTo?: string;
}

export const EMPTY_FILTERS: RaceProblemFilters = {
  ratingMin: null,
  ratingMax: null,
  dateFrom: null,
  dateTo: null,
};

/** Every multiple of 100 in [PROBLEM_RATING_FLOOR, PROBLEM_RATING_CEIL]. */
export const RATING_OPTIONS = Array.from(
  { length: (PROBLEM_RATING_CEIL - PROBLEM_RATING_FLOOR) / 100 + 1 },
  (_, i) => PROBLEM_RATING_FLOOR + i * 100,
);

export type DatePreset = "any" | "1y" | "2y" | "5y" | "custom";

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "1y", label: "Last year" },
  { value: "2y", label: "Last 2 years" },
  { value: "5y", label: "Last 5 years" },
  { value: "custom", label: "Custom range" },
];

/** ISO `dateFrom` for a preset, or `null` for "any"/"custom". */
export function presetDateFrom(preset: DatePreset): string | null {
  if (preset === "any" || preset === "custom") return null;
  const years = preset === "1y" ? 1 : preset === "2y" ? 2 : 5;
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString();
}

/** Start-of-day ISO for a `yyyy-mm-dd` value, or `null` if empty/invalid. */
export function dayStartIso(dateInput: string): string | null {
  if (!dateInput) return null;
  const d = new Date(`${dateInput}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** End-of-day ISO for a `yyyy-mm-dd` value, or `null` if empty/invalid. */
export function dayEndIso(dateInput: string): string | null {
  if (!dateInput) return null;
  const d = new Date(`${dateInput}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO -> `yyyy-mm-dd` for a `<input type="date">` value. */
export function isoToDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/** One-line summary of the active filters, shown to both players. */
export function filterSummary(filters: RaceProblemFilters): string {
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

export function FilterEditor({
  filters,
  saving,
  onCancel,
  onSave,
  submitLabel = "Save filters",
}: {
  filters: RaceProblemFilters | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: FilterPayload) => void;
  /** Label for the primary action button while not saving. */
  submitLabel?: string;
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
        <span className="eyebrow text-muted-foreground">
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
        <span className="eyebrow text-muted-foreground">
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
            submitLabel
          )}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
