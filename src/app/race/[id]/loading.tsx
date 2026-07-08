/**
 * Race room skeleton (issue #19, corrected in #140) — mirrors the common
 * 2-col fallback grid `RaceRoom.tsx`'s `panes()` renders when the scraped
 * statement is absent (`lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]`, see
 * issue #109 — the CF scrape is best-effort, so this IS the common case, not
 * the rarer 3-col statement-present layout). Left column stacks a compact
 * header-bar block above a stage block, matching `compactProblemHeader` +
 * `centerStage`; the right column is the `sideRail` width (320px in both real
 * layouts). No screen-width-based hiding: below `lg` this stacks to a single
 * column exactly like the real grid does (it has no mobile-specific hidden
 * panes), so the skeleton never hides content the real page would show.
 * `rounded-lg` resolves to `var(--radius-lg)` = `var(--radius)` (see the
 * `@theme inline` block in globals.css), matching every panel's rounding.
 */
export default function RaceLoading() {
  return (
    <main className="flex flex-1 flex-col px-4 py-4" aria-busy="true" aria-live="polite">
      <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="h-16 shrink-0 animate-pulse rounded-lg border border-border bg-card/30" />
          <div className="min-h-[320px] flex-1 animate-pulse rounded-lg border border-border bg-card/30" />
        </div>
        <div className="min-h-[320px] animate-pulse rounded-lg border border-border bg-card/30" />
      </div>
      <span className="sr-only">Loading the race…</span>
    </main>
  );
}
