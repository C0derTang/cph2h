/**
 * Tests for src/lib/livekit.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendDataMock, deleteRoomMock, roomServiceClientCtor, addGrantMock, toJwtMock, accessTokenCtor } =
  vi.hoisted(() => {
    const sendDataMock = vi.fn().mockResolvedValue(undefined);
    const deleteRoomMock = vi.fn().mockResolvedValue(undefined);
    const roomServiceClientCtor = vi.fn().mockImplementation(function RoomServiceClient() {
      return { sendData: sendDataMock, deleteRoom: deleteRoomMock };
    });
    const addGrantMock = vi.fn();
    const toJwtMock = vi.fn().mockResolvedValue("mock-jwt-token");
    const accessTokenCtor = vi.fn().mockImplementation(function AccessToken() {
      return { addGrant: addGrantMock, toJwt: toJwtMock };
    });
    return {
      sendDataMock,
      deleteRoomMock,
      roomServiceClientCtor,
      addGrantMock,
      toJwtMock,
      accessTokenCtor,
    };
  });

vi.mock("livekit-server-sdk", async () => {
  const actual = await vi.importActual<typeof import("livekit-server-sdk")>("livekit-server-sdk");
  return {
    ...actual,
    RoomServiceClient: roomServiceClientCtor,
    AccessToken: accessTokenCtor,
  };
});

import { DataPacket_Kind } from "livekit-server-sdk";
import { mintToken, publishRaceEvent, deleteRoom } from "../src/lib/livekit";
import { LIVEKIT_DATA_TOPIC, decodeRaceEvent, type RaceEvent } from "../src/lib/types";

beforeEach(() => {
  process.env.LIVEKIT_URL = "https://example.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "lk-key";
  process.env.LIVEKIT_API_SECRET = "lk-secret";
  sendDataMock.mockClear();
  deleteRoomMock.mockClear();
  roomServiceClientCtor.mockClear();
  addGrantMock.mockClear();
  toJwtMock.mockClear();
  accessTokenCtor.mockClear();
});

describe("mintToken", () => {
  it("grants roomJoin + publish/subscribe + data publish (taunts, issue #84)", async () => {
    const token = await mintToken({ room: "room-1", identity: "user-1", name: "Alice" });

    expect(token).toBe("mock-jwt-token");
    expect(accessTokenCtor).toHaveBeenCalledWith("lk-key", "lk-secret", {
      identity: "user-1",
      name: "Alice",
    });
    expect(addGrantMock).toHaveBeenCalledWith({
      roomJoin: true,
      room: "room-1",
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    expect(toJwtMock).toHaveBeenCalledTimes(1);
  });
});

describe("publishRaceEvent", () => {
  it("sends the encoded event reliably on the race data topic", async () => {
    const event: RaceEvent = { type: "aborted", byUserId: "user-1" };

    await publishRaceEvent("room-1", event);

    expect(roomServiceClientCtor).toHaveBeenCalledWith(
      "https://example.livekit.cloud",
      "lk-key",
      "lk-secret"
    );
    expect(sendDataMock).toHaveBeenCalledTimes(1);
    const [room, data, kind, options] = sendDataMock.mock.calls[0];
    expect(room).toBe("room-1");
    expect(decodeRaceEvent(data)).toEqual(event);
    expect(kind).toBe(DataPacket_Kind.RELIABLE);
    expect(options).toEqual({ topic: LIVEKIT_DATA_TOPIC });
  });

  it("is best-effort: swallows errors instead of throwing", async () => {
    sendDataMock.mockRejectedValueOnce(new Error("room not found"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      publishRaceEvent("missing-room", { type: "aborted", byUserId: "user-1" })
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("deleteRoom", () => {
  it("calls RoomServiceClient.deleteRoom with the room name", async () => {
    await deleteRoom("room-1");
    expect(deleteRoomMock).toHaveBeenCalledWith("room-1");
  });

  it("is best-effort: swallows errors instead of throwing", async () => {
    deleteRoomMock.mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(deleteRoom("room-1")).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
