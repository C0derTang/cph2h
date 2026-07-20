/**
 * Route tests for src/app/api/admin/tournament/* (issue #240).
 *
 * The load-bearing invariant: `requireAdmin` runs FIRST on every route — a
 * non-admin gets 404 without the bracket-db layer ever being touched. Also
 * covers the seed guard (409/400) and walkover validation (400/409). The
 * bracket-db module is mocked at its exported functions; the pure logic is
 * exercised separately in tests/tournament-bracket.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResult } from "@/lib/race/session";
import type {
  SeedBracketResult,
  WalkoverResult,
} from "@/lib/tournament/bracket-db";

const {
  requireAdminMock,
  getBracketMock,
  seedBracketMock,
  createRacesForRoundMock,
  resolveRoundMock,
  applyWalkoverMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn<() => Promise<AdminSessionResult>>(),
  getBracketMock: vi.fn(),
  seedBracketMock: vi.fn<() => Promise<SeedBracketResult>>(),
  createRacesForRoundMock: vi.fn(),
  resolveRoundMock: vi.fn(),
  applyWalkoverMock: vi.fn<() => Promise<WalkoverResult>>(),
}));

vi.mock("@/lib/race/session", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/tournament/bracket-db", () => ({
  getBracket: getBracketMock,
  seedBracket: seedBracketMock,
  createRacesForRound: createRacesForRoundMock,
  resolveRound: resolveRoundMock,
  applyWalkover: applyWalkoverMock,
}));

import { GET as bracketGET } from "@/app/api/admin/tournament/bracket/route";
import { POST as seedPOST } from "@/app/api/admin/tournament/seed/route";
import { POST as createRacesPOST } from "@/app/api/admin/tournament/create-races/route";
import { POST as resolvePOST } from "@/app/api/admin/tournament/resolve/route";
import { POST as walkoverPOST } from "@/app/api/admin/tournament/walkover/route";

const ADMIN: AdminSessionResult = { ok: true, user: { id: "admin-1" } as never };
const NOT_ADMIN: AdminSessionResult = { ok: false, status: 404, error: "not_found" };

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/tournament", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireAdminMock.mockReset();
  getBracketMock.mockReset();
  seedBracketMock.mockReset();
  createRacesForRoundMock.mockReset();
  resolveRoundMock.mockReset();
  applyWalkoverMock.mockReset();
});

describe("admin tournament routes — non-admin gate", () => {
  beforeEach(() => requireAdminMock.mockResolvedValue(NOT_ADMIN));

  it("GET bracket 404s without calling getBracket", async () => {
    const res = await bracketGET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(getBracketMock).not.toHaveBeenCalled();
  });

  it("POST seed 404s without calling seedBracket", async () => {
    const res = await seedPOST(post({ force: true }));
    expect(res.status).toBe(404);
    expect(seedBracketMock).not.toHaveBeenCalled();
  });

  it("POST create-races 404s without calling createRacesForRound", async () => {
    const res = await createRacesPOST(post({ round: 1 }));
    expect(res.status).toBe(404);
    expect(createRacesForRoundMock).not.toHaveBeenCalled();
  });

  it("POST resolve 404s without calling resolveRound", async () => {
    const res = await resolvePOST(post({ round: 1 }));
    expect(res.status).toBe(404);
    expect(resolveRoundMock).not.toHaveBeenCalled();
  });

  it("POST walkover 404s without calling applyWalkover", async () => {
    const res = await walkoverPOST(post({ matchId: UUID_A, winnerId: UUID_B }));
    expect(res.status).toBe(404);
    expect(applyWalkoverMock).not.toHaveBeenCalled();
  });
});

describe("POST seed", () => {
  beforeEach(() => requireAdminMock.mockResolvedValue(ADMIN));

  it("returns the seed response for an admin", async () => {
    seedBracketMock.mockResolvedValue({ ok: true, data: { created: 63, byes: 16 } });
    const res = await seedPOST(post({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 63, byes: 16 });
    expect(seedBracketMock).toHaveBeenCalledWith({ force: false });
  });

  it("passes force through", async () => {
    seedBracketMock.mockResolvedValue({ ok: true, data: { created: 63, byes: 0 } });
    await seedPOST(post({ force: true }));
    expect(seedBracketMock).toHaveBeenCalledWith({ force: true });
  });

  it("maps bracket_exists to 409", async () => {
    seedBracketMock.mockResolvedValue({ ok: false, error: "bracket_exists" });
    const res = await seedPOST(post({}));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("bracket_exists");
  });

  it("maps no_registrants to 400", async () => {
    seedBracketMock.mockResolvedValue({ ok: false, error: "no_registrants" });
    const res = await seedPOST(post({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_registrants");
  });

  it("rejects a malformed body with 400 invalid_body", async () => {
    const res = await seedPOST(post({ force: "yes" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(seedBracketMock).not.toHaveBeenCalled();
  });
});

describe("POST create-races", () => {
  beforeEach(() => requireAdminMock.mockResolvedValue(ADMIN));

  it("creates races for a valid round with optional filters", async () => {
    createRacesForRoundMock.mockResolvedValue({ created: 8, skipped: 0 });
    const res = await createRacesPOST(post({ round: 2, ratingMin: 1200, ratingMax: 1600 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 8, skipped: 0 });
    expect(createRacesForRoundMock).toHaveBeenCalledWith(2, {
      ratingMin: 1200,
      ratingMax: 1600,
    });
  });

  it("400s an out-of-range round", async () => {
    const res = await createRacesPOST(post({ round: 7 }));
    expect(res.status).toBe(400);
    expect(createRacesForRoundMock).not.toHaveBeenCalled();
  });
});

describe("POST resolve", () => {
  beforeEach(() => requireAdminMock.mockResolvedValue(ADMIN));

  it("resolves a valid round", async () => {
    resolveRoundMock.mockResolvedValue({
      resolved: 4,
      advanced: 4,
      pendingRaces: 0,
      needsAttention: [],
    });
    const res = await resolvePOST(post({ round: 3 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resolved: 4,
      advanced: 4,
      pendingRaces: 0,
      needsAttention: [],
    });
    expect(resolveRoundMock).toHaveBeenCalledWith(3);
  });

  it("400s a missing round", async () => {
    const res = await resolvePOST(post({}));
    expect(res.status).toBe(400);
    expect(resolveRoundMock).not.toHaveBeenCalled();
  });
});

describe("POST walkover", () => {
  beforeEach(() => requireAdminMock.mockResolvedValue(ADMIN));

  it("applies a valid walkover", async () => {
    applyWalkoverMock.mockResolvedValue({ ok: true });
    const res = await walkoverPOST(post({ matchId: UUID_A, winnerId: UUID_B }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(applyWalkoverMock).toHaveBeenCalledWith(UUID_A, UUID_B);
  });

  it("maps invalid_winner to 400", async () => {
    applyWalkoverMock.mockResolvedValue({ ok: false, error: "invalid_winner" });
    const res = await walkoverPOST(post({ matchId: UUID_A, winnerId: UUID_B }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_winner");
  });

  it("maps match_not_pending to 409", async () => {
    applyWalkoverMock.mockResolvedValue({ ok: false, error: "match_not_pending" });
    const res = await walkoverPOST(post({ matchId: UUID_A, winnerId: UUID_B }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("match_not_pending");
  });

  it("400s a non-uuid body without calling applyWalkover", async () => {
    const res = await walkoverPOST(post({ matchId: "not-a-uuid", winnerId: UUID_B }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(applyWalkoverMock).not.toHaveBeenCalled();
  });
});
