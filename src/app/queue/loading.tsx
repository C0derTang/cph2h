/** Queue page skeleton (issue #19; retoned to the `panel` recipe in #89;
 * v4 glitch-HUD pass) — mirrors the ticker strip, the heading, and the
 * quick-match plate as matte hard-edged shapes (radius token, no glass). */
export default function QueueLoading() {
  return (
    <main
      className="shell-narrow flex flex-1 flex-col py-16 md:py-24"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="h-8 w-full motion-safe:animate-pulse rounded-[var(--radius)] bg-muted" />
      <div className="mt-6 h-8 w-56 motion-safe:animate-pulse rounded-md bg-muted md:h-9" />
      <div className="mt-3 h-4 w-full max-w-xl motion-safe:animate-pulse rounded-md bg-muted" />
      <div className="panel bracket-frame mt-10 p-5">
        <div className="h-6 w-48 motion-safe:animate-pulse rounded-md bg-muted" />
        <div className="mt-2 h-4 w-72 max-w-full motion-safe:animate-pulse rounded-md bg-muted" />
        <div className="mt-6 h-14 w-44 motion-safe:animate-pulse rounded-[var(--radius)] bg-muted" />
      </div>
      <span className="sr-only">Loading…</span>
    </main>
  );
}
