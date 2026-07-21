import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "tournament terms — cph2h",
  description: "Terms and eligibility for the CPH2H Launch Tournament.",
};

// Draft placeholder terms (issue #209) — organizer-authored copy pending
// legal review; may be updated before the bracket locks (see closing note).
const SECTIONS = [
  {
    title: "Eligibility",
    body: "Open to anyone who can sign up for CPH2H and link a Codeforces account. Your linked handle must have participated in at least 3 rated Codeforces contests. There is no minimum or maximum rating requirement.",
  },
  {
    title: "Account requirements",
    body: "You must have a CPH2H account with a linked Codeforces handle to register.",
  },
  {
    title: "Fair play",
    body: "No cheating: no alternate accounts, no assistance from other people, no use of solutions found online for the round's problem. All submitted code must be your own work. Your camera and microphone must be on for the duration of every match. Self-reported results are expected to be honest — organizers may audit submissions.",
  },
  {
    title: "Schedule and format",
    body: "The bracket size, round format, timing, and problem difficulty are subject to change at organizer discretion as the tournament is finalized.",
  },
  {
    title: "Sponsor visibility",
    body: "If you provide a GitHub and/or LinkedIn URL during registration, it is shared only with tournament sponsors — never published publicly. Leaving these fields blank has no effect on eligibility.",
  },
  {
    title: "Prizes",
    body: "The prize pool is $500: $400 for first place, $100 for second place. Prize payout details will be confirmed with finalists directly.",
  },
  {
    title: "Disputes and disqualification",
    body: "Organizers have final discretion to resolve disputes, including disqualifying a competitor for violating fair play rules or these terms.",
  },
  {
    title: "Contact",
    body: "Questions about these terms or the tournament: tangsc@stanford.edu.",
  },
] as const;

export default function TournamentTermsPage() {
  return (
    <main className="shell-narrow flex-1 py-16 md:py-24">
      <Link
        href="/tournament"
        className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to tournament
      </Link>

      <p className="mt-8 eyebrow text-muted-foreground">Terms</p>
      <h1 className="mt-2 font-display text-3xl tracking-tight uppercase md:text-4xl">
        Tournament terms
      </h1>

      <div className="mt-8 flex flex-col gap-6">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="font-display text-sm tracking-[0.14em] uppercase">
              {section.title}
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              {section.body}
            </p>
          </section>
        ))}
      </div>

      <p className="mt-10 text-xs text-muted-foreground">
        These terms are a working draft and may be updated before the bracket
        locks.
      </p>
    </main>
  );
}
