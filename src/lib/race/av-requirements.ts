/**
 * Pure compete-gate rules (issue #100, extended by #171): "you can't compete
 * muted or invisible."
 *
 * The enforceable requirements are a live microphone track and a live camera
 * track, both with permission granted. Enforcement is client-side only — the
 * ready button is gated, the API is not (see issue #100's "Reality
 * constraint"). Opponent audio is always played at full volume — issue #171
 * removed the in-app mute/attenuate control entirely, so there is no
 * volume preference to model here.
 *
 * This module holds the state model + predicate, both pure and unit-tested
 * here.
 */

/** Everything the compete gate needs to know to decide `canCompete`. */
export interface AvRequirementState {
  /** Microphone permission is granted (not "prompt" / "denied"). */
  micGranted: boolean;
  /** A live (unmuted, actually producing audio) local microphone track. */
  micLive: boolean;
  /** Camera permission is granted (not "prompt" / "denied"). */
  camGranted: boolean;
  /** A live (unblocked, actually producing video) local camera track. */
  camLive: boolean;
}

/** Convenience default — every requirement unmet, as at first mount. */
export const UNMET_AV_REQUIREMENTS: AvRequirementState = {
  micGranted: false,
  micLive: false,
  camGranted: false,
  camLive: false,
};

/**
 * Ready-to-compete iff mic AND camera permission are both granted AND both
 * tracks are live. All four are required — a granted-but-not-live device
 * (e.g. the OS device vanished, or a webcam got unplugged) must still block.
 */
export function canCompete(state: AvRequirementState): boolean {
  return state.micGranted && state.micLive && state.camGranted && state.camLive;
}

// ---------------------------------------------------------------------------
// Permission-state mapping
// ---------------------------------------------------------------------------

/** The subset of the DOM `PermissionState` union this module cares about. */
export type MicPermissionState = "granted" | "denied" | "prompt";

/**
 * `navigator.permissions` (or a getUserMedia probe outcome) -> granted.
 * Shared by both the mic and camera probes (`useMicPermission`/
 * `useCamPermission` in `src/components/race/useMicPermission.ts`).
 */
export function micGrantedFromPermissionState(
  state: MicPermissionState | null,
): boolean {
  return state === "granted";
}
