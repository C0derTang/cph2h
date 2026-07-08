/**
 * HeroWord — the ONE huge neon graffiti word per screen (design system v4,
 * "cyberpunk glitch HUD"). Renders an aria-hidden Sedgwick Ave Display word
 * with a layered neon bloom (`hero-word`) and, by default, an RGB-split glitch
 * (`glitch-text`, driven by `data-text`).
 *
 * Rules (docs/design.md, hero-word placement map): exactly ONE per screen,
 * never UI text, never numbers. It is pure decoration — always aria-hidden —
 * so the screen must read completely without it.
 */

import { cn } from "@/lib/utils";

const TONE_CLASS = {
  self: "text-player-self",
  opponent: "text-player-opponent",
  foreground: "text-foreground",
  muted: "text-muted-foreground",
} as const;

type HeroWordProps = {
  /** The word itself — lowercase voice words ("bars", "seek", "bodied"). */
  word: string;
  /** Ink: identity hue, plain foreground, or muted. Defaults to self yellow. */
  tone?: "self" | "opponent" | "foreground" | "muted";
  /** RGB-split glitch fringe (on by default; motion-safe slices animate). */
  glitch?: boolean;
  className?: string;
};

export function HeroWord({
  word,
  tone = "self",
  glitch = true,
  className,
}: HeroWordProps) {
  // Outer span owns caller positioning (absolute/translate/etc.); the inner
  // span owns the glitch. `glitch-text` sets `position: relative` for its
  // pseudos, which would otherwise fight a caller's `absolute` for the
  // `position` slot and knock the word back into flow.
  return (
    <span aria-hidden className={cn("inline-block", TONE_CLASS[tone], className)}>
      <span
        data-text={word}
        className={cn("hero-word block", glitch && "glitch-text")}
      >
        {word}
      </span>
    </span>
  );
}
