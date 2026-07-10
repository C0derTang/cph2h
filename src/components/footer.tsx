"use client";

import { usePathname } from "next/navigation";

// Site-wide footer, rendered once in the root layout. Client component only
// so it can read the pathname: the /race/[id] HUD is a full-viewport screen
// where a trailing footer is unwanted, so it renders nothing there.
export function Footer() {
  const pathname = usePathname();
  if (pathname.startsWith("/race/")) return null;

  return (
    <footer className="shell flex flex-col gap-3 border-t border-border py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span className="inline-flex flex-col items-start leading-none">
        <span className="font-display text-base tracking-wide text-foreground uppercase">
          cph2h
        </span>
        <span aria-hidden className="mt-1 h-0.5 w-full bg-player-self" />
      </span>
      <div className="flex flex-col gap-1.5 sm:items-end">
        <p>Built for people who&apos;d rather battle than grind alone.</p>
        <p>&copy; {new Date().getFullYear()} cph2h. All rights reserved.</p>
        {/* hud-meta scatter point: build tag in the footer corner. */}
        <span aria-hidden className="hud-meta">
          bld&nbsp;4.0&nbsp;·&nbsp;0708
        </span>
      </div>
    </footer>
  );
}
