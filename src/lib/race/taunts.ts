/**
 * Pure taunt logic (issue #84) — preset trash-talk sent over the LiveKit data
 * channel as an ephemeral `RaceEvent` (`{ type: "taunt"; byUserId; tauntId }`,
 * see `src/lib/types.ts`). Nothing here touches React, LiveKit, or the
 * network: it's the validation/cooldown/bubble-state core, independently
 * unit-tested, that the components (`TauntPicker.tsx`, `TauntBubble.tsx`,
 * `RaceRoom.tsx`) call into.
 *
 * Zero persistence — taunts are never written to the DB and never affect
 * `RaceSnapshot`/race lifecycle. Unknown ids (from a future preset list, or a
 * malformed/forged payload) are ignored silently everywhere in this module —
 * there is no free text and no moderation surface, so "ignore" is the whole
 * error-handling story.
 */

import { TAUNT_COOLDOWN_MS, TAUNT_DISPLAY_MS, TAUNT_EMOTES, TAUNT_PRESETS } from "@/lib/types";

/** True for any id present in the preset or emote tables. */
export function isKnownTauntId(tauntId: string): boolean {
  return Object.prototype.hasOwnProperty.call(TAUNT_PRESETS, tauntId) ||
    Object.prototype.hasOwnProperty.call(TAUNT_EMOTES, tauntId);
}

/** Display text for a preset taunt id, or null if `tauntId` isn't a preset. */
export function tauntPresetText(tauntId: string): string | null {
  return Object.prototype.hasOwnProperty.call(TAUNT_PRESETS, tauntId)
    ? TAUNT_PRESETS[tauntId]
    : null;
}

/** Emoji glyph for an emote taunt id, or null if `tauntId` isn't an emote. */
export function tauntEmoteGlyph(tauntId: string): string | null {
  return Object.prototype.hasOwnProperty.call(TAUNT_EMOTES, tauntId)
    ? TAUNT_EMOTES[tauntId]
    : null;
}

/**
 * Client-enforced send cooldown gate. `lastSentAt` is the epoch ms of this
 * client's last successfully sent taunt, or null if it hasn't sent one yet
 * this race. Purely a UX throttle (disables the picker) — there is no server
 * enforcement because taunts are never server-mediated.
 */
export function canTaunt(lastSentAt: number | null, now: number): boolean {
  return lastSentAt == null || now - lastSentAt >= TAUNT_COOLDOWN_MS;
}

/** Milliseconds remaining before `canTaunt` would allow another send (>= 0). */
export function tauntCooldownRemainingMs(lastSentAt: number | null, now: number): number {
  if (lastSentAt == null) return 0;
  return Math.max(0, TAUNT_COOLDOWN_MS - (now - lastSentAt));
}

/** One active bubble: which taunt, and when it was received (for expiry). */
export interface TauntBubbleState {
  tauntId: string;
  /** Epoch ms this bubble was added/replaced — the expiry clock's zero point. */
  sentAt: number;
}

/** Active bubbles keyed by the sending user's id — at most one per sender. */
export type TauntBubbles = Record<string, TauntBubbleState>;

/**
 * Add (or replace) the bubble for `byUserId`. Unknown taunt ids are ignored
 * silently (forward-compat with future presets, and defense against a
 * malformed/forged wire payload) and return `bubbles` unchanged. A second
 * taunt from the same sender replaces their previous bubble outright, per
 * spec — there is no queueing.
 */
export function addTaunt(
  bubbles: TauntBubbles,
  byUserId: string,
  tauntId: string,
  now: number,
): TauntBubbles {
  if (!isKnownTauntId(tauntId)) return bubbles;
  return { ...bubbles, [byUserId]: { tauntId, sentAt: now } };
}

/**
 * Remove the bubble for `byUserId`, but only if it is still the one that was
 * added at `sentAt` — guards against a stale auto-dismiss timer (scheduled
 * for an earlier bubble) clobbering a newer bubble that replaced it in the
 * interim. No-op if the entry is already gone or has since changed.
 */
export function expireTaunt(
  bubbles: TauntBubbles,
  byUserId: string,
  sentAt: number,
): TauntBubbles {
  const existing = bubbles[byUserId];
  if (!existing || existing.sentAt !== sentAt) return bubbles;
  const next = { ...bubbles };
  delete next[byUserId];
  return next;
}

/**
 * Drop every bubble whose display window has elapsed as of `now`. A
 * time-based sweep independent of the per-bubble `expireTaunt` timers above —
 * useful for a single interval-driven cleanup pass instead of one `setTimeout`
 * per bubble. Returns the same reference when nothing changed, so callers can
 * skip a re-render.
 */
export function pruneExpiredTaunts(bubbles: TauntBubbles, now: number): TauntBubbles {
  let changed = false;
  const next: TauntBubbles = {};
  for (const [byUserId, bubble] of Object.entries(bubbles)) {
    if (now - bubble.sentAt < TAUNT_DISPLAY_MS) {
      next[byUserId] = bubble;
    } else {
      changed = true;
    }
  }
  return changed ? next : bubbles;
}
