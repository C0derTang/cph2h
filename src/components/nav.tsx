import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

// Simplified battle IA: the play hub and the ladder. Settings/profile live in
// the Clerk user button. "Play" lands on the signed-in hub (wave 2 restructures
// /dashboard into that hub); "The Ladder" is the leaderboard, renamed in voice.
const LINKS = [
  { href: "/dashboard", label: "Play" },
  { href: "/queue", label: "Race" },
  { href: "/challenge/new", label: "Challenge" },
  { href: "/leaderboard", label: "The Ladder" },
];

/**
 * The wordmark: cph2h set in the tall condensed poster face, uppercase, with a
 * gold champion underline rule. The old terminal-cursor motif is retired — this
 * is a marquee, not a prompt.
 */
function Wordmark() {
  return (
    <Link
      href="/"
      className="group inline-flex flex-col items-start leading-none select-none"
    >
      <span className="font-display text-xl tracking-wide text-foreground uppercase">
        cph2h
      </span>
      <span
        aria-hidden
        className="mt-1 h-[3px] w-full bg-player-self transition-all group-hover:bg-player-self/80"
      />
    </Link>
  );
}

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-sm supports-[backdrop-filter]:bg-background/70">
      {/* Versus rule: champion gold meets challenger crimson across the top edge. */}
      <div
        aria-hidden
        className="h-px w-full bg-gradient-to-r from-player-self via-border to-player-opponent"
      />

      <div className="shell flex h-16 items-center justify-between gap-4">
        <Wordmark />

        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-mono text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:text-player-self"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Show
            when="signed-in"
            fallback={
              <>
                <Button
                  render={<Link href="/sign-in" />}
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                >
                  Sign in
                </Button>
                <Button
                  render={<Link href="/sign-up" />}
                  nativeButton={false}
                  size="sm"
                >
                  Sign up
                </Button>
              </>
            }
          >
            <UserButton />
          </Show>
        </div>
      </div>

      <nav
        aria-label="Primary"
        className="shell flex items-center gap-6 overflow-x-auto border-t border-border py-2 md:hidden"
      >
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="shrink-0 font-mono text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:text-player-self"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
