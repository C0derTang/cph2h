"use client";

/**
 * Taunt picker (issue #84) — the send side of the trash-talk feature. Grid
 * of the 12 preset text taunts + 6 emotes; sends over the existing LiveKit
 * data channel using the room's `useDataChannel` hook, so it must be
 * rendered inside a `<LiveKitRoom>` (mirrors `VideoTiles.tsx`).
 *
 * Client-enforced `TAUNT_COOLDOWN_MS` throttle: after a send, every button
 * disables and a countdown appears until the cooldown clears. There is no
 * server-side enforcement — taunts are never server-mediated, purely
 * ephemeral presentation (see `src/lib/race/taunts.ts`).
 *
 * Sending is fire-and-forget from this component's point of view: the
 * LiveKit data channel does not echo a publisher's own message back to
 * itself, so the sender's own bubble is applied optimistically by the
 * parent via `onSent` rather than waiting on a round trip.
 */

import { useCallback, useEffect, useState } from "react";
import { useDataChannel } from "@livekit/components-react";
import { Mic } from "lucide-react";

import { cn } from "@/lib/utils";
import { canTaunt, tauntCooldownRemainingMs } from "@/lib/race/taunts";
import { encodeRaceEvent, LIVEKIT_DATA_TOPIC, TAUNT_EMOTES, TAUNT_PRESETS } from "@/lib/types";

/** How often the on-screen cooldown countdown re-renders. */
const COOLDOWN_TICK_MS = 100;

export interface TauntPickerProps {
  /** This client's user id — becomes the taunt event's `byUserId`. */
  currentUserId: string;
  /** Called immediately after a successful send so the parent can render
   *  this client's own bubble (see the module doc above). */
  onSent: (tauntId: string) => void;
  className?: string;
}

export function TauntPicker({ currentUserId, onSent, className }: TauntPickerProps) {
  const { send } = useDataChannel(LIVEKIT_DATA_TOPIC);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const onCooldown = !canTaunt(lastSentAt, now);

  // Only tick a clock while a cooldown is actually counting down, so the
  // picker is otherwise inert (no interval running) between taunts.
  useEffect(() => {
    if (!onCooldown) return;
    const id = setInterval(() => setNow(Date.now()), COOLDOWN_TICK_MS);
    return () => clearInterval(id);
  }, [onCooldown]);

  const handlePick = useCallback(
    (tauntId: string) => {
      const sendTime = Date.now();
      if (!canTaunt(lastSentAt, sendTime)) return;
      setLastSentAt(sendTime);
      setNow(sendTime);
      void send(
        encodeRaceEvent({ type: "taunt", byUserId: currentUserId, tauntId }),
        { reliable: true },
      );
      onSent(tauntId);
    },
    [lastSentAt, send, currentUserId, onSent],
  );

  const remainingSec = Math.ceil(tauntCooldownRemainingMs(lastSentAt, now) / 1000);

  return (
    <div
      data-testid="taunt-picker"
      className={cn("panel flex flex-col gap-2 p-3", className)}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 eyebrow text-muted-foreground">
          <Mic className="size-3.5 text-player-self" aria-hidden />
          Spit a bar
        </span>
        {onCooldown && (
          <span
            data-testid="taunt-cooldown"
            className="font-mono text-xs tabular-nums text-muted-foreground"
          >
            {remainingSec}s
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {Object.entries(TAUNT_PRESETS).map(([id, text]) => (
          <button
            key={id}
            type="button"
            data-testid={`taunt-preset-${id}`}
            title={text}
            disabled={onCooldown}
            onClick={() => handlePick(id)}
            className="truncate rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1.5 text-left text-[11px] font-medium outline-none transition-colors hover:border-player-self/50 hover:bg-muted hover:text-player-self focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-safe:active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            {text}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {Object.entries(TAUNT_EMOTES).map(([id, glyph]) => (
          <button
            key={id}
            type="button"
            data-testid={`taunt-emote-${id}`}
            title={id}
            disabled={onCooldown}
            onClick={() => handlePick(id)}
            className="flex items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background py-1.5 text-lg outline-none transition-colors hover:border-player-self/50 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-safe:active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            {glyph}
          </button>
        ))}
      </div>
    </div>
  );
}
