"use client";

/**
 * Comic speech-bubble overlay for one active taunt (issue #84). Rendered by
 * `VideoTiles.tsx`, keyed on the bubble's `sentAt` so a same-sender
 * replacement remounts this component fresh — restarting both the pop-in
 * animation and the auto-dismiss timer. Purely presentational: text/glyph
 * resolution is delegated to the pure `src/lib/race/taunts.ts`, and unknown
 * ids never reach this component because the `addTaunt` reducer already
 * filters them out before they land in state.
 *
 * Styling is deliberately minimal-clean (panel + design tokens) — the
 * wave-2 cartoon-retheme issue owns the full comic-bubble treatment, and
 * this component is the single seam it will touch.
 */

import { useEffect, useRef } from "react";

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

  return (
    <div
      data-testid={`taunt-bubble-${anchor}`}
      role="status"
      className={cn(
        "pointer-events-none absolute z-10 max-w-[80%] animate-in fade-in zoom-in-95 rounded-[var(--radius)] border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-lg duration-150",
        anchor === "self"
          ? "right-0 bottom-full mb-1.5 border-player-self/60"
          : "top-2 left-2 border-player-opponent/60",
        className,
      )}
    >
      {emote != null ? (
        <span className="block text-2xl leading-none">{emote}</span>
      ) : (
        <span className="block text-xs leading-snug font-medium">{text}</span>
      )}
    </div>
  );
}
