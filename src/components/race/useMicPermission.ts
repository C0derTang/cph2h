"use client";

/**
 * Media-permission probe for the compete gate (issue #100, generalized to
 * cover camera in #171).
 *
 * Rendered *before* any `LiveKitRoom` exists (the Lobby is standalone — see
 * `RaceRoom.tsx`, which only mounts `LiveKitRoom` once the race is `active`),
 * so this cannot lean on LiveKit's local-participant mic/cam state. Instead
 * it talks to the browser directly:
 *
 * - Where supported, `navigator.permissions.query({ name: "microphone" | "camera" })`
 *   gives the current OS/browser permission state passively (no prompt) and
 *   an `onchange` event — the mechanism the race room uses to detect a
 *   mid-race mic revocation (grace banner only, per issue #100; never a
 *   forfeit).
 * - The explicit request (`requestMic`/`requestCam`) calls `getUserMedia`
 *   (`{ audio: true }` / `{ video: true }`), which is what actually triggers
 *   the browser's permission prompt on "prompt" state (and is the *only*
 *   signal at all in browsers without the Permissions API descriptor for
 *   that kind, e.g. older Firefox/Safari).
 *
 * A probe's track is stopped immediately after checking `readyState` — this
 * hook never holds a live mic/camera open; LiveKit acquires its own tracks
 * once connected in the race room.
 *
 * `useMediaPermission` is the shared implementation, parameterized by
 * `kind`; `useMicPermission` and `useCamPermission` are thin, kind-specific
 * wrappers so existing call sites (and the `micGranted`/`micLive`/
 * `requestMic` field names they depend on) survive unchanged.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  micGrantedFromPermissionState,
  type MicPermissionState,
} from "@/lib/race/av-requirements";

type MediaKind = "microphone" | "camera";

interface MediaPermissionInfo {
  /** Permission-API/probe-derived: access is currently granted. */
  granted: boolean;
  /** The most recent probe actually obtained a live, enabled track. */
  live: boolean;
  /** True while a `getUserMedia` probe is in flight (button loading state). */
  requesting: boolean;
  /** Raw state when known via the Permissions API; `null` if never probed / unsupported. */
  permissionState: MicPermissionState | null;
  /** False when this browser has no `getUserMedia` at all (very old/insecure context). */
  supported: boolean;
  /** Prompts for access (or silently re-verifies if already granted). */
  request: () => Promise<void>;
}

function useMediaPermission(kind: MediaKind): MediaPermissionInfo {
  const supported =
    typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  const [permissionState, setPermissionState] = useState<MicPermissionState | null>(null);
  const [live, setLive] = useState(false);
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
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === "microphone" ? { audio: true } : { video: true },
      );
      const tracks =
        kind === "microphone" ? stream.getAudioTracks() : stream.getVideoTracks();
      const track = tracks[0] ?? null;
      const isLive = track != null && track.readyState === "live" && track.enabled;
      tracks.forEach((t) => t.stop());
      if (!mountedRef.current) return;
      setLive(isLive);
      setPermissionState("granted");
    } catch (err) {
      if (!mountedRef.current) return;
      setLive(false);
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
  }, [supported, kind]);

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
        setLive(false);
      }
    };

    navigator.permissions
      .query({ name: kind })
      .then((s) => {
        if (cancelled) return;
        status = s;
        setPermissionState(s.state as MicPermissionState);
        if (s.state === "granted") void probe();
        s.addEventListener("change", handleChange);
      })
      .catch(() => {
        // This permission descriptor isn't recognized in this browser — fall
        // back entirely to the explicit request() probe.
      });

    return () => {
      cancelled = true;
      status?.removeEventListener("change", handleChange);
    };
  }, [probe, kind]);

  return {
    granted: micGrantedFromPermissionState(permissionState),
    live,
    requesting,
    permissionState,
    supported,
    request: probe,
  };
}

export interface MicPermissionInfo {
  micGranted: boolean;
  micLive: boolean;
  requesting: boolean;
  permissionState: MicPermissionState | null;
  supported: boolean;
  requestMic: () => Promise<void>;
}

export function useMicPermission(): MicPermissionInfo {
  const info = useMediaPermission("microphone");
  return {
    micGranted: info.granted,
    micLive: info.live,
    requesting: info.requesting,
    permissionState: info.permissionState,
    supported: info.supported,
    requestMic: info.request,
  };
}

export interface CamPermissionInfo {
  camGranted: boolean;
  camLive: boolean;
  requesting: boolean;
  permissionState: MicPermissionState | null;
  supported: boolean;
  requestCam: () => Promise<void>;
}

export function useCamPermission(): CamPermissionInfo {
  const info = useMediaPermission("camera");
  return {
    camGranted: info.granted,
    camLive: info.live,
    requesting: info.requesting,
    permissionState: info.permissionState,
    supported: info.supported,
    requestCam: info.request,
  };
}
