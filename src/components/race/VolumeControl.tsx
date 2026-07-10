"use client";

/**
 * Opponent-audio volume: the persisted setting + the slider UI (issue #100).
 *
 * The browser can't read OS/system volume, so this in-app control — wired to
 * `RoomAudioRenderer`'s `volume` prop in `VideoTiles.tsx` — is how opponent
 * audio loudness is adjusted (it is a preference, not a ready-gate).
 * `useOpponentVolume` reads/writes `localStorage` through a tiny module-level
 * external store (via `useSyncExternalStore`) rather than a mount effect —
 * `getServerSnapshot` returns `DEFAULT_VOLUME` so SSR/hydration markup
 * matches, and React itself handles the post-hydration correction, so no
 * effect-based `setState` is needed (see `src/lib/race/av-requirements.ts`
 * for the underlying read/write/clamp helpers). Independent mounts share
 * this one store, so the setting persists across sessions and stays in sync
 * if multiple consumers are ever mounted at once.
 */

import { useCallback, useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  clampVolume,
  DEFAULT_VOLUME,
  isVolumeAudible,
  readVolume,
  writeVolume,
} from "@/lib/race/av-requirements";

export interface OpponentVolume {
  volume: number;
  volumeAudible: boolean;
  setVolume: (volume: number) => void;
}

type VolumeStoreListener = () => void;
const volumeListeners = new Set<VolumeStoreListener>();
let cachedVolume: number | null = null;

function getVolumeSnapshot(): number {
  if (cachedVolume === null) cachedVolume = readVolume();
  return cachedVolume;
}

function getVolumeServerSnapshot(): number {
  return DEFAULT_VOLUME;
}

function subscribeToVolume(listener: VolumeStoreListener): () => void {
  volumeListeners.add(listener);
  return () => volumeListeners.delete(listener);
}

function setStoredVolume(next: number): void {
  const clamped = clampVolume(next);
  cachedVolume = clamped;
  writeVolume(clamped);
  volumeListeners.forEach((listener) => listener());
}

export function useOpponentVolume(): OpponentVolume {
  const volume = useSyncExternalStore(
    subscribeToVolume,
    getVolumeSnapshot,
    getVolumeServerSnapshot,
  );
  const setVolume = useCallback((next: number) => setStoredVolume(next), []);

  return { volume, volumeAudible: isVolumeAudible(volume), setVolume };
}

export interface VolumeSliderProps {
  volume: number;
  onChange: (volume: number) => void;
  className?: string;
  /** Override for a second slider instance on the same page (lobby + race room). */
  testId?: string;
}

/** Opponent-audio volume slider — a plain range input styled to the stage tokens. */
export function VolumeSlider({
  volume,
  onChange,
  className,
  testId = "volume-slider",
}: VolumeSliderProps) {
  const audible = isVolumeAudible(volume);
  const percent = Math.round(volume * 100);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {audible ? (
        <Volume2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <VolumeX className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-label="Opponent volume"
        data-testid={testId}
        className="h-1.5 flex-1 cursor-pointer accent-primary"
      />
      <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {percent}
      </span>
    </div>
  );
}
