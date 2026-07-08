import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import {
  LayoutGrid,
  LogIn,
  Swords,
  Trophy,
  UserPlus,
  Video,
  ShieldCheck,
} from "lucide-react";
import { HeroWord } from "@/components/hud/hero-word";
import { SlabButton } from "@/components/menu/slab-button";

// A real, ordered sequence — the numbered entries below carry information.
const STEPS = [
  {
    n: "01",
    title: "Step up",
    body: "Hit “Find a race.” We match you with someone close to your rating, usually in seconds.",
  },
  {
    n: "02",
    title: "Face off",
    body: "Cameras and mics on. Same Codeforces problem, same 40-minute clock, side by side.",
  },
  {
    n: "03",
    title: "Get judged",
    body: "Submit on Codeforces. Verdicts come straight from the judge — never self-reported.",
  },
  {
    n: "04",
    title: "Climb or cope",
    body: "First accepted verdict takes the round. Elo moves for both of you the moment it’s over.",
  },
];

const FEATURES = [
  {
    icon: Video,
    title: "Voice and video, built in",
    body: "A live call runs next to the editor the whole race. Catch these bars to their face, not a chat box.",
  },
  {
    icon: Trophy,
    title: "A real Elo ladder",
    body: "Provisional K-factor for your first ten races, standard after. A number that actually means something.",
  },
  {
    icon: ShieldCheck,
    title: "Codeforces-verified",
    body: "No manual grading, no honor system. We poll your submission and trust whatever the judge says back.",
  },
];

// Break the 3-up triptych: one lead feature gets the headline slot, the rest
// stack alongside it as a runner-up spec list.
const [LeadFeature, ...SupportingFeatures] = FEATURES;

export default async function Home() {
  const { userId } = await auth();

  return (
    <main className="flex-1">
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

          <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
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

      {/* How it works — tighter than the hero/features slabs either side, so
          the page doesn't read as three uniform sections stacked. */}
      <section className="relative shell border-t border-border py-12 md:py-20">
        {/* hud-meta scatter point 2/3: section index at the top-right edge. */}
        <span
          aria-hidden
          className="hud-meta absolute top-5 right-6 md:right-8"
        >
          sec&nbsp;02&nbsp;/&nbsp;04
        </span>
        <h2 className="font-display text-3xl tracking-tight uppercase md:text-4xl">
          How a race plays out
        </h2>
        <ol className="mt-10 grid gap-8 md:grid-cols-4 md:gap-6">
          {STEPS.map((step) => (
            <li key={step.n} className="border-l-2 border-player-self/40 pl-4">
              <p className="font-display text-sm tracking-[0.2em] text-player-self tabular-nums">
                {step.n}
              </p>
              <p className="mt-1 font-display text-xl tracking-tight uppercase">
                {step.title}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Features — one lead panel (the headline draw: live video) paired
          with two stacked runner-up panels, not a 3-up triptych. Icons sit
          inline with their heading rather than stacked above it. */}
      <section className="shell border-t border-border py-20 md:py-28">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="panel bracket-frame flex flex-col justify-center gap-3 p-6 md:p-8">
            <div className="flex items-center gap-3">
              <LeadFeature.icon
                className="size-6 shrink-0 text-player-self"
                aria-hidden
                strokeWidth={1.75}
              />
              <h3 className="font-display text-xl tracking-tight uppercase md:text-2xl">
                {LeadFeature.title}
              </h3>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted-foreground md:text-base">
              {LeadFeature.body}
            </p>
          </div>

          <div className="grid gap-4">
            {SupportingFeatures.map((feature) => (
              <div
                key={feature.title}
                className="panel flex items-start gap-3 p-5"
              >
                <feature.icon
                  className="mt-0.5 size-5 shrink-0 text-player-self"
                  aria-hidden
                  strokeWidth={1.75}
                />
                <div className="min-w-0">
                  <h3 className="font-display text-lg tracking-tight uppercase">
                    {feature.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {feature.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="shell flex flex-col gap-3 border-t border-border py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex flex-col items-start leading-none">
          <span className="font-display text-base tracking-wide text-foreground uppercase">
            cph2h
          </span>
          <span aria-hidden className="mt-1 h-0.5 w-full bg-player-self" />
        </span>
        <div className="flex flex-col gap-1.5 sm:items-end">
          <p>Built for people who&apos;d rather battle than grind alone.</p>
          {/* hud-meta scatter point 3/3: build tag in the footer corner. */}
          <span aria-hidden className="hud-meta">
            bld&nbsp;4.0&nbsp;·&nbsp;0708
          </span>
        </div>
      </footer>
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
