"use client";

/**
 * Microphone-permission probe for the compete gate (issue #100).
 *
 * Rendered *before* any `LiveKitRoom` exists (the Lobby is standalone — see
 * `RaceRoom.tsx`, which only mounts `LiveKitRoom` once the race is `active`),
 * so this cannot lean on LiveKit's local-participant mic state. Instead it
 * talks to the browser directly:
 *
 * - Where supported, `navigator.permissions.query({ name: "microphone" })`
 *   gives the current OS/browser permission state passively (no prompt) and
 *   an `onchange` event — the mechanism the race room uses to detect a
 *   mid-race revocation (grace banner only, per the issue; never a forfeit).
 * - `requestMic()` calls `getUserMedia({ audio: true })`, which is what
 *   actually triggers the browser's permission prompt on "prompt" state (and
 *   is the *only* signal at all in browsers without the Permissions API
 *   "microphone" descriptor, e.g. older Firefox/Safari).
 *
 * A probe's track is stopped immediately after checking `readyState` — this
 * hook never holds a live mic open; LiveKit acquires its own track once
 * connected in the race room.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  micGrantedFromPermissionState,
  type MicPermissionState,
} from "@/lib/race/av-requirements";

export interface MicPermissionInfo {
  /** Permission-API/probe-derived: mic access is currently granted. */
  micGranted: boolean;
  /** The most recent probe actually obtained a live, enabled audio track. */
  micLive: boolean;
  /** True while a `getUserMedia` probe is in flight (button loading state). */
  requesting: boolean;
  /** Raw state when known via the Permissions API; `null` if never probed / unsupported. */
  permissionState: MicPermissionState | null;
  /** False when this browser has no `getUserMedia` at all (very old/insecure context). */
  supported: boolean;
  /** Prompts for mic access (or silently re-verifies if already granted). */
  requestMic: () => Promise<void>;
}

export function useMicPermission(): MicPermissionInfo {
  const supported =
    typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  const [permissionState, setPermissionState] = useState<MicPermissionState | null>(null);
  const [micLive, setMicLive] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const probe = useCallback(async () => {
    if (!supported) return;
    setRequesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0] ?? null;
      const live = track != null && track.readyState === "live" && track.enabled;
      stream.getAudioTracks().forEach((t) => t.stop());
      if (!mountedRef.current) return;
      setMicLive(live);
      setPermissionState("granted");
    } catch (err) {
      if (!mountedRef.current) return;
      setMicLive(false);
      const name = err instanceof DOMException ? err.name : "";
      // NotAllowedError (Chromium) / PermissionDeniedError (older Firefox) —
      // anything else (NotFoundError: no device, etc.) is treated as "still
      // needs a prompt/retry" rather than a hard denial.
      setPermissionState(
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "denied"
          : "prompt",
      );
    } finally {
      if (mountedRef.current) setRequesting(false);
    }
  }, [supported]);

  // Passive Permissions-API probe: reflects current state without prompting,
  // and subscribes to `onchange` so a revocation mid-race is caught live.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let cancelled = false;
    let status: PermissionStatus | null = null;

    const handleChange = () => {
      if (!status) return;
      setPermissionState(status.state as MicPermissionState);
      if (status.state === "granted") {
        void probe();
      } else {
        setMicLive(false);
      }
    };

    navigator.permissions
      .query({ name: "microphone" })
      .then((s) => {
        if (cancelled) return;
        status = s;
        setPermissionState(s.state as MicPermissionState);
        if (s.state === "granted") void probe();
        s.addEventListener("change", handleChange);
      })
      .catch(() => {
        // "microphone" isn't a recognized permission descriptor in this
        // browser — fall back entirely to the explicit requestMic() probe.
      });

    return () => {
      cancelled = true;
      status?.removeEventListener("change", handleChange);
    };
  }, [probe]);

  return {
    micGranted: micGrantedFromPermissionState(permissionState),
    micLive,
    requesting,
    permissionState,
    supported,
    requestMic: probe,
  };
}
