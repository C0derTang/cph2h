/**
 * LiveKit server integration.
 *
 * Mints room-join tokens for race participants and publishes `RaceEvent`s
 * on the shared room data channel. For every event type except `taunt`,
 * this server is the sole publisher (`RoomServiceClient.sendData` below) —
 * clients only ever *receive* them as refetch hints, they never author one.
 *
 * `taunt` events are the deliberate exception (issue #84): they're
 * ephemeral, presentational, and sent directly client-to-client, so clients
 * need `canPublishData: true` to publish them. This does mean a client
 * *could* publish a forged non-taunt `RaceEvent`. Two consumer-side guards
 * in `RaceEvents` (`src/components/race/RaceRoom.tsx`) make that harmless:
 *
 * 1. **Impersonation** — a forged taunt `byUserId` can't put words on
 *    another player's tile: the consumer trusts LiveKit's own
 *    `msg.from.identity` (assigned at token mint here, unforgeable by the
 *    client) over the payload's `byUserId` field, dropping mismatches.
 * 2. **Refetch amplification** — every non-taunt event is only ever a hint
 *    that triggers a read-only, idempotent `GET /api/races/[id]` refetch,
 *    and that path is throttled to at most one refetch per `REFETCH_MIN_MS`
 *    (leading + trailing edge, see `src/lib/race/refetch-throttle.ts`), so
 *    an opponent flooding forged events can't turn the victim's browser
 *    into a DoS amplifier against our own API — a flood collapses to
 *    ~1 refetch/sec, comparable to the existing snapshot poll cadence.
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
 * publish+subscribe. Also grants data publish (`canPublishData: true`) so
 * clients can send `taunt` `RaceEvent`s directly to each other (issue #84)
 * — see the module doc above for why that's safe.
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
    canPublishData: true,
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
 * Empty-room self-destruct timeout, in seconds (issue #121).
 *
 * A race no longer force-deletes its room the instant it finishes — both
 * players stay on the call for post-race banter until they navigate away
 * (see `src/lib/race/finish.ts`, which dropped the `deleteRoom` teardown).
 * Cleanup now falls to LiveKit reaping the room once it is empty. LiveKit
 * would auto-create the room implicitly on first join with its server-default
 * timeout, so {@link ensureRoom} pins this value explicitly up front instead
 * of relying on that default — the room self-destructs ~5 min after the last
 * participant leaves.
 */
export const ROOM_EMPTY_TIMEOUT_SEC = 300;

/**
 * Ensure a race's LiveKit room exists with an explicit {@link
 * ROOM_EMPTY_TIMEOUT_SEC} empty-room timeout, rather than letting LiveKit
 * auto-create it implicitly on first join with its server default. Called
 * before minting a join token so the timeout is pinned before anyone
 * connects. `createRoom` is get-or-create — it returns the existing room if
 * one is already present — so this is safe to call on every token mint.
 * Best-effort: swallow errors so a pre-provisioning hiccup never blocks a
 * token mint (LiveKit would still auto-create the room on join).
 */
export async function ensureRoom(room: string): Promise<void> {
  try {
    const client = getRoomServiceClient();
    await client.createRoom({ name: room, emptyTimeout: ROOM_EMPTY_TIMEOUT_SEC });
  } catch (err) {
    console.error(`[livekit] ensureRoom failed for room "${room}"`, err);
  }
}

/**
 * Delete a LiveKit room. Retained as a utility (e.g. administrative cleanup)
 * but no longer called at race finish (issue #121) — finished races keep the
 * call alive for post-race banter and rely on {@link ROOM_EMPTY_TIMEOUT_SEC}
 * for cleanup once empty. Best-effort: swallow errors so cleanup failures
 * never surface to callers.
 */
export async function deleteRoom(room: string): Promise<void> {
  try {
    const client = getRoomServiceClient();
    await client.deleteRoom(room);
  } catch (err) {
    console.error(`[livekit] deleteRoom failed for room "${room}"`, err);
  }
}
