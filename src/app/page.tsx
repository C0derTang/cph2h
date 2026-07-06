import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Video, Trophy, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    body: "First accepted verdict takes the round. Elo moves for both of you the moment it's over.",
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

export default async function Home() {
  const { userId } = await auth();
  const primaryHref = userId ? "/queue" : "/sign-up";

  return (
    <main className="flex-1">
      {/* Hero — the battle poster */}
      <section className="relative overflow-hidden">
        {/* Overhead spotlight: a warm gold pool falling into the stage dark. */}
        <div
          aria-hidden
          className="spotlight pointer-events-none absolute inset-0 -z-10"
        />

        <div className="shell grid gap-12 py-16 md:grid-cols-[1.05fr_1fr] md:items-center md:py-24">
          <div>
            <p className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              <span className="size-2 rounded-full bg-player-self motion-safe:animate-pulse" />
              1v1 competitive programming, out loud
            </p>
            <h1 className="mt-5 font-display text-6xl leading-[0.9] tracking-tight uppercase sm:text-7xl md:text-8xl">
              Same problem.
              <br />
              Same clock.
              <br />
              <span className="text-player-self">Catch these bars.</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground md:text-lg">
              cph2h drops you and one opponent into a live Codeforces problem
              with your cameras on. First correct verdict takes the race — and
              the Elo. Shittalk your way to a higher rating.
            </p>

            <div className="mt-8">
              <Button
                render={<Link href={primaryHref} />}
                nativeButton={false}
                size="lg"
              >
                Find a race
              </Button>
            </div>

            <p className="mt-6 font-mono text-[11px] tracking-wide text-muted-foreground">
              40-minute clock · matched by rating · ranked Elo
            </p>
          </div>

          <VersusPoster />
        </div>
      </section>

      {/* How it works */}
      <section className="shell border-t border-border py-16 md:py-24">
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

      {/* Features */}
      <section className="shell border-t border-border py-16 md:py-24">
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="panel p-5">
              <feature.icon
                className="size-5 text-player-self"
                aria-hidden
                strokeWidth={1.75}
              />
              <h3 className="mt-3 font-display text-lg tracking-tight uppercase">
                {feature.title}
              </h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                {feature.body}
              </p>
            </div>
          ))}
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
        <p>Built for people who&apos;d rather battle than grind alone.</p>
      </footer>
    </main>
  );
}

/**
 * Reference implementation of the VS poster lockup: a matte stage panel with a
 * lower-third ticker, two corners (champion gold vs challenger crimson) split by
 * a thin gold rule, tall-caps names, and a live clock. Every color comes from
 * the identity + verdict tokens; the live rating/clock are `font-mono
 * tabular-nums` per the numeral rule (Anton digits aren't tabular).
 */
function VersusPoster() {
  return (
    <div aria-hidden className="panel overflow-hidden">
      {/* Top lower-third: problem + live state */}
      <div className="ticker justify-between px-4 py-2.5">
        <span>race · 1794C</span>
        <span className="flex items-center gap-1.5 text-verdict-pending">
          <span className="size-1.5 rounded-full bg-verdict-pending motion-safe:animate-pulse" />
          live
        </span>
      </div>

      <div className="relative grid grid-cols-2">
        {/* Center VS + the thin gold rule between the two corners */}
        <div
          aria-hidden
          className="absolute inset-y-6 left-1/2 w-px -translate-x-1/2 bg-player-self/40"
        />
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-player-self/50 bg-background font-display text-sm tracking-wide text-player-self">
          VS
        </div>

        {/* Champion (self) */}
        <div className="p-4 pr-7">
          <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-player-self uppercase">
            Champion
          </p>
          <p className="mt-2 font-display text-2xl tracking-tight text-foreground uppercase">
            quinn
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
          <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-player-opponent uppercase">
            Challenger
          </p>
          <p className="mt-2 font-display text-2xl tracking-tight text-foreground uppercase">
            kade
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
