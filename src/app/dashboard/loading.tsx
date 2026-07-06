/** Dashboard skeleton (issue #19) — mirrors the stat-plate/panel layout. */
export default function DashboardLoading() {
  return (
    <div className="shell py-8" aria-busy="true" aria-live="polite">
      <div className="mb-8 h-9 w-40 animate-pulse rounded-md bg-muted" />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="stat-plate px-3 py-2">
            <div className="h-2.5 w-12 animate-pulse rounded-md bg-muted" />
            <div className="mt-2 h-6 w-16 animate-pulse rounded-md bg-muted" />
          </div>
        ))}
      </div>

      <div className="panel mb-8 p-5">
        <div className="h-2.5 w-20 animate-pulse rounded-md bg-muted" />
        <div className="mt-3 h-16 w-full animate-pulse rounded-md bg-muted" />
      </div>

      <div className="mb-3 h-2.5 w-24 animate-pulse rounded-md bg-muted" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="panel h-14 w-full animate-pulse px-4 py-3" />
        ))}
      </div>
      <span className="sr-only">Loading your dashboard…</span>
    </div>
  );
}
