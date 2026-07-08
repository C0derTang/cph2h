"use client";

/**
 * The "bar" card — a lower-third-style trash-talk card for one active taunt
 * (issue #84, restyled per docs/design.md §"Bar-card taunts" in the wave-2
 * retheme). Rendered by `VideoTiles.tsx`, keyed on the bubble's `sentAt` so a
 * same-sender replacement remounts this component fresh — restarting both the
 * slide-in animation and the auto-dismiss timer. Purely presentational:
 * text/glyph resolution is delegated to the pure `src/lib/race/taunts.ts`,
 * and unknown ids never reach this component because the `addTaunt` reducer
 * already filters them out before they land in state.
 *
 * Tints toward the sender's identity via a left accent rule (acid yellow for
 * self, crimson for opponent — v4 versus axis) and carries a mic glyph — the
 * one surface where the mic icon is earned (docs/design.md "the stamp" / mic
 * iconography rule). The card itself is a hard matte plate: hairline border,
 * near-opaque popover fill, no rounding beyond the HUD radius, no blur.
 */

import { useEffect, useRef } from "react";
import { Mic } from "lucide-react";

import { cn } from "@/lib/utils";
import { tauntEmoteGlyph, tauntPresetText } from "@/lib/race/taunts";
import { TAUNT_DISPLAY_MS } from "@/lib/types";

export interface TauntBubbleProps {
  tauntId: string;
  /** Whose tile this bubble is anchored to — drives placement + identity color. */
  anchor: "self" | "opponent";
  /** Fires once, `TAUNT_DISPLAY_MS` after mount. */
  onExpire: () => void;
  className?: string;
}

export function TauntBubble({ tauntId, anchor, onExpire, className }: TauntBubbleProps) {
  // Mirror the latest `onExpire` in a ref so the mount-once timer effect
  // below never needs to depend on it (a same-taunt re-render must not
  // restart the dismiss clock — only a genuine replacement, which remounts
  // this component via a new `key`, should do that).
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    const timer = setTimeout(() => onExpireRef.current(), TAUNT_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const text = tauntPresetText(tauntId);
  const emote = tauntEmoteGlyph(tauntId);
  if (text == null && emote == null) return null; // defensive; addTaunt already filters unknown ids

  const isSelf = anchor === "self";

  return (
    <div
      data-testid={`taunt-bubble-${anchor}`}
      role="status"
      className={cn(
        "pointer-events-none absolute z-10 flex max-w-[85%] items-center gap-2 rounded-[var(--radius)] border border-border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
        isSelf
          ? "right-0 bottom-full mb-1.5 border-l-2 border-l-player-self motion-safe:slide-in-from-bottom-2"
          : "top-2 left-2 border-l-2 border-l-player-opponent motion-safe:slide-in-from-top-2",
        className,
      )}
    >
      <Mic
        className={cn(
          "size-3 shrink-0",
          isSelf ? "text-player-self" : "text-player-opponent",
        )}
        aria-hidden
      />
      {emote != null ? (
        <span className="text-2xl leading-none">{emote}</span>
      ) : (
        <span className="font-display text-[11px] leading-snug tracking-wide uppercase">
          {text}
        </span>
      )}
    </div>
  );
}
