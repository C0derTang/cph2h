/**
 * Pure spotlight/PiP video-layout classifier (issue #67).
 *
 * `VideoTiles.tsx` renders the opponent as a large spotlight tile and the
 * local player as a small PiP thumbnail. This module decides *which* track
 * goes where and whether each has live video to render, independent of React
 * / LiveKit rendering so it's exhaustively unit-testable.
 *
 * Deliberately typed against a minimal structural shape rather than
 * `@livekit/components-core`'s `TrackReferenceOrPlaceholder` — tests build
 * plain objects instead of constructing real LiveKit `Participant`/`Track`
 * instances, while `VideoTiles.tsx` passes its real `useTracks()` result
 * straight through (the real type satisfies this shape structurally).
 */

export interface VideoLayoutTrack {
  participant: {
    identity: string;
    isLocal: boolean;
  };
  /**
   * Present only for a real (non-placeholder) track reference — i.e. the
   * participant has actually published this source at some point.
   * `isMuted` mirrors the publication's current mute state. Absent means
   * LiveKit gave us a placeholder: the participant is in the room but has
   * never published this source (camera left off since joining).
   */
  publication?: {
    isMuted: boolean;
  };
}

export interface VideoLayoutTile<T extends VideoLayoutTrack> {
  /** The original track reference, passed through unchanged for rendering. */
  track: T;
  /**
   * True when there is a live, unmuted track to render as video. False means
   * render a camera-off placeholder for this tile — the participant is
   * present, but has no live video right now.
   */
  live: boolean;
}

export interface VideoLayout<T extends VideoLayoutTrack> {
  /**
   * The opponent's tile. Null means no remote participant currently has a
   * track entry at all — either they haven't connected to the video room
   * yet, or they were connected and left. (Distinguishing "not yet
   * connected" from "disconnected" needs history across renders, which is
   * out of scope for this pure, instant-in-time classifier — see
   * `VideoTiles.tsx` for that state.)
   */
  spotlight: VideoLayoutTile<T> | null;
  /**
   * Your own tile. Null means the local participant has no track entry
   * (shouldn't normally happen once LiveKit has connected, but handled
   * defensively rather than assumed away).
   */
  pip: VideoLayoutTile<T> | null;
}

function isLive(track: VideoLayoutTrack): boolean {
  return track.publication != null && !track.publication.isMuted;
}

/**
 * Classify a flat camera-track list (as returned by LiveKit's `useTracks`
 * with `withPlaceholder: true`) into the opponent spotlight tile and the
 * self PiP tile. A 1v1 race room has at most one local and one remote
 * participant, so "remote" and "opponent" are synonymous here.
 */
export function classifyVideoLayout<T extends VideoLayoutTrack>(
  tracks: T[],
): VideoLayout<T> {
  const local = tracks.find((t) => t.participant.isLocal) ?? null;
  const remote = tracks.find((t) => !t.participant.isLocal) ?? null;

  return {
    spotlight: remote ? { track: remote, live: isLive(remote) } : null,
    pip: local ? { track: local, live: isLive(local) } : null,
  };
}
