"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Show, UserButton } from "@clerk/nextjs";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MENU_ROUTES,
  isBackRoute,
  isKnownRoute,
  routeMarkerLabel,
} from "@/lib/nav-routes";

// Simplified battle IA: the play hub and the ladder. "Play" lands on the
// signed-in hub; "The Ladder" is the leaderboard, renamed in voice. Display
// name is no longer editable (issue #120) — it follows the linked CF handle, so
// the user button only links to the CF account settings, not a display-name page.
const LINKS = [
  { href: "/dashboard", label: "Play" },
  { href: "/queue", label: "Race" },
  { href: "/challenge/new", label: "Challenge" },
  { href: "/leaderboard", label: "The Ladder" },
];

// The menu screens (landing + dashboard) are self-contained game menus whose
// big slab rows already carry navigation, so the nav collapses to minimal
// chrome there (issue #124). Every other known route — race rooms, queue,
// settings — keeps the full nav. Unknown routes (404s) also collapse to this
// minimal chrome below, so a missing page never echoes its pathname or shows
// the retired link bar (issue #188). `MENU_ROUTES` lives in nav-routes so
// `isKnownRoute` can share it — one source of truth.

// Sub-pages (race rooms, the queue, challenge flow, settings, the ladder) drop
// the primary LINKS bar entirely — they carry a single top-left Back button
// (RouteBack, rendered in the layout) so they read as a focused task screen
// rather than a hub with a competing link bar. `isBackRoute` (shared with
// RouteBack) is the single source for that set.

/**
 * The wordmark: cph2h set in the display face, uppercase, with a self-yellow
 * underline rule. The old terminal-cursor motif is retired — this is a
 * marquee, not a prompt.
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
        className="mt-1 h-[3px] w-full bg-player-self transition-colors group-hover:bg-player-self/80"
      />
    </Link>
  );
}

/** Signed-in account button (with the CF-settings menu item) or the
 *  sign-in/sign-up pair — shared by the minimal and full nav. */
function AuthChip() {
  return (
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
      <UserButton>
        <UserButton.MenuItems>
          <UserButton.Link
            label="Codeforces account"
            labelIcon={<Link2 className="size-4" aria-hidden />}
            href="/settings/cf"
          />
        </UserButton.MenuItems>
      </UserButton>
    </Show>
  );
}

export function Nav() {
  const pathname = usePathname();
  const isBack = isBackRoute(pathname);
  const markerLabel = routeMarkerLabel(pathname);

  // Minimal chrome on menu screens — and on unknown routes (404s), which get
  // the exact same treatment so a missing page never leaks its pathname or
  // shows the retired link bar (issue #188): just the wordmark and the
  // account chip, floating over the full-viewport game menu — no competing
  // link bar.
  if (MENU_ROUTES.has(pathname) || !isKnownRoute(pathname)) {
    return (
      <header className="relative z-40">
        <div className="shell flex h-16 items-center justify-between gap-4">
          <Wordmark />
          <div className="flex items-center gap-2">
            <AuthChip />
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95">
      {/* Versus rule: self yellow meets opponent crimson across the top edge. */}
      <div
        aria-hidden
        className="h-px w-full bg-gradient-to-r from-player-self via-border to-player-opponent"
      />

      <div className="shell flex h-16 items-center justify-between gap-4">
        <Wordmark />

        {/* App links are signed-in only — a signed-out visitor's destinations
            are the auth chip's Sign in / Sign up, not the app IA. Back routes
            drop the link bar entirely (they carry the top-left RouteBack). */}
        {!isBack && (
          <Show when="signed-in">
            <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="eyebrow text-muted-foreground transition-colors hover:text-player-self"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </Show>
        )}

        <div className="flex items-center gap-2">
          {/* The nav's single hud-meta scatter point: a route marker at the
              right edge of the bar (decorative HUD chrome, not navigation).
              Always a fixed section label from routeMarkerLabel -- never the
              raw pathname (issue #190) -- so a 404 under a known prefix (e.g.
              `/settings/admin`) can't leak user-typed input through the nav. */}
          {markerLabel !== null && (
            <span aria-hidden className="hud-meta mr-2 hidden md:inline">
              {`// ${markerLabel}`}
            </span>
          )}
          <AuthChip />
        </div>
      </div>

      {!isBack && (
        <Show when="signed-in">
          <nav
            aria-label="Primary"
            className="shell flex items-center gap-6 overflow-x-auto border-t border-border py-2 md:hidden"
          >
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="shrink-0 eyebrow text-muted-foreground transition-colors hover:text-player-self"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </Show>
      )}
    </header>
  );
}
