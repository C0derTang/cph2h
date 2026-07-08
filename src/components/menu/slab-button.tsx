/**
 * Slab button (issue #129) — the condensed sibling of the game-menu slab row
 * ({@link ./menu-row}). It carries the same signature language (left accent
 * stripe, tinted liquid-glass fill, uppercase display label, accent glow on
 * hover/focus) at button scale, for the significant CTAs across the app: the
 * lobby READY, the race action bar, result/queue actions, and primary form
 * submits. Small utility controls (icon toggles, mic/cam, pagination, ghost
 * "cancel"/"back" links) deliberately stay on the plain {@link ../ui/button}.
 *
 * Built on the same base-ui Button primitive as `ui/button`, so every prop that
 * component accepts works here too — `render` + `nativeButton={false}` to render
 * as a Link/anchor, `disabled`, `onClick`, `type`, `data-testid`, `aria-*`.
 * Styling lives in globals.css (`menu-row-sm`); this only wires the accent hue
 * and the optional larger size.
 */

import type { CSSProperties } from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";

import { cn } from "@/lib/utils";
import { accentStyle } from "@/components/menu/menu-row";

/** Named accent tones → identity/verdict hues. `tone` sets both the stripe and
 *  the fill tint, which is how hierarchy is kept: a bright identity hue reads as
 *  the dominant CTA, `neutral` as a quiet secondary, `destructive` as danger. */
const TONE_ACCENT = {
  /** Cyan self-identity — the default dominant CTA. */
  primary: "var(--player-self)",
  self: "var(--player-self)",
  opponent: "var(--player-opponent)",
  destructive: "var(--destructive)",
  /** Muted grey fill — secondary actions (back, decline, leave). */
  neutral: "var(--muted-foreground)",
} as const;

export type SlabTone = keyof typeof TONE_ACCENT;

export interface SlabButtonProps
  extends Omit<ButtonPrimitive.Props, "style"> {
  /** Accent tone (default `primary`). Sets the stripe + fill hue. */
  tone?: SlabTone;
  /** Raw CSS color override for the accent, wins over `tone`. */
  accent?: string;
  /** `lg` bumps the font-size (em-based padding scales with it) for hero CTAs. */
  size?: "default" | "lg";
  /** Plain style object (the state-callback form isn't needed for a CTA). */
  style?: CSSProperties;
}

export function SlabButton({
  tone = "primary",
  accent,
  size = "default",
  className,
  style,
  children,
  ...props
}: SlabButtonProps) {
  const hue = accent ?? TONE_ACCENT[tone];
  return (
    <ButtonPrimitive
      data-slot="slab-button"
      className={cn("menu-row-sm", className)}
      style={{
        ...accentStyle(hue),
        ...(size === "lg" ? { fontSize: "1.05rem" } : null),
        ...style,
      }}
      {...props}
    >
      {children}
    </ButtonPrimitive>
  );
}
