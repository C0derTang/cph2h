/**
 * Permission-state mapping for the optional lobby cam/mic prompt (issue
 * #100, extended by #171, made optional by #299).
 *
 * Camera and microphone are no longer required to compete — the hard
 * `canCompete` gate that used to block the "I'm ready" button was removed.
 * This module now only maps a raw `PermissionState` (or getUserMedia probe
 * outcome) to a simple granted/not-granted boolean, shared by the mic and
 * camera probes (`useMicPermission`/`useCamPermission` in
 * `src/components/race/useMicPermission.ts`) that back the lobby's optional
 * "Camera & mic" checklist.
 */

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
