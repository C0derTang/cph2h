"use client";

/**
 * Opponent-spotlight / self-PiP video tiles + local mic/cam toggles
 * (issue #67, superseding the equal two-up grid from #17).
 *
 * Must be rendered inside a `<LiveKitRoom>` (uses LiveKit room-context
 * hooks). The opponent dominates as a full-rail-width 16:9 spotlight tile;
 * the local player is a small PiP thumbnail docked in its corner. Which
 * track goes where — and whether either has live video right now — is
 * delegated to the pure `classifyVideoLayout` (`@/lib/race/video-layout`),
 * unit-tested independent of rendering. `RoomAudioRenderer` plays remote
 * audio; `TrackToggle` wires the local participant's mic/cam controls.
 *
 * The spotlight tile also distinguishes two "no opponent video" states:
 * "waiting to connect" (the opponent has never had a track this mount) vs
 * "disconnected" (they did, and now don't) — tracked locally since that
 * distinction needs history the pure classifier's instant-in-time view
 * can't see. This is purely a tile-level visual; race-level presence still
 * lives in RaceRoom's `PresenceWatcher` / disconnect-grace banner.
 *
 * Taunt bubble anchoring (issue #84): `selfTaunt`/`opponentTaunt` are
 * optional so callers without the taunt feature wired up (or a race with no
 * active taunt) render exactly as before. Each bubble is keyed on its
 * `sentAt` so a same-sender replacement remounts `TauntBubble` fresh,
 * restarting its pop-in + auto-dismiss timer.
 *
 * Opponent-audio volume (issue #100): `RoomAudioRenderer`'s `volume` prop is
 * driven by the persisted setting from `useOpponentVolume` (checked at
 * ready-up by the compete gate — see `Lobby.tsx`), with a matching
 * `VolumeSlider` docked beside the mic/cam toggles so it stays adjustable
 * without leaving the stage mid-race.
 */

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, UserRound, Video, VideoOff, WifiOff } from "lucide-react";
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
import { classifyVideoLayout } from "@/lib/race/video-layout";
import { TauntBubble } from "@/components/race/TauntBubble";
import { useOpponentVolume, VolumeSlider } from "@/components/race/VolumeControl";
import { AudioToggleButtons } from "@/components/race/AudioControls";
import type { TauntBubbleState } from "@/lib/race/taunts";

export interface VideoTilesProps {
  className?: string;
  /** Active taunt bubble anchored to the local player's PiP tile, if any. */
  selfTaunt?: TauntBubbleState | null;
  /** Active taunt bubble anchored to the opponent's spotlight tile, if any. */
  opponentTaunt?: TauntBubbleState | null;
  /** Fired when the self bubble's display window elapses. */
  onSelfTauntExpire?: () => void;
  /** Fired when the opponent bubble's display window elapses. */
  onOpponentTauntExpire?: () => void;
}

export function VideoTiles({
  className,
  selfTaunt,
  opponentTaunt,
  onSelfTauntExpire,
  onOpponentTauntExpire,
}: VideoTilesProps) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  );
  const { isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();
  const { volume, setVolume } = useOpponentVolume();

  const { spotlight, pip } = classifyVideoLayout(tracks);

  // The classifier only sees "now" — remember whether the opponent has EVER
  // had a track entry this mount so we can tell "waiting to connect" (never
  // seen) apart from "disconnected" (seen, then gone). VideoTiles remounts
  // fresh with each LiveKitRoom, i.e. once per race, so this resets per race.
  const everConnectedRef = useRef(false);
  const [everConnected, setEverConnected] = useState(false);
  useEffect(() => {
    if (spotlight && !everConnectedRef.current) {
      everConnectedRef.current = true;
      setEverConnected(true);
    }
  }, [spotlight]);

  const opponentName =
    (spotlight &&
      (spotlight.track.participant.name || spotlight.track.participant.identity)) ||
    null;

  return (
    <div
      data-testid="video-tiles"
      className={cn("panel flex flex-col gap-2 p-3", className)}
    >
      <RoomAudioRenderer volume={volume} />

      <div
        data-testid="opponent-tile"
        className="relative aspect-video w-full overflow-hidden rounded-[var(--radius)] bg-muted/40 ring-2 ring-player-opponent/70"
      >
        {spotlight ? (
          spotlight.live && isTrackReference(spotlight.track) ? (
            <VideoTrack
              trackRef={spotlight.track}
              className="size-full object-cover"
            />
          ) : (
            <div
              data-testid="opponent-camera-off"
              className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground"
            >
              <UserRound className="size-16" aria-hidden />
              <span className="eyebrow">
                Camera off
              </span>
            </div>
          )
        ) : everConnected ? (
          <div
            data-testid="opponent-disconnected"
            role="status"
            className="flex size-full flex-col items-center justify-center gap-2 text-destructive"
          >
            <WifiOff className="size-10" aria-hidden />
            <span className="eyebrow">
              Disconnected
            </span>
          </div>
        ) : (
          <div
            data-testid="opponent-waiting"
            role="status"
            className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground"
          >
            <UserRound className="size-16 animate-pulse" aria-hidden />
            <span className="eyebrow">
              Waiting to connect…
            </span>
          </div>
        )}

        {opponentName && (
          <span className="absolute inset-x-0 bottom-0 truncate bg-player-opponent/85 px-2 py-1 text-[11px] font-medium text-player-opponent-foreground">
            {opponentName}
          </span>
        )}

        {opponentTaunt && (
          <TauntBubble
            key={opponentTaunt.sentAt}
            tauntId={opponentTaunt.tauntId}
            anchor="opponent"
            onExpire={() => onOpponentTauntExpire?.()}
          />
        )}

        <div
          data-testid="self-tile"
          // bottom-7 (not bottom-2) so the PiP corner clears the opponent name
          // chip's full-width bottom band (~22px tall) instead of clipping its
          // colored bar underneath (PR #77 review polish note, issue #70).
          // Not itself `overflow-hidden` (unlike the visual tile inside it) so
          // the self taunt bubble — positioned `bottom-full` relative to this
          // wrapper — can pop up above the PiP without being clipped.
          className="absolute right-2 bottom-7 w-[30%] min-w-20"
        >
          <div className="relative aspect-video size-full overflow-hidden rounded-[var(--radius-sm)] bg-muted/60 shadow-lg ring-2 ring-player-self">
            {pip?.live && isTrackReference(pip.track) ? (
              <VideoTrack trackRef={pip.track} className="size-full object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center text-muted-foreground">
                <UserRound className="size-6" aria-hidden />
              </div>
            )}
            <span className="absolute inset-x-0 bottom-0 truncate bg-player-self/85 px-1 py-0.5 text-[9px] font-medium text-player-self-foreground">
              You
            </span>
          </div>

          {selfTaunt && (
            <TauntBubble
              key={selfTaunt.sentAt}
              tauntId={selfTaunt.tauntId}
              anchor="self"
              onExpire={() => onSelfTauntExpire?.()}
            />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <TrackToggle
          source={Track.Source.Microphone}
          showIcon={false}
          data-testid="toggle-mic"
          className={cn(
            "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-background text-sm font-medium transition-colors hover:bg-muted",
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
            "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-background text-sm font-medium transition-colors hover:bg-muted",
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

      <div className="flex items-center gap-2">
        <VolumeSlider
          volume={volume}
          onChange={setVolume}
          testId="volume-slider-race"
          className="flex-1"
        />
        <AudioToggleButtons testIdSuffix="race" />
      </div>
    </div>
  );
}
