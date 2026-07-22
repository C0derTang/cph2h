import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "report a bug · cph2h",
};

export default function ReportBugPage() {
  return (
    <main className="shell-narrow flex-1 py-16 md:py-24">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to home
      </Link>

      <p className="mt-8 eyebrow text-muted-foreground">Support</p>
      <h1 className="mt-2 font-display text-3xl tracking-tight uppercase md:text-4xl">
        Report a bug
      </h1>

      <div className="mt-8 max-w-2xl">
        <p className="text-sm leading-6 text-muted-foreground">
          Found a bug? Let us know. Send us an email with what you were doing,
          the race ID if relevant, your browser, operating system, and any
          screenshots that help us understand what happened.
        </p>
        <a
          href="mailto:tangsc@stanford.edu"
          className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] text-player-self hover:underline"
        >
          <Mail className="size-3.5" aria-hidden />
          tangsc@stanford.edu
        </a>
      </div>
    </main>
  );
}
