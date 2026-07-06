import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Video, Trophy, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

// A real, ordered sequence — so the numbered markers below carry information.
const STEPS = [
  {
    n: "01",
    title: "Queue",
    body: "Hit “Find a race.” We match you with an opponent close to your rating, usually within seconds.",
  },
  {
    n: "02",
    title: "Race",
    body: "Camera and mic switch on. Same Codeforces problem, same 40-minute clock, side-by-side editors.",
  },
  {
    n: "03",
    title: "Judge",
    body: "Submit whenever you're ready — verdicts come straight from Codeforces, never self-reported.",
  },
  {
    n: "04",
    title: "Climb",
    body: "First accepted verdict wins the race. Elo updates for both racers the moment it's over.",
  },
];

const FEATURES = [
  {
    icon: Video,
    title: "Voice and video, built in",
    body: "A live call runs alongside the editor for the whole race — trash talk included.",
  },
  {
    icon: Trophy,
    title: "A real Elo ladder",
    body: "Provisional K-factor for your first ten races, standard after that. Ratings that mean something.",
  },
  {
    icon: ShieldCheck,
    title: "Codeforces-verified verdicts",
    body: "No manual grading. We poll your submission and trust whatever Codeforces says back.",
  },
];

export default async function Home() {
  const { userId } = await auth();
  const primaryHref = userId ? "/queue" : "/sign-up";

  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Ambient arena glow — the two identity colors bleed in from the edges. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
        >
          <div className="absolute -top-32 -left-24 size-[32rem] rounded-full bg-player-self/10 blur-3xl" />
          <div className="absolute -right-24 -bottom-24 size-[32rem] rounded-full bg-player-opponent/10 blur-3xl" />
        </div>

        <div className="shell grid gap-12 py-16 md:grid-cols-[1.05fr_1fr] md:items-center md:py-24">
          <div>
            <p className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
              <span className="size-1.5 rounded-full bg-player-self motion-safe:animate-pulse" />
              Head-to-head competitive programming
            </p>
            <h1 className="mt-5 font-display text-5xl leading-[0.98] font-semibold tracking-tight sm:text-6xl md:text-7xl">
              Same problem.
              <br />
              Same clock.
              <br />
              <span className="text-player-self">One winner.</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground md:text-lg">
              cph2h drops you and one opponent into a live Codeforces problem
              with your cameras on. First correct verdict takes the race
              &mdash; and the Elo.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button render={<Link href={primaryHref} />} nativeButton={false}>
                Find a race
              </Button>
              <Button
                render={<Link href="/challenge/new" />}
                nativeButton={false}
                variant="outline"
              >
                Challenge a friend
              </Button>
            </div>

            <p className="mt-6 font-mono text-[11px] tracking-wide text-muted-foreground">
              40-minute clock &middot; matched by rating &middot; ranked Elo
            </p>
          </div>

          <ScoreboardMockup />
        </div>
      </section>

      {/* How it works */}
      <section className="shell border-t border-border py-16 md:py-24">
        <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          How a race plays out
        </h2>
        <ol className="mt-10 grid gap-8 md:grid-cols-4 md:gap-6">
          {STEPS.map((step) => (
            <li key={step.n} className="border-l-2 border-player-self/40 pl-4">
              <p className="font-display text-sm font-semibold tracking-widest text-player-self tabular-nums">
                {step.n}
              </p>
              <p className="mt-1 font-display text-lg font-semibold">
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
              <h3 className="mt-3 font-display text-base font-semibold">
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
      <footer className="shell flex flex-col gap-2 border-t border-border py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="font-display">
          <span className="text-player-self">&gt;</span> cph2h
        </p>
        <p>Built for people who&apos;d rather race than grind alone.</p>
      </footer>
    </main>
  );
}

/**
 * Reference implementation of the broadcast scoreboard: a chamfered HUD plate
 * with a live ticker, two clashing player columns, a center VS badge, and the
 * big display clock. Colors come entirely from the identity + verdict tokens.
 */
function ScoreboardMockup() {
  return (
    <div aria-hidden className="panel clip-notch overflow-hidden">
      {/* Top ticker: problem + live state */}
      <div className="ticker justify-between px-4 py-2.5">
        <span>race &middot; 1794C</span>
        <span className="flex items-center gap-1.5 text-verdict-pending">
          <span className="size-1.5 rounded-full bg-verdict-pending motion-safe:animate-pulse" />
          live
        </span>
      </div>

      <div className="relative grid grid-cols-2 divide-x divide-border">
        {/* Center VS badge */}
        <div className="pointer-events-none absolute top-4 left-1/2 z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background font-display text-[11px] font-bold tracking-tight text-foreground">
          VS
        </div>

        {/* Self */}
        <div className="p-4 pt-14">
          <div className="flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-player-self font-display text-xs font-bold text-player-self-foreground">
              Q
            </span>
            <div>
              <p className="font-mono text-xs font-medium">quinn_dev</p>
              <p className="font-display text-[13px] font-semibold text-player-self tabular-nums">
                1540
              </p>
            </div>
          </div>
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">
            2/2 samples{" "}
            <span className="font-semibold text-verdict-ok">AC</span>
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-full rounded-full bg-verdict-ok" />
          </div>
        </div>

        {/* Opponent */}
        <div className="p-4 pt-14">
          <div className="flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-player-opponent font-display text-xs font-bold text-player-opponent-foreground">
              K
            </span>
            <div>
              <p className="font-mono text-xs font-medium">kade.exe</p>
              <p className="font-display text-[13px] font-semibold text-player-opponent tabular-nums">
                1565
              </p>
            </div>
          </div>
          <p className="mt-4 font-mono text-[11px] text-verdict-pending">
            running&hellip;
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 rounded-full bg-player-opponent" />
          </div>
        </div>
      </div>

      {/* Bottom ticker: format + clock */}
      <div className="ticker justify-between px-4 py-2.5">
        <span>1v1 &middot; rated</span>
        <span className="font-display text-lg font-semibold tracking-tight text-foreground tabular-nums">
          18:42
        </span>
      </div>
    </div>
  );
}
