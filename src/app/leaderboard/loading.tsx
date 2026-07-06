/** Leaderboard skeleton (issue #19) — mirrors the ranked-panel layout. */
export default function LeaderboardLoading() {
  return (
    <div className="shell py-8" aria-busy="true" aria-live="polite">
      <div className="mb-8">
        <div className="h-9 w-48 animate-pulse rounded-md bg-muted" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded-md bg-muted" />
      </div>

      <div className="panel overflow-hidden">
        <div className="flex flex-col divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-5 w-6 animate-pulse rounded-md bg-muted" />
              <div className="h-4 w-32 flex-1 animate-pulse rounded-md bg-muted" />
              <div className="h-4 w-20 animate-pulse rounded-md bg-muted" />
              <div className="h-4 w-10 animate-pulse rounded-md bg-muted" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading the leaderboard…</span>
    </div>
  );
}
