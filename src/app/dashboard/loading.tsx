/** Play hub skeleton (issue #19; reshaped for the hub layout in issue #89;
 * v4 glitch-HUD pass) — mirrors the hero-word + menu-slab stack on the left
 * and the identity plate / Elo trend / recent-races rail on the right, all as
 * matte hard-edged plates (radius token, no glass). */
export default function DashboardLoading() {
  return (
    <main
      className="shell grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:py-12"
      aria-busy="true"
      aria-live="polite"
    >
      {/* Menu column: hero-word slot, section label, four action slabs. */}
      <div>
        <div className="h-16 w-64 max-w-full motion-safe:animate-pulse rounded-md bg-muted md:h-24" />
        <div className="mt-4 h-3 w-24 motion-safe:animate-pulse rounded-md bg-muted" />
        <div className="mt-5 flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="panel h-[5.5rem] w-full motion-safe:animate-pulse sm:h-24"
            />
          ))}
        </div>
      </div>

      {/* Side rail: identity plate with the 2×2 stat grid, Elo panel, races. */}
      <aside className="flex flex-col gap-4">
        <div className="panel bracket-frame p-5">
          <div className="h-2.5 w-16 motion-safe:animate-pulse rounded-md bg-muted" />
          <div className="mt-2 h-7 w-36 motion-safe:animate-pulse rounded-md bg-muted" />
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="stat-plate p-3">
                <div className="h-2.5 w-12 motion-safe:animate-pulse rounded-md bg-muted" />
                <div className="mt-2 h-6 w-16 motion-safe:animate-pulse rounded-md bg-muted" />
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-5">
          <div className="h-2.5 w-20 motion-safe:animate-pulse rounded-md bg-muted" />
          <div className="mt-3 h-16 w-full motion-safe:animate-pulse rounded-md bg-muted" />
        </div>

        <div>
          <div className="mb-3 h-2.5 w-24 motion-safe:animate-pulse rounded-md bg-muted" />
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="panel h-14 w-full motion-safe:animate-pulse"
              />
            ))}
          </div>
        </div>
      </aside>
      <span className="sr-only">Loading the play hub…</span>
    </main>
  );
}
