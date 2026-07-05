import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Video, Trophy, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

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
      <section className="shell grid gap-12 py-16 md:grid-cols-[1.1fr_1fr] md:items-center md:py-28">
        <div>
          <p className="font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">
            Head-to-head competitive programming
          </p>
          <h1 className="mt-4 font-heading text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl md:text-6xl">
            Same problem.
            <br />
            Same clock.
            <br />
            <span className="text-primary">One winner.</span>
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

          <p className="mt-6 font-mono text-[11px] text-muted-foreground">
            40-minute clock &middot; matched by rating &middot; ranked Elo
          </p>
        </div>

        <RaceCardMockup />
      </section>

      {/* How it works */}
      <section className="shell border-t border-border/60 py-16 md:py-24">
        <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
          How a race plays out
        </h2>
        <ol className="mt-10 grid gap-8 md:grid-cols-4 md:gap-6">
          {STEPS.map((step) => (
            <li key={step.n} className="border-l-2 border-primary/40 pl-4">
              <p className="font-mono text-sm font-semibold text-primary">
                {step.n}
              </p>
              <p className="mt-1 font-heading text-base font-semibold">
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
      <section className="shell border-t border-border/60 py-16 md:py-24">
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title}>
              <CardHeader>
                <feature.icon
                  className="size-5 text-primary"
                  aria-hidden
                  strokeWidth={1.75}
                />
                <CardTitle className="mt-3 text-base">
                  {feature.title}
                </CardTitle>
                <CardDescription className="text-sm leading-6">
                  {feature.body}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="shell flex flex-col gap-2 border-t border-border/60 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="font-heading">
          <span className="text-primary">&gt;</span> cph2h
        </p>
        <p>Built for people who&apos;d rather race than grind alone.</p>
      </footer>
    </main>
  );
}

function RaceCardMockup() {
  return (
    <div
      aria-hidden
      className="relative overflow-hidden rounded-xl border border-border bg-card shadow-[0_0_0_1px_rgba(0,0,0,0.02)]"
    >
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">
          race &middot; 1794C
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] font-medium text-primary">
          <span className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
          live
        </span>
      </div>

      <div className="relative grid grid-cols-2 divide-x divide-border/70">
        <div className="pointer-events-none absolute top-3.5 left-1/2 z-10 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background font-mono text-[10px] font-bold text-primary">
          VS
        </div>

        <div className="p-4 pt-12">
          <div className="flex items-center gap-2">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ backgroundColor: "#17b4c4" }}
            >
              Q
            </span>
            <div>
              <p className="font-mono text-xs font-medium">quinn_dev</p>
              <p className="font-mono text-[11px]" style={{ color: "#17b4c4" }}>
                1540
              </p>
            </div>
          </div>
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">
            2/2 samples <span className="text-emerald-500">AC</span>
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
            <div className="h-full w-full rounded-full bg-emerald-500" />
          </div>
        </div>

        <div className="p-4 pt-12">
          <div className="flex items-center gap-2">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ backgroundColor: "#17b4c4" }}
            >
              K
            </span>
            <div>
              <p className="font-mono text-xs font-medium">kade.exe</p>
              <p className="font-mono text-[11px]" style={{ color: "#17b4c4" }}>
                1565
              </p>
            </div>
          </div>
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">
            running&hellip;
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
            <div className="h-full w-1/3 rounded-full bg-primary" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/70 bg-muted/30 px-4 py-2.5">
        <span className="font-mono text-[11px] text-muted-foreground">
          1v1 &middot; rated
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums">
          18:42
        </span>
      </div>
    </div>
  );
}
