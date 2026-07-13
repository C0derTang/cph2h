import type { Metadata } from "next";
import Link from "next/link";
import { Mail, UserPlus } from "lucide-react";
import { HeroWord } from "@/components/hud/hero-word";
import { SlabButton } from "@/components/menu/slab-button";
import { Stat } from "@/components/ui/stat";

export const metadata: Metadata = {
  title: "tournament — cph2h",
  description:
    "The CPH2H Launch Tournament: a 64-player single-elimination Codeforces bracket. Format, rules, and how to sponsor.",
};

// "At a glance" facts — the format in six numbers. Kept as plain data so the
// grid below stays a pure render, matching the landing page's STEPS pattern.
const FACTS = [
  {
    label: "Format",
    value: "64-player",
    hint: "single-elimination bracket",
  },
  {
    label: "Timing",
    value: "Late Jul / early Aug",
    hint: "2026 · date TBD · ~1 week",
  },
  {
    label: "Match",
    value: "1 problem",
    hint: "40 min · difficulty scales by round",
  },
  {
    label: "Match window",
    value: "24 hours",
    hint: "per pairing, to coordinate + play",
  },
  {
    label: "Seeding",
    value: "CF Elo",
    hint: "bracket placement by rating",
  },
  {
    label: "Prize pool",
    value: "$500",
    hint: "$400 first · $100 second",
  },
] as const;

// The binding rules — a real, ordered list (reuses the landing page's
// STEPS-style numbered-array-to-<ol> pattern, without the vignettes).
const RULES = [
  { n: "01", text: "All matches are played on CPH2H." },
  {
    n: "02",
    text: "One 40-minute problem per match; difficulty scales by round.",
  },
  {
    n: "03",
    text: "Pairings get a 24-hour window to schedule and complete their match.",
  },
  { n: "04", text: "Competitors self-report the winner after the match." },
  { n: "05", text: "Seeding is by Codeforces Elo." },
] as const;

// How a competitor actually moves through the bracket, register to final.
const PROCESS = [
  {
    n: "01",
    title: "Register",
    caption: "Sign up for CPH2H before the bracket locks.",
  },
  {
    n: "02",
    title: "Get seeded",
    caption: "Bracket placement is set by Codeforces Elo.",
  },
  {
    n: "03",
    title: "Coordinate",
    caption: "Arrange a time with your opponent inside the 24h window.",
  },
  {
    n: "04",
    title: "Race",
    caption: "Play the round's problem head-to-head on CPH2H.",
  },
  {
    n: "05",
    title: "Report",
    caption: "Self-report the result once the match finishes.",
  },
  {
    n: "06",
    title: "Advance",
    caption: "Winners move on until the final.",
  },
] as const;

const SPONSOR_SLOT_COUNT = 4;

export default function TournamentPage() {
  return (
    <main className="flex-1">
      {/* Hero — same battle-poster treatment as the landing page's hero. */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="spotlight pointer-events-none absolute inset-0 -z-10"
        />

        {/* hud-meta scatter point 1/3: route marker at the hero's top edge. */}
        <span
          aria-hidden
          className="hud-meta absolute top-5 right-6 md:right-8"
        >
          {"// route :: /tournament"}
        </span>

        <div className="shell flex flex-col items-center py-16 text-center md:py-20">
          <p className="inline-flex items-center gap-2 eyebrow text-muted-foreground">
            <span className="size-2 rounded-full bg-player-self motion-safe:animate-pulse" />
            The first cph2h bracket
          </p>

          {/* The ONE hero word for this screen. Decorative + aria-hidden; the
              sr-only h1 carries the real heading for assistive tech. */}
          <h1 className="sr-only">CPH2H Launch Tournament</h1>
          <HeroWord word="tournament" className="mt-2 block" />

          <p className="mt-24 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
            64 competitors, one single-elimination bracket. Cameras on, one
            Codeforces problem per round, first correct verdict advances.
          </p>

          <div className="mt-8">
            <SlabButton
              tone="self"
              size="lg"
              render={<Link href="/sign-up" />}
              nativeButton={false}
            >
              <UserPlus className="size-5" aria-hidden />
              Sign up to compete
            </SlabButton>
          </div>
        </div>
      </section>

      {/* At a glance — the format in six facts. */}
      <section className="shell border-t border-border py-12 md:py-20">
        <p className="eyebrow text-muted-foreground">At a glance</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight uppercase md:text-4xl">
          The format
        </h2>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FACTS.map((fact) => (
            <Stat
              key={fact.label}
              label={fact.label}
              value={fact.value}
              hint={fact.hint}
              className="p-4"
              valueClassName="text-xl"
            />
          ))}
        </div>
      </section>

      {/* Rules — what decides a match. */}
      <section className="relative shell-narrow border-t border-border py-12 md:py-20">
        {/* hud-meta scatter point 2/3: section index at the top-right edge. */}
        <span
          aria-hidden
          className="hud-meta absolute top-5 right-6 md:right-8"
        >
          sec&nbsp;02&nbsp;/&nbsp;04
        </span>
        <p className="eyebrow text-muted-foreground">Rules</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight uppercase md:text-4xl">
          How matches are decided
        </h2>
        <ol className="mt-8 flex flex-col gap-4">
          {RULES.map((rule) => (
            <li
              key={rule.n}
              className="flex gap-4 border-l-2 border-player-self/40 pl-4"
            >
              <span className="font-display text-sm tracking-[0.2em] text-player-self tabular-nums">
                {rule.n}
              </span>
              <span className="text-sm leading-6 text-muted-foreground">
                {rule.text}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* Process — register through the final. */}
      <section className="shell border-t border-border py-12 md:py-20">
        <p className="eyebrow text-muted-foreground">Process</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight uppercase md:text-4xl">
          How it works
        </h2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {PROCESS.map((step) => (
            <li key={step.n} className="border-l-2 border-player-self/40 pl-4">
              <p className="font-display text-sm tracking-[0.2em] text-player-self tabular-nums">
                {step.n}
              </p>
              <p className="mt-1 font-display text-lg tracking-tight uppercase">
                {step.title}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {step.caption}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Sponsors — no signed sponsors yet, so placeholder slots + contact. */}
      <section className="relative shell border-t border-border py-12 md:py-20">
        {/* hud-meta scatter point 3/3: sponsor status ornament. */}
        <span
          aria-hidden
          className="hud-meta absolute top-5 right-6 md:right-8"
        >
          {"// sponsor :: tbd"}
        </span>
        <p className="eyebrow text-muted-foreground">Sponsors</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight uppercase md:text-4xl">
          Backing the launch
        </h2>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: SPONSOR_SLOT_COUNT }).map((_, i) => (
            <div
              key={i}
              className="panel flex h-24 items-center justify-center border-dashed"
            >
              <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                sponsor slot — coming soon
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 max-w-2xl">
          <p className="text-sm leading-6 text-muted-foreground">
            Interested in sponsoring the launch tournament? Sponsors get logo
            placement on the tournament site and materials, access to an
            opt-in list of participants who choose to share their contact
            info and resume, founding-launch-sponsor recognition, and
            visibility with competitive programmers and university students.
          </p>
          <a
            href="mailto:tangsc@stanford.edu"
            className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] text-player-self hover:underline"
          >
            <Mail className="size-3.5" aria-hidden />
            tangsc@stanford.edu
          </a>
        </div>
      </section>
    </main>
  );
}
