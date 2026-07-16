/**
 * Tests for src/lib/admin/registrants.ts (issue #221).
 *
 * `mapRegistrantRow` is pure and tested directly. `listRegistrants` is
 * tested against a mocked `@/lib/db`, following the same
 * `db.select().from().where()...` stub pattern as tests/admin-reports.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TournamentRegistration, User } from "@/lib/db/schema";

const { dbState } = vi.hoisted(() => {
  const dbState = {
    selectResults: [] as unknown[][],
    selectIndex: 0,
  };
  return { dbState };
});

function makeSelectResult() {
  const getResult = () => dbState.selectResults[dbState.selectIndex++] ?? [];
  return {
    where: () => Promise.resolve(getResult()),
    orderBy: () => Promise.resolve(getResult()),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(getResult()).then(resolve, reject),
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => makeSelectResult(),
    }),
  },
}));

import { listRegistrants, mapRegistrantRow } from "@/lib/admin/registrants";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    clerkId: "clerk-1",
    username: "tourist",
    cfHandle: "tourist_cf",
    cfRating: 3500,
    cfLinkedAt: new Date(),
    elo: 2400,
    racesPlayed: 10,
    cppTemplate: "",
    solveHistorySyncedAt: null,
    solveHistoryImportCursor: null,
    createdAt: null,
    isAdmin: false,
    ...overrides,
  };
}

function makeRegistration(
  overrides: Partial<TournamentRegistration> = {},
): TournamentRegistration {
  return {
    userId: "user-1",
    githubUrl: "https://github.com/tourist",
    linkedinUrl: "https://linkedin.com/in/tourist",
    termsAcceptedAt: new Date("2026-07-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:05:00.000Z"),
    updatedAt: new Date("2026-07-01T00:05:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  dbState.selectResults = [];
  dbState.selectIndex = 0;
});

describe("mapRegistrantRow", () => {
  it("maps a registration row + user to a RegistrantDTO", () => {
    const reg = makeRegistration();
    const user = makeUser();

    expect(mapRegistrantRow(reg, user)).toEqual({
      userId: "user-1",
      username: "tourist",
      cfHandle: "tourist_cf",
      cfRating: 3500,
      githubUrl: "https://github.com/tourist",
      linkedinUrl: "https://linkedin.com/in/tourist",
      termsAcceptedAt: "2026-07-01T00:00:00.000Z",
      registeredAt: "2026-07-01T00:05:00.000Z",
    });
  });

  it("falls back to an 'unknown' username placeholder when the user row is missing", () => {
    const reg = makeRegistration({ userId: "user-deleted" });

    expect(mapRegistrantRow(reg, undefined)).toEqual({
      userId: "user-deleted",
      username: "unknown",
      cfHandle: null,
      cfRating: null,
      githubUrl: "https://github.com/tourist",
      linkedinUrl: "https://linkedin.com/in/tourist",
      termsAcceptedAt: "2026-07-01T00:00:00.000Z",
      registeredAt: "2026-07-01T00:05:00.000Z",
    });
  });

  it("passes through null githubUrl/linkedinUrl unchanged", () => {
    const reg = makeRegistration({ githubUrl: null, linkedinUrl: null });
    const dto = mapRegistrantRow(reg, makeUser());
    expect(dto.githubUrl).toBeNull();
    expect(dto.linkedinUrl).toBeNull();
  });

  it("serializes termsAcceptedAt and registeredAt as ISO strings", () => {
    const reg = makeRegistration({
      termsAcceptedAt: new Date("2026-01-15T12:30:00.000Z"),
      createdAt: new Date("2026-02-20T08:00:00.000Z"),
    });
    const dto = mapRegistrantRow(reg, makeUser());
    expect(dto.termsAcceptedAt).toBe("2026-01-15T12:30:00.000Z");
    expect(dto.registeredAt).toBe("2026-02-20T08:00:00.000Z");
  });
});

describe("listRegistrants", () => {
  it("returns [] without querying users when there are no registrations", async () => {
    dbState.selectResults = [[]];
    const result = await listRegistrants();
    expect(result).toEqual([]);
  });

  it("batch-resolves users and falls back to a placeholder for a missing row", async () => {
    const reg1 = makeRegistration({ userId: "user-1" });
    const reg2 = makeRegistration({ userId: "user-2" });
    const user1 = makeUser({ id: "user-1", username: "tourist" });
    // user-2's row is deliberately missing from the users select.
    dbState.selectResults = [[reg1, reg2], [user1]];

    const result = await listRegistrants();

    expect(result).toHaveLength(2);
    expect(result[0].username).toBe("tourist");
    expect(result[1]).toEqual(
      expect.objectContaining({ userId: "user-2", username: "unknown" }),
    );
  });
});
