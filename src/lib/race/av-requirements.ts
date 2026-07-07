/**
 * Pure compete-gate rules (issue #100): "you can't compete muted or deaf."
 *
 * Browsers cannot read OS/system volume, so the honest enforceable
 * requirement is (a) a live microphone track with permission granted, and
 * (b) the in-app opponent-audio volume the client controls (LiveKit
 * `RoomAudioRenderer`'s `volume` prop) set above zero. Enforcement is
 * client-side only — the ready button is gated, the API is not (see the
 * issue's "Reality constraint"). Camera is never part of this gate.
 *
 * This module holds the state model + predicate (both pure, unit-tested
 * here) and the SSR-safe localStorage helpers for the persisted volume
 * setting, mirroring the wrap-and-swallow pattern in
 * `src/lib/editor/draft.ts` — a full/disabled storage quota must never break
 * the gate, it just falls back to the default volume.
 */

/** Everything the compete gate needs to know to decide `canCompete`. */
export interface AvRequirementState {
  /** Microphone permission is granted (not "prompt" / "denied"). */
  micGranted: boolean;
  /** A live (unmuted, actually producing audio) local microphone track. */
  micLive: boolean;
  /** The persisted opponent-audio volume setting is > 0. */
  volumeAudible: boolean;
}

/** Convenience default — every requirement unmet, as at first mount. */
export const UNMET_AV_REQUIREMENTS: AvRequirementState = {
  micGranted: false,
  micLive: false,
  volumeAudible: false,
};

/**
 * Ready-to-compete iff mic permission is granted AND the mic track is live
 * AND the opponent-audio volume is audible. All three are required — a
 * granted-but-not-live mic (e.g. the OS device vanished) must still block.
 */
export function canCompete(state: AvRequirementState): boolean {
  return state.micGranted && state.micLive && state.volumeAudible;
}

// ---------------------------------------------------------------------------
// Permission-state mapping
// ---------------------------------------------------------------------------

/** The subset of the DOM `PermissionState` union this module cares about. */
export type MicPermissionState = "granted" | "denied" | "prompt";

/** `navigator.permissions` (or a getUserMedia probe outcome) -> `micGranted`. */
export function micGrantedFromPermissionState(
  state: MicPermissionState | null,
): boolean {
  return state === "granted";
}

// ---------------------------------------------------------------------------
// Persisted opponent-audio volume (localStorage, SSR-safe)
// ---------------------------------------------------------------------------

const VOLUME_STORAGE_KEY = "cph2h:av:volume";

/** Default opponent-audio volume — full, matching `RoomAudioRenderer`'s own default. */
export const DEFAULT_VOLUME = 1;

/** Clamp to the `RoomAudioRenderer`/`AudioTrack` volume range `[0, 1]`. */
export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, volume));
}

/** The enforceable "not deaf" check: is the persisted volume above zero? */
export function isVolumeAudible(volume: number): boolean {
  return volume > 0;
}

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** Read the persisted opponent-audio volume, or `DEFAULT_VOLUME` if absent/invalid/unavailable. */
export function readVolume(): number {
  if (!hasLocalStorage()) return DEFAULT_VOLUME;
  try {
    const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampVolume(parsed) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

/** Persist the opponent-audio volume (clamped to `[0, 1]`). No-ops if storage is unavailable/full. */
export function writeVolume(volume: number): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(clampVolume(volume)));
  } catch {
    // Storage may be full or disabled (e.g. private browsing) — the volume
    // setting is a best-effort convenience; the in-memory value still gates
    // the current session's ready button correctly.
  }
}
