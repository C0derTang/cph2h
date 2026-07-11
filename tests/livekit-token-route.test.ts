/**
 * Tests for src/app/api/livekit/token/route.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Race, User } from "../src/lib/db/schema";

const { authMock, selectMock, addGrantMock, toJwtMock, accessTokenCtor, createRoomMock, roomServiceCtor } =
  vi.hoisted(() => {
    const authMock = vi.fn();
    const selectMock = vi.fn();
    const addGrantMock = vi.fn();
    const toJwtMock = vi.fn().mockResolvedValue("mock-jwt-token");
    const accessTokenCtor = vi.fn().mockImplementation(function AccessToken() {
      return { addGrant: addGrantMock, toJwt: toJwtMock };
    });
    const createRoomMock = vi.fn().mockResolvedValue({ name: "room-1" });
    const roomServiceCtor = vi.fn().mockImplementation(function RoomServiceClient() {
      return { createRoom: createRoomMock };
    });
    return { authMock, selectMock, addGrantMock, toJwtMock, accessTokenCtor, createRoomMock, roomServiceCtor };
  });

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

vi.mock("@/lib/db", () => ({
  db: { select: selectMock },
}));

vi.mock("livekit-server-sdk", async () => {
  const actual = await vi.importActual<typeof import("livekit-server-sdk")>("livekit-server-sdk");
  return {
    ...actual,
    AccessToken: accessTokenCtor,
    RoomServiceClient: roomServiceCtor,
  };
});

import { POST } from "../src/app/api/livekit/token/route";
import { ROOM_EMPTY_TIMEOUT_SEC } from "../src/lib/livekit";

const RACE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-p1",
    clerkId: "clerk-p1",
    username: "p1",
    cfHandle: null,
    cfRating: null,
    cfLinkedAt: null,
    elo: 1200,
    racesPlayed: 0,
    cppTemplate: "",
    solveHistorySyncedAt: null,
    solveHistoryImportCursor: null,
    createdAt: null,
    isAdmin: false,
    ...overrides,
  };
}

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: RACE_ID,
    status: "active",
    challengeToken: null,
    p1Id: "user-p1",
    p2Id: "user-p2",
    p1Ready: true,
    p2Ready: true,
    problemId: null,
    timeLimitSec: 2400,
    startedAt: null,
    endsAt: null,
    finishedAt: null,
    outcome: null,
    winnerId: null,
    winningSubmissionId: null,
    eloDeltaP1: null,
    eloDeltaP2: null,
    lastPolledAt: null,
    p1LastSeenAt: null,
    p2LastSeenAt: null,
    ratingMin: null,
    ratingMax: null,
    problemDateFrom: null,
    problemDateTo: null,
    problemSelectionFailedReason: null,
    livekitRoom: "room-1",
    drawOfferBy: null,
    createdAt: null,
    ...overrides,
  };
}

/** Queue up successive `db.select()...limit()` results in call order. */
function mockSelectSequence(results: unknown[][]) {
  let i = 0;
  selectMock.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(results[i++] ?? []),
      }),
    }),
  }));
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/livekit/token", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.LIVEKIT_API_KEY = "lk-key";
  process.env.LIVEKIT_API_SECRET = "lk-secret";
  process.env.LIVEKIT_URL = "https://example.livekit.cloud";
  authMock.mockReset();
  selectMock.mockReset();
  addGrantMock.mockClear();
  toJwtMock.mockClear();
  accessTokenCtor.mockClear();
  createRoomMock.mockClear();
  roomServiceCtor.mockClear();
});

describe("POST /api/livekit/token", () => {
  it("mints a token for participant p1", async () => {
    authMock.mockResolvedValue({ isAuthenticated: true, userId: "clerk-p1" });
    mockSelectSequence([[makeUser()], [makeRace()]]);

    const res = await POST(makeRequest({ raceId: RACE_ID }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ token: "mock-jwt-token", url: "https://example.livekit.cloud" });
    expect(addGrantMock).toHaveBeenCalledWith({
      roomJoin: true,
      room: "room-1",
      canPublish: true,
      canSubscribe: true,
    });
    // Pins the empty-room timeout before the client connects (issue #121) so
    // the room self-destructs once both players leave the post-race call.
    expect(createRoomMock).toHaveBeenCalledWith({
      name: "room-1",
      emptyTimeout: ROOM_EMPTY_TIMEOUT_SEC,
    });
  });

  it("mints a token for participant p2", async () => {
    authMock.mockResolvedValue({ isAuthenticated: true, userId: "clerk-p2" });
    mockSelectSequence([
      [makeUser({ id: "user-p2", clerkId: "clerk-p2", username: "p2" })],
      [makeRace()],
    ]);

    const res = await POST(makeRequest({ raceId: RACE_ID }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token).toBe("mock-jwt-token");
  });

  it("denies a non-participant with 403 and never mints a token", async () => {
    authMock.mockResolvedValue({ isAuthenticated: true, userId: "clerk-outsider" });
    mockSelectSequence([
      [makeUser({ id: "user-outsider", clerkId: "clerk-outsider" })],
      [makeRace()],
    ]);

    const res = await POST(makeRequest({ raceId: RACE_ID }));

    expect(res.status).toBe(403);
    expect(accessTokenCtor).not.toHaveBeenCalled();
    // A non-participant must not provision the room either.
    expect(createRoomMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the caller is not authenticated", async () => {
    authMock.mockResolvedValue({ isAuthenticated: false, userId: null });

    const res = await POST(makeRequest({ raceId: RACE_ID }));

    expect(res.status).toBe(401);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body", async () => {
    authMock.mockResolvedValue({ isAuthenticated: true, userId: "clerk-p1" });

    const res = await POST(makeRequest({ raceId: "not-a-uuid" }));

    expect(res.status).toBe(400);
  });

  it("returns 404 when the race does not exist", async () => {
    authMock.mockResolvedValue({ isAuthenticated: true, userId: "clerk-p1" });
    mockSelectSequence([[makeUser()], []]);

    const res = await POST(makeRequest({ raceId: RACE_ID }));

    expect(res.status).toBe(404);
  });

  it("returns 404 when the caller has no matching user row", async () => {
    authMock.mockResolvedValue({ isAuthenticated: true, userId: "clerk-unknown" });
    mockSelectSequence([[]]);

    const res = await POST(makeRequest({ raceId: RACE_ID }));

    expect(res.status).toBe(404);
  });
});
