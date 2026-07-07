/**
 * Pure "keep the post-race call mounted" decision (issue #121).
 *
 * After a race finishes the voice/video call must NOT end — both players stay
 * connected on the result screen for post-race banter until one navigates
 * home. The `<LiveKitRoom>` element therefore has to persist across the
 * `active → finished|aborted` UI transition WITHOUT unmounting (an unmount
 * disconnects and reconnects, a visible blip).
 *
 * The load-bearing distinction: a client that *observed the race while it was
 * active* keeps the call on the result screen; a client that *direct-loaded an
 * already-finished race* must never connect at all (there was no live call to
 * preserve, and per spec no token is even fetched). We capture "did this client
 * ever see the race active while mounted" as a single monotonic boolean and
 * pair it with the terminal status here.
 *
 * Kept pure (no React) so the rule is unit-tested in isolation, mirroring
 * `detectOverlayOutcome` in `overlay.ts`.
 */

import type { RaceStatus } from "@/lib/types";

/**
 * Should the LiveKit call stay mounted on the result screen?
 *
 * @param everSawActive Whether this client has observed the race in the
 *   `active` state at any point while mounted (monotonic latch — a direct load
 *   onto a finished race never sees `active`, so this stays `false`).
 * @param status        The current race status.
 *
 * Returns `true` only for a terminal race (`finished`/`aborted`) that this
 * client watched go live — i.e. keep the existing connection alive. Any
 * non-terminal status returns `false` (the active race renders the call
 * through its own branch), as does a terminal race that was never observed
 * active (direct load → plain result, no connection).
 */
export function shouldKeepCallMounted(
  everSawActive: boolean,
  status: RaceStatus,
): boolean {
  if (!everSawActive) return false;
  return status === "finished" || status === "aborted";
}
