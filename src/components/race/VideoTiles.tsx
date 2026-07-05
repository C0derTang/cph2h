"use client";

/**
 * Two-up participant video tiles + local mic/cam toggles (issue #17).
 *
 * Must be rendered inside a `<LiveKitRoom>` (uses LiveKit room-context hooks).
 * Renders one tile per camera track (with a placeholder tile for participants
 * whose camera is off), plus a control bar wired to the local participant's
 * microphone and camera. `RoomAudioRenderer` plays remote audio.
 */

import { Mic, MicOff, UserRound, Video, VideoOff } from "lucide-react";
import { Track } from "livekit-client";
import {
  RoomAudioRenderer,
  TrackToggle,
  VideoTrack,
  isTrackReference,
  useLocalParticipant,
  useTracks,
} from "@livekit/components-react";

import { cn } from "@/lib/utils";

export function VideoTiles({ className }: { className?: string }) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  );
  const { isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();

  return (
    <div
      data-testid="video-tiles"
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-card/40 p-3",
        className,
      )}
    >
      <RoomAudioRenderer />

      <div className="grid grid-cols-2 gap-2">
        {tracks.map((trackRef) => {
          const participant = trackRef.participant;
          const name = participant.name || participant.identity || "Player";
          const live = isTrackReference(trackRef) && !trackRef.publication?.isMuted;
          return (
            <div
              key={`${participant.identity}-${trackRef.source}`}
              className="relative aspect-video overflow-hidden rounded-lg border border-border bg-muted/40"
            >
              {live ? (
                <VideoTrack
                  trackRef={trackRef}
                  className="size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground">
                  <UserRound className="size-8" aria-hidden />
                </div>
              )}
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-2 py-1 text-[11px] font-medium text-white">
                {name}
                {participant.isLocal ? " (you)" : ""}
              </span>
            </div>
          );
        })}
        {tracks.length === 0 && (
          <div className="col-span-2 flex aspect-video items-center justify-center rounded-lg border border-border bg-muted/40 text-xs text-muted-foreground">
            Connecting video…
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <TrackToggle
          source={Track.Source.Microphone}
          showIcon={false}
          data-testid="toggle-mic"
          className={cn(
            "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-sm font-medium transition-colors hover:bg-muted",
            !isMicrophoneEnabled && "text-destructive",
          )}
        >
          {isMicrophoneEnabled ? (
            <Mic className="size-4" aria-hidden />
          ) : (
            <MicOff className="size-4" aria-hidden />
          )}
          {isMicrophoneEnabled ? "Mic" : "Muted"}
        </TrackToggle>
        <TrackToggle
          source={Track.Source.Camera}
          showIcon={false}
          data-testid="toggle-cam"
          className={cn(
            "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-sm font-medium transition-colors hover:bg-muted",
            !isCameraEnabled && "text-destructive",
          )}
        >
          {isCameraEnabled ? (
            <Video className="size-4" aria-hidden />
          ) : (
            <VideoOff className="size-4" aria-hidden />
          )}
          {isCameraEnabled ? "Camera" : "Camera off"}
        </TrackToggle>
      </div>
    </div>
  );
}
