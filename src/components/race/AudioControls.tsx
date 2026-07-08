"use client";

/**
 * Audio preference toggles (issue #112): independent SFX/BGM mute switches.
 *
 * Mirrors `VolumeControl.tsx`'s module-level external-store pattern
 * (`useSyncExternalStore` over `localStorage`, `getServerSnapshot` returning
 * the default so SSR/hydration markup matches) so `useAudioPrefs` can be
 * mounted independently in both the lobby and the race room's `VideoTiles`
 * and stay in sync — and so `RaceAudio.tsx` can react to a toggle flip
 * immediately (turning BGM off mid-race silences it on the very next tick,
 * not just on the next race).
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Music, Volume1, VolumeX } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  readBgmEnabled,
  readSfxEnabled,
  writeBgmEnabled,
  writeSfxEnabled,
} from "@/lib/audio/prefs";
import { initAudioGestures, stopBgm, unlockAudioContext } from "@/lib/audio/engine";

export interface AudioPrefs {
  sfxEnabled: boolean;
  bgmEnabled: boolean;
  setSfxEnabled: (enabled: boolean) => void;
  setBgmEnabled: (enabled: boolean) => void;
}

type PrefsListener = () => void;
const listeners = new Set<PrefsListener>();
let cachedSfx: boolean | null = null;
let cachedBgm: boolean | null = null;

function getSfxSnapshot(): boolean {
  if (cachedSfx === null) cachedSfx = readSfxEnabled();
  return cachedSfx;
}

function getBgmSnapshot(): boolean {
  if (cachedBgm === null) cachedBgm = readBgmEnabled();
  return cachedBgm;
}

// Defaults (both ON) — matches `getSfxSnapshot`/`getBgmSnapshot`'s fallback
// and keeps SSR markup identical to a fresh client read.
function getSfxServerSnapshot(): boolean {
  return true;
}

function getBgmServerSnapshot(): boolean {
  return true;
}

function subscribe(listener: PrefsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setStoredSfxEnabled(enabled: boolean): void {
  cachedSfx = enabled;
  writeSfxEnabled(enabled);
  listeners.forEach((listener) => listener());
}

function setStoredBgmEnabled(enabled: boolean): void {
  cachedBgm = enabled;
  writeBgmEnabled(enabled);
  // Silence immediately, regardless of which mount toggled it — `RaceAudio`
  // will restart the loop on its next tick if the race is still active and
  // post-countdown.
  if (!enabled) stopBgm();
  listeners.forEach((listener) => listener());
}

/** Shared, cross-mount audio preference state (SFX + BGM, both default on). */
export function useAudioPrefs(): AudioPrefs {
  const sfxEnabled = useSyncExternalStore(subscribe, getSfxSnapshot, getSfxServerSnapshot);
  const bgmEnabled = useSyncExternalStore(subscribe, getBgmSnapshot, getBgmServerSnapshot);
  const setSfxEnabled = useCallback((enabled: boolean) => setStoredSfxEnabled(enabled), []);
  const setBgmEnabled = useCallback((enabled: boolean) => setStoredBgmEnabled(enabled), []);
  return { sfxEnabled, bgmEnabled, setSfxEnabled, setBgmEnabled };
}

export interface AudioToggleButtonsProps {
  className?: string;
  /** Distinguishes testids across the lobby + race-room mounts. */
  testIdSuffix?: string;
}

/** Two small icon buttons: SFX on/off, music on/off. */
export function AudioToggleButtons({ className, testIdSuffix }: AudioToggleButtonsProps) {
  const { sfxEnabled, bgmEnabled, setSfxEnabled, setBgmEnabled } = useAudioPrefs();
  const sfxTestId = testIdSuffix ? `toggle-sfx-${testIdSuffix}` : "toggle-sfx";
  const bgmTestId = testIdSuffix ? `toggle-bgm-${testIdSuffix}` : "toggle-bgm";

  // Belt-and-braces gesture unlock (issue #131): these buttons may mount
  // before RaceAudio (e.g. the lobby), so attach the eager listeners here
  // too — idempotent, so mounting both is harmless.
  useEffect(() => {
    initAudioGestures();
  }, []);

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <button
        type="button"
        onClick={() => {
          // A toggle click is itself a real user gesture and explicit intent
          // to hear sound — unlock directly rather than waiting on the next
          // qualifying gesture the eager listeners would catch anyway.
          unlockAudioContext();
          setSfxEnabled(!sfxEnabled);
        }}
        aria-pressed={sfxEnabled}
        aria-label={sfxEnabled ? "Mute sound effects" : "Unmute sound effects"}
        title={sfxEnabled ? "Sound effects on" : "Sound effects muted"}
        data-testid={sfxTestId}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background text-muted-foreground transition-colors hover:bg-muted",
          !sfxEnabled && "text-verdict-fail",
        )}
      >
        {sfxEnabled ? (
          <Volume1 className="size-4" aria-hidden />
        ) : (
          <VolumeX className="size-4" aria-hidden />
        )}
      </button>
      <button
        type="button"
        onClick={() => {
          unlockAudioContext();
          setBgmEnabled(!bgmEnabled);
        }}
        aria-pressed={bgmEnabled}
        aria-label={bgmEnabled ? "Mute music" : "Unmute music"}
        title={bgmEnabled ? "Music on" : "Music muted"}
        data-testid={bgmTestId}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background text-muted-foreground transition-colors hover:bg-muted",
          !bgmEnabled && "text-verdict-fail",
        )}
      >
        {bgmEnabled ? (
          <Music className="size-4" aria-hidden />
        ) : (
          <VolumeX className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}
