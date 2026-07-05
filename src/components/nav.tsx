import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

const LINKS = [
  { href: "/queue", label: "Race" },
  { href: "/challenge/new", label: "Challenge" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/dashboard", label: "Dashboard" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-sm supports-[backdrop-filter]:bg-background/70">
      <div className="shell flex h-14 items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-1.5 font-heading text-[15px] font-semibold tracking-tight text-foreground"
        >
          <span className="text-primary">&gt;</span>
          <span>cph2h</span>
          <span
            aria-hidden
            className="ml-0.5 inline-block h-3.5 w-[2px] bg-primary/70 motion-safe:animate-pulse"
          />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase transition-colors hover:text-foreground"
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
        className="shell flex items-center gap-5 overflow-x-auto border-t border-border/60 py-2 md:hidden"
      >
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="shrink-0 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase transition-colors hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
