/** The Ladder skeleton (issue #19; v4 glitch-HUD pass) — mirrors the heading,
 * the your-rank stat plate, and the ranked table as matte hard-edged plates
 * (radius token, no glass). */
export default function LeaderboardLoading() {
  return (
    <div className="shell py-8" aria-busy="true" aria-live="polite">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="h-10 w-48 motion-safe:animate-pulse rounded-md bg-muted" />
          <div className="mt-2 h-4 w-64 motion-safe:animate-pulse rounded-md bg-muted" />
        </div>
        <div className="stat-plate h-12 w-36 motion-safe:animate-pulse px-4 py-2.5" />
      </div>

      <div className="panel bracket-frame overflow-hidden">
        <div className="flex flex-col divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-5 w-6 motion-safe:animate-pulse rounded-md bg-muted" />
              <div className="h-4 w-32 flex-1 motion-safe:animate-pulse rounded-md bg-muted" />
              <div className="h-4 w-20 motion-safe:animate-pulse rounded-md bg-muted" />
              <div className="h-4 w-10 motion-safe:animate-pulse rounded-md bg-muted" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading the Ladder…</span>
    </div>
  );
}
