"use client";

/**
 * Headless race audio (issue #112) — renders nothing; fires synthesized SFX
 * and drives the BGM loop off the race snapshot. Mounted across RaceRoom's
 * lobby / active / finished branches (three trivial one-line insertions —
 * see `RaceRoom.tsx`) so it can react to `opponent_joined` in the lobby, the
 * countdown → `race_start` boundary and verdicts while active, and the
 * `win`/`lose` flip the instant the branch switches to `finished`.
 *
 * `RaceRoom` unmounts/remounts this component across those branch switches
 * (different JSX subtrees), so a component-local "previous snapshot" ref
 * would reset to null right when it matters most (the active -> finished
 * transition) and silently drop the win/lose cue. Instead the last-seen
 * snapshot per race is kept in a small module-level cache — the same
 * "external store" shape `VolumeControl.tsx`/`AudioControls.tsx` already use
 * for cross-mount state — keyed by `snapshot.id`, so the diff survives the
 * remount. `detectAudioTransitions` (the pure, unit-tested half of this
 * module) never fires anything off a `null` previous snapshot, so a fresh
 * mount on an already-finished race (e.g. a hard refresh) correctly stays
 * silent instead of replaying `win`/`lose`.
 *
 * Countdown ticks and the BGM loop are NOT snapshot-diff-driven (a snapshot
 * only arrives every few seconds via the poll loop) — both run off a local
 * ~250ms timer derived from the snapshot's own clock-skew-corrected
 * `now`/`startedAt`, mirroring the pattern in `RaceRoom.tsx`/`Lobby.tsx`.
 */

import { useEffect, useRef } from "react";

import type { RaceSnapshot } from "@/lib/types";
import { computeSkewMs, correctedNow } from "@/lib/race/countdown";
import { detectAudioTransitions } from "@/lib/audio/transitions";
import { initAudioGestures, playSfx, startBgm, stopBgm } from "@/lib/audio/engine";
import { useAudioPrefs } from "@/components/race/AudioControls";

export interface RaceAudioProps {
  snapshot: RaceSnapshot;
  /** The viewer's own `users.id` — decides `win` vs `lose` at finish. */
  youId: string;
}

// Keyed by race id so the diff survives RaceRoom remounting this component
// across its lobby/active/finished branches (see module doc above).
const lastSeenByRaceId = new Map<string, RaceSnapshot>();

export function RaceAudio({ snapshot, youId }: RaceAudioProps) {
  const { bgmEnabled } = useAudioPrefs();

  // Attach the gesture-unlock listeners as early as possible (issue #131) —
  // BEFORE the countdown-tick/BGM effect below or any transition SFX ever
  // attempts a sound, so the first real gesture in the room (not necessarily
  // a click on this component) creates/resumes a running AudioContext
  // instead of the context being born suspended from a non-gesture callback.
  useEffect(() => {
    initAudioGestures();
  }, []);

  // Discrete transition SFX: diff against the last snapshot this race has
  // ever seen (across mounts), then play whatever the pure detector reports.
  useEffect(() => {
    const prev = lastSeenByRaceId.get(snapshot.id) ?? null;
    const sfx = detectAudioTransitions(prev, snapshot, youId);
    lastSeenByRaceId.set(snapshot.id, snapshot);
    for (const name of sfx) playSfx(name);
  }, [snapshot, youId]);

  // Countdown ticks (one per second while counting down) + BGM start/stop
  // (post-countdown, while active). Local timer, not snapshot-diff-driven —
  // see module doc.
  const lastTickSecondRef = useRef<number | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const skewMs = computeSkewMs(snapshot.now, Date.now());
    const startedAtMs = snapshot.startedAt ? Date.parse(snapshot.startedAt) : null;

    const tick = () => {
      if (snapshot.status !== "active" || startedAtMs == null) {
        stopBgm();
        return;
      }
      const nowMs = correctedNow(skewMs);
      if (nowMs < startedAtMs) {
        const secondsLeft = Math.ceil((startedAtMs - nowMs) / 1000);
        if (secondsLeft !== lastTickSecondRef.current) {
          lastTickSecondRef.current = secondsLeft;
          playSfx("countdown_tick");
        }
        stopBgm();
      } else if (bgmEnabled) {
        startBgm();
      } else {
        stopBgm();
      }
    };

    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [snapshot.status, snapshot.startedAt, snapshot.now, bgmEnabled]);

  // Belt-and-braces: stop BGM on unmount (branch switch / navigating away).
  useEffect(() => stopBgm, []);

  return null;
}
