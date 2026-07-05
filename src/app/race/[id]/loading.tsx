/** Race room skeleton (issue #19) — mirrors the 3-pane active layout. */
export default function RaceLoading() {
  return (
    <main className="flex flex-1 flex-col px-4 py-4" aria-busy="true" aria-live="polite">
      <div
        className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,340px)]"
      >
        <div className="hidden min-h-[320px] animate-pulse rounded-xl border border-border bg-card/30 lg:block" />
        <div className="min-h-[320px] animate-pulse rounded-xl border border-border bg-card/30" />
        <div className="hidden min-h-[320px] animate-pulse rounded-xl border border-border bg-card/30 lg:block" />
      </div>
      <span className="sr-only">Loading the race…</span>
    </main>
  );
}
