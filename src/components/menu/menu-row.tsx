/**
 * The game-menu slab row (issue #124) — the tetr.io main-menu language. A full-
 * width horizontal action: an accent stripe, an icon plate, a tall Chakra Petch label,
 * and a mono tagline; hover/focus slides it right and blooms the accent glow
 * (styling lives in globals.css `menu-row` / `menu-row-icon` / `menu-row-arrow`).
 *
 * `MenuRowContent` is the presentational innards, shared by the navigating
 * `MenuRowLink` and the client-side disclosure rows (e.g. the challenge row) so
 * every row reads identically. Each row sets its hue via `--row-accent`.
 */

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

/** Inline style that keys a row's accent hue. Callers pass a CSS color such as
 *  `"var(--player-self)"`; the icon plate, stripe, and arrow all inherit it. */
export function accentStyle(accent: string): React.CSSProperties {
  return { "--row-accent": accent } as React.CSSProperties;
}

export function MenuRowContent({
  icon: Icon,
  label,
  tagline,
  trailing,
}: {
  icon: LucideIcon;
  label: string;
  tagline: string;
  /** Overrides the default trailing arrow (e.g. a disclosure chevron). */
  trailing?: React.ReactNode;
}) {
  return (
    <>
      <span className="menu-row-icon">
        <Icon className="size-5" aria-hidden strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-xl leading-none tracking-tight uppercase sm:text-3xl md:text-4xl">
          {label}
        </span>
        <span className="mt-2 block truncate font-mono text-[11px] tracking-wide text-muted-foreground sm:text-xs">
          {tagline}
        </span>
      </span>
      {trailing ?? <ArrowRight className="menu-row-arrow size-5" aria-hidden />}
    </>
  );
}

export function MenuRowLink({
  href,
  accent,
  icon,
  label,
  tagline,
}: {
  href: string;
  accent: string;
  icon: LucideIcon;
  label: string;
  tagline: string;
}) {
  return (
    <Link href={href} className="menu-row" style={accentStyle(accent)}>
      <MenuRowContent icon={icon} label={label} tagline={tagline} />
    </Link>
  );
}
