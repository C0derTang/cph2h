import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

const LINKS = [
  { href: "/queue", label: "Race" },
  { href: "/challenge/new", label: "Challenge" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/dashboard", label: "Dashboard" },
];

/**
 * The evolved wordmark. Keeps the terminal `>` prompt and blinking cursor of the
 * original identity, but sets "cph2h" in the display face and colors the caret
 * with the self-identity (Ember) so the versus theme reads from the top bar.
 */
function Wordmark() {
  return (
    <Link
      href="/"
      className="group flex items-center gap-1.5 font-display text-[15px] font-semibold tracking-tight text-foreground"
    >
      <span className="text-player-self">&gt;</span>
      <span>cph2h</span>
      <span
        aria-hidden
        className="ml-0.5 inline-block h-3.5 w-[2px] bg-player-self motion-safe:animate-pulse"
      />
    </Link>
  );
}

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-sm supports-[backdrop-filter]:bg-background/70">
      {/* Versus hairline: the two identity colors meet across the top edge. */}
      <div
        aria-hidden
        className="h-px w-full bg-gradient-to-r from-player-self via-border to-player-opponent"
      />

      <div className="shell flex h-14 items-center justify-between gap-4">
        <Wordmark />

        <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-mono text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:text-foreground"
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
        className="shell flex items-center gap-5 overflow-x-auto border-t border-border py-2 md:hidden"
      >
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="shrink-0 font-mono text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase transition-colors hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
