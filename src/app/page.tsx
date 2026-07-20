import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowRight, LayoutGrid, LogIn, Swords, UserPlus } from "lucide-react";
import { HeroWord } from "@/components/hud/hero-word";
import { SlabButton } from "@/components/menu/slab-button";
import {
  EloVignette,
  FaceOffVignette,
  QueueVignette,
  VerdictVignette,
} from "@/components/hud/race-vignettes";

// A real, ordered sequence — the numbered entries below carry information.
// Each step now SHOWS (its vignette) rather than tells; the caption is a
// one-line anchor so the page still reads completely without the visuals.
// The three retired feature blurbs (video, Elo, CF-verified) are absorbed
// into steps 02–04's vignettes instead of a separate features section.
const STEPS = [
  {
    n: "01",
    title: "Step up",
    caption: "Matched by rating in seconds.",
    Vignette: QueueVignette,
  },
  {
    n: "02",
    title: "Face off",
    caption: "Same problem, cameras on, 40 minutes.",
    Vignette: FaceOffVignette,
  },
  {
    n: "03",
    title: "Get judged",
    caption: "Verdicts straight from the Codeforces judge.",
    Vignette: VerdictVignette,
  },
  {
    n: "04",
    title: "Climb or cope",
    caption: "First AC takes the round — and the Elo.",
    Vignette: EloVignette,
  },
];

export default async function Home() {
  const { userId } = await auth();

  return (
    <main className="flex-1">
      {/* Tournament banner — a slim, full-viewport-width strip, the first
          thing inside <main>, announcing the Launch Tournament (issue #201).
          The whole strip is one Link so the announcement doubles as the CTA.
          Built on the `ticker` HUD-strip recipe (mono, uppercase,
          wide-tracked, self-yellow top rule) rather than a new banner
          treatment; the mid-line facts drop on small screens, keeping just
          the title + CTA. */}
      <Link
        href="/tournament"
        className="group ticker w-full justify-center gap-2 px-4 py-2 text-center transition-colors hover:text-player-self sm:gap-3 sm:px-6"
      >
        <span className="font-semibold text-foreground transition-colors group-hover:text-player-self">
          The Launch Tournament
        </span>
        <span className="hidden text-muted-foreground sm:inline">
          64 players · $500 prize pool · Aug 2
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-player-self">
          Details
          <ArrowRight
            aria-hidden
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </Link>

      {/* Hero — the battle poster */}
      <section className="relative overflow-hidden">
        {/* Overhead spotlight: the ambient self/opponent identity pools over the glitch ground. */}
        <div
          aria-hidden
          className="spotlight pointer-events-none absolute inset-0 -z-10"
        />

        {/* hud-meta scatter point 1/3: route marker at the hero's top edge. */}
        <span
          aria-hidden
          className="hud-meta absolute top-5 right-6 md:right-8"
        >
          {"// route :: /"}
        </span>

        <div className="shell flex flex-col items-center py-16 text-center md:py-20">
          <p className="inline-flex items-center gap-2 eyebrow text-muted-foreground">
            <span className="size-2 rounded-full bg-player-self motion-safe:animate-pulse" />
            1v1 competitive programming, out loud
          </p>

          {/* The neon graffiti wordmark IS the hero — the ONE hero word for
              this screen. It stays decorative (aria-hidden); the sr-only h1
              carries the name for assistive tech, so the page reads
              completely without it. */}
          <h1 className="sr-only">cph2h</h1>
          <HeroWord word="cph2h" className="mt-2 block" />

          {/* mt-24 clears the graffiti "p" descender, which paints ~0.75em
              below the word's 0.9 line box at hero scale. */}
          <p className="mt-24 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
            cph2h drops you and one opponent into a live Codeforces problem
            with your cameras on. First correct verdict takes the race — and
            the Elo. Shittalk your way to a higher rating.
          </p>

          {/* Entry actions — everything is one click from here. */}
          <div className="mt-8 flex w-full max-w-md flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row sm:items-stretch sm:justify-center">
            {userId ? (
              <>
                <SlabButton
                  tone="self"
                  size="lg"
                  render={<Link href="/queue" />}
                  nativeButton={false}
                >
                  <Swords className="size-5" aria-hidden />
                  Find a race
                </SlabButton>
                <SlabButton
                  tone="neutral"
                  size="lg"
                  render={<Link href="/challenge/new" />}
                  nativeButton={false}
                >
                  <UserPlus className="size-5" aria-hidden />
                  Challenge a friend
                </SlabButton>
                <SlabButton
                  tone="neutral"
                  size="lg"
                  render={<Link href="/dashboard" />}
                  nativeButton={false}
                >
                  <LayoutGrid className="size-5" aria-hidden />
                  Main menu
                </SlabButton>
              </>
            ) : (
              <>
                <SlabButton
                  tone="self"
                  size="lg"
                  render={<Link href="/sign-up" />}
                  nativeButton={false}
                >
                  <UserPlus className="size-5" aria-hidden />
                  Sign up
                </SlabButton>
                <SlabButton
                  tone="neutral"
                  size="lg"
                  render={<Link href="/sign-in" />}
                  nativeButton={false}
                >
                  <LogIn className="size-5" aria-hidden />
                  Sign in
                </SlabButton>
              </>
            )}
          </div>

          <p className="mt-6 font-mono text-[11px] tracking-wide text-muted-foreground">
            40-minute clock · matched by rating · ranked Elo
          </p>

          <div className="mt-12 w-full max-w-xl">
            <VersusPoster />
          </div>
        </div>
      </section>

      {/* How it works — tighter than the hero/footer slabs either side, so
          the page doesn't read as three uniform sections stacked. */}
      <section className="relative shell border-t border-border py-12 md:py-20">
        {/* hud-meta scatter point 2/3: section index at the top-right edge. */}
        <span
          aria-hidden
          className="hud-meta absolute top-5 right-6 md:right-8"
        >
          sec&nbsp;02&nbsp;/&nbsp;03
        </span>
        <h2 className="font-display text-3xl tracking-tight uppercase md:text-4xl">
          How a race plays out
        </h2>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((step) => (
            <li key={step.n} className="border-l-2 border-player-self/40 pl-4">
              <p className="font-display text-sm tracking-[0.2em] text-player-self tabular-nums">
                {step.n}
              </p>
              <p className="mt-1 font-display text-xl tracking-tight uppercase">
                {step.title}
              </p>
              <div className="mt-3">
                <step.Vignette />
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {step.caption}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Footer (hud-meta scatter point 3/3) now renders site-wide from the
          root layout — see src/components/footer.tsx. */}
    </main>
  );
}

/**
 * Reference implementation of the VS poster lockup: a matte HUD plate with
 * corner brackets (the hero's companion plate), a lower-third ticker, two
 * corners (self yellow vs opponent crimson) split by a thin yellow rule,
 * tall-caps names, and a live clock. Every color comes from the identity +
 * verdict tokens; the live rating/clock are `font-mono tabular-nums` per the
 * numeral rule (the display face's digits aren't tabular).
 */
function VersusPoster() {
  return (
    <div aria-hidden className="panel bracket-frame overflow-hidden">
      {/* Top lower-third: problem + live state */}
      <div className="ticker justify-between px-4 py-2.5">
        <span>race · 1794C</span>
        <span className="flex items-center gap-1.5 text-verdict-pending">
          <span className="size-1.5 rounded-full bg-verdict-pending motion-safe:animate-pulse" />
          live
        </span>
      </div>

      <div className="relative grid grid-cols-2">
        {/* Center VS + the thin yellow rule between the two corners */}
        <div
          aria-hidden
          className="absolute inset-y-6 left-1/2 w-px -translate-x-1/2 bg-player-self/40"
        />
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-player-self/50 bg-background font-display text-sm tracking-wide text-player-self">
          VS
        </div>

        {/* Champion (self) */}
        <div className="p-4 pr-7">
          <p className="eyebrow text-player-self">
            Champion
          </p>
          <p className="mt-2 font-display text-2xl tracking-tight text-foreground uppercase">
            chris
          </p>
          <p className="font-mono text-[13px] font-semibold text-player-self tabular-nums">
            1540
          </p>
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            2/2 samples{" "}
            <span className="font-semibold text-verdict-ok">AC</span>
          </p>
        </div>

        {/* Challenger (opponent) */}
        <div className="p-4 pl-7 text-right">
          <p className="eyebrow text-player-opponent">
            Challenger
          </p>
          <p className="mt-2 font-display text-2xl tracking-tight text-foreground uppercase">
            jeff
          </p>
          <p className="font-mono text-[13px] font-semibold text-player-opponent tabular-nums">
            1565
          </p>
          <p className="mt-3 font-mono text-[11px] text-verdict-pending">
            running…
          </p>
        </div>
      </div>

      {/* Bottom lower-third: format + clock */}
      <div className="ticker justify-between px-4 py-2.5">
        <span>1v1 · rated</span>
        <span className="font-mono text-base font-semibold tracking-tight text-foreground tabular-nums">
          18:42
        </span>
      </div>
    </div>
  );
}
