import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CircleCheck, Mail, MessageCircle, UserPlus } from "lucide-react";
import { eq } from "drizzle-orm";
import { HeroWord } from "@/components/hud/hero-word";
import { SlabButton } from "@/components/menu/slab-button";
import { Stat } from "@/components/ui/stat";
import { db } from "@/lib/db";
import { tournamentRegistrations } from "@/lib/db/schema";
import { ensureUser } from "@/lib/user";

export const metadata: Metadata = {
  title: "tournament — cph2h",
  description:
    "The CPH2H Launch Tournament: a single-elimination Codeforces bracket — limited spots available. Format, rules, and how to sponsor.",
};

// "At a glance" facts — the format in five numbers. Kept as plain data so the
// grid below stays a pure render, matching the landing page's STEPS pattern.
const FACTS = [
  {
    label: "Format",
    value: "Limited spots",
    hint: "single-elimination bracket",
  },
  {
    label: "Timing",
    value: "Aug 2",
    hint: "2026 · runs ~1 week",
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
    label: "Prize pool",
    value: "$500",
    hint: "$400 first · $100 second",
  },
] as const;

type ViewState = "signed_out" | "cf_not_linked" | "not_registered" | "registered";

export default async function TournamentPage() {
  // Provisions the `users` row on first authenticated access (issue #48).
  const user = await ensureUser();

  let viewState: ViewState;

  if (!user) {
    viewState = "signed_out";
  } else if (!user.cfLinkedAt) {
    viewState = "cf_not_linked";
  } else {
    const [row] = await db
      .select()
      .from(tournamentRegistrations)
      .where(eq(tournamentRegistrations.userId, user.id))
      .limit(1);
    viewState = row ? "registered" : "not_registered";
  }

  // Live per-visitor entry checklist for the "How to enter" section — mirrors
  // the RULES <ol> styling, but each step's done/todo state is derived from
  // the same user/viewState computed above (server-rendered, no client JS).
  const entrySteps: Array<{
    n: string;
    title: string;
    done: boolean;
    todo: React.ReactNode;
    doneNote?: string;
  }> = [
    {
      n: "01",
      title: "Create a CPH2H account",
      done: Boolean(user),
      todo: (
        <>
          <Link href="/sign-up" className="text-player-self hover:underline">
            Sign up
          </Link>{" "}
          for a free account.
        </>
      ),
    },
    {
      n: "02",
      title: "Link your Codeforces account",
      done: Boolean(user?.cfLinkedAt),
      todo: user ? (
        <>
          <Link
            href="/settings/cf"
            className="text-player-self hover:underline"
          >
            Link your handle
          </Link>{" "}
          in settings.
        </>
      ) : (
        "Link your handle in settings once you've signed up."
      ),
    },
    {
      n: "03",
      title: "Register below",
      done: viewState === "registered",
      doneNote: "You're in.",
      todo: (
        <>
          <Link href="/tournament/register" className="text-player-self hover:underline">
            Register
          </Link>{" "}
          for the bracket.
        </>
      ),
    },
  ];

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

        <div className="shell flex flex-col items-center pt-24 pb-16 text-center md:pt-32 md:pb-20">
          <p className="inline-flex items-center gap-2 eyebrow text-muted-foreground">
            <span className="size-2 rounded-full bg-player-self motion-safe:animate-pulse" />
            The first cph2h bracket
          </p>

          {/* The ONE hero word for this screen, pushed to a background
              watermark (sign-in card pattern) so it sits behind the copy
              instead of competing with it. Decorative + aria-hidden; the
              sr-only h1 carries the real heading for assistive tech. */}
          <h1 className="sr-only">CPH2H Launch Tournament</h1>
          <HeroWord
            word="tournament"
            tone="muted"
            className="pointer-events-none absolute top-8 left-1/2 -z-10 -translate-x-1/2 whitespace-nowrap opacity-25"
          />

          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
            Limited spots available — one single-elimination bracket. Cameras on, one
            Codeforces problem per round, first correct verdict advances.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {viewState === "signed_out" ? (
              <SlabButton
                tone="self"
                size="lg"
                render={<Link href="/sign-up" />}
                nativeButton={false}
              >
                <UserPlus className="size-5" aria-hidden />
                Sign up to compete
              </SlabButton>
            ) : (
              <SlabButton
                tone="self"
                size="lg"
                render={<Link href="/tournament/register" />}
                nativeButton={false}
              >
                <UserPlus className="size-5" aria-hidden />
                Register to compete
              </SlabButton>
            )}
            <SlabButton
              tone="neutral"
              size="lg"
              render={<a href="https://discord.gg/ENQ4Bq93gJ" target="_blank" rel="noopener noreferrer" />}
              nativeButton={false}
            >
              <MessageCircle className="size-5" aria-hidden />
              Join the Discord
            </SlabButton>
          </div>
        </div>
      </section>

      {/* Sponsors — fr8.so is the sole, signed launch sponsor (no open slots
          to fill), so this is one featured card plus the contact pitch. */}
      <section className="relative shell border-t border-border py-12 md:py-20">
        {/* hud-meta scatter point 3/3: sponsor status ornament. */}
        <span
          aria-hidden
          className="hud-meta absolute top-5 right-6 md:right-8"
        >
          {"// sponsor :: fr8.so"}
        </span>
        <p className="eyebrow text-muted-foreground">Sponsors</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight uppercase md:text-4xl">
          Backing the launch
        </h2>

        <a
          href="https://fr8.so"
          target="_blank"
          rel="noopener noreferrer"
          className="group panel mt-8 flex flex-col items-center gap-3 p-8 text-center transition-colors hover:border-player-self/40"
        >
          <Image
            src="/fr8-logo.jpg"
            alt="FR8 logo"
            width={200}
            height={200}
            className="size-20 rounded-lg"
          />
          <p className="eyebrow text-muted-foreground">Presented by</p>
          <p className="font-display text-4xl tracking-tight text-foreground uppercase transition-colors group-hover:text-player-self md:text-5xl">
            FR8.SO
          </p>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            FR8 is a Helsinki-based three-month residency where young
            mavericks build the future — housing, funding, mentorship, and a
            global network for founders working on frontier tech.
          </p>
        </a>

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

      {/* How to enter — a live per-visitor checklist plus the eligibility
          requirements, so the entry path is instantly digestible. */}
      <section className="shell-narrow border-t border-border py-12 md:py-20">
        <p className="eyebrow text-muted-foreground">How to enter</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight uppercase md:text-4xl">
          Get in the bracket
        </h2>

        <ol className="mt-8 flex flex-col gap-4">
          {entrySteps.map((step) => (
            <li
              key={step.n}
              className="flex gap-4 border-l-2 border-player-self/40 pl-4"
            >
              {step.done ? (
                <CircleCheck
                  className="size-5 shrink-0 text-player-self"
                  aria-hidden
                />
              ) : (
                <span className="font-display text-sm tracking-[0.2em] text-player-self tabular-nums">
                  {step.n}
                </span>
              )}
              <span className="text-sm leading-6 text-muted-foreground">
                <span className="font-medium text-foreground">
                  {step.title}
                </span>
                {step.done ? (
                  step.doneNote ? (
                    <> — {step.doneNote}</>
                  ) : null
                ) : (
                  <> — {step.todo}</>
                )}
              </span>
            </li>
          ))}
        </ol>

        <ul className="mt-8 flex flex-col gap-2.5 text-sm text-muted-foreground">
          <li className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="mt-2 size-1 shrink-0 rounded-full bg-player-self/70"
            />
            <span>
              Peak rating of 1900+ (Candidate Master) on your linked handle
              (verified when you register).
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="mt-2 size-1 shrink-0 rounded-full bg-player-self/70"
            />
            <span>Camera and mic on for every match.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="mt-2 size-1 shrink-0 rounded-full bg-player-self/70"
            />
            <span>
              Agree to the{" "}
              <Link
                href="/tournament/terms"
                className="text-player-self hover:underline"
              >
                tournament terms
              </Link>
              .
            </span>
          </li>
        </ul>
      </section>

      {/* At a glance — the format in five facts. */}
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

      {/* Register — sign up for the bracket. Placed last so it reads as the
          final call to action after the format/rules context above. */}
      <section id="register" className="shell border-t border-border py-12 md:py-20">
        <p className="eyebrow text-muted-foreground">Register</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight uppercase md:text-4xl">
          Sign up for the bracket
        </h2>

        <div className="mt-8">
          {viewState === "signed_out" && (
            <div className="flex flex-col gap-4">
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                Create a CPH2H account to register for the launch tournament.
              </p>
              <SlabButton
                tone="self"
                className="w-fit"
                render={<Link href="/sign-up" />}
                nativeButton={false}
              >
                <UserPlus className="size-5" aria-hidden />
                Sign up to compete
              </SlabButton>
              <p className="text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/sign-in" className="text-player-self hover:underline">
                  Sign in
                </Link>
                .
              </p>
            </div>
          )}

          {viewState === "cf_not_linked" && (
            <div className="flex flex-col gap-4">
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                You&apos;ll need to link a Codeforces account before you can
                register.
              </p>
              <SlabButton
                tone="self"
                className="w-fit"
                render={<Link href="/settings/cf" />}
                nativeButton={false}
              >
                Link Codeforces account
              </SlabButton>
            </div>
          )}

          {(viewState === "not_registered" || viewState === "registered") && (
            <div className="flex flex-col gap-4">
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                {viewState === "registered"
                  ? "You're registered for the launch tournament. Update your details anytime."
                  : "Entry requires a peak Codeforces rating of 1900+ (Candidate Master) on your linked handle. We check when you register."}
              </p>
              <SlabButton
                tone="self"
                className="w-fit"
                render={<Link href="/tournament/register" />}
                nativeButton={false}
              >
                <UserPlus className="size-5" aria-hidden />
                {viewState === "registered" ? "Manage registration" : "Register to compete"}
              </SlabButton>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
