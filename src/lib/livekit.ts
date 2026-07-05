/**
 * LiveKit server integration.
 *
 * Mints room-join tokens for race participants and publishes `RaceEvent`s
 * on the shared room data channel. Clients always get `canPublishData:
 * false` — only this server ever calls `RoomServiceClient.sendData`, so
 * clients cannot spoof race events (see `src/lib/types.ts`).
 */

import { AccessToken, DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";
import { encodeRaceEvent, LIVEKIT_DATA_TOPIC, type RaceEvent } from "@/lib/types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function getRoomServiceClient(): RoomServiceClient {
  return new RoomServiceClient(
    requireEnv("LIVEKIT_URL"),
    requireEnv("LIVEKIT_API_KEY"),
    requireEnv("LIVEKIT_API_SECRET")
  );
}

export interface MintTokenParams {
  /** LiveKit room name — race.livekitRoom. */
  room: string;
  /** Participant identity — our internal user id. */
  identity: string;
  /** Display name shown to other participants. */
  name: string;
}

/**
 * Mint a join token for a race participant. Grants audio/video
 * publish+subscribe but never data publish — the server is the sole
 * publisher of `RaceEvent`s on the room's data channel.
 */
export async function mintToken({ room, identity, name }: MintTokenParams): Promise<string> {
  const at = new AccessToken(requireEnv("LIVEKIT_API_KEY"), requireEnv("LIVEKIT_API_SECRET"), {
    identity,
    name,
  });
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });
  return at.toJwt();
}

/**
 * Publish a `RaceEvent` to a room's `LIVEKIT_DATA_TOPIC` data channel.
 * Best-effort: events are hints and clients refetch on anything they can't
 * apply, so a missing room (e.g. no participant has joined yet) or a
 * transient LiveKit error is not fatal to the caller — log and continue.
 */
export async function publishRaceEvent(room: string, event: RaceEvent): Promise<void> {
  try {
    const client = getRoomServiceClient();
    await client.sendData(room, encodeRaceEvent(event), DataPacket_Kind.RELIABLE, {
      topic: LIVEKIT_DATA_TOPIC,
    });
  } catch (err) {
    console.error(`[livekit] publishRaceEvent failed for room "${room}"`, err);
  }
}

/**
 * Delete a LiveKit room, e.g. cleanup after a race finishes or is aborted.
 * Best-effort: swallow errors so cleanup failures never surface to callers.
 */
export async function deleteRoom(room: string): Promise<void> {
  try {
    const client = getRoomServiceClient();
    await client.deleteRoom(room);
  } catch (err) {
    console.error(`[livekit] deleteRoom failed for room "${room}"`, err);
  }
}
