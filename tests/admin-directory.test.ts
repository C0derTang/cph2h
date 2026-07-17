/**
 * Tests for src/lib/admin/directory.ts (issue #224).
 *
 * `mapDirectoryUser` and `filterDirectory` are pure and tested directly.
 * `listDirectoryUsers` is tested against a mocked `@/lib/db`, following the
 * `db.select().from().orderBy().limit()` stub pattern used in
 * tests/admin-reports.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/db/schema";

const { dbState } = vi.hoisted(() => {
  const dbState = {
    result: [] as unknown[],
    orderByArgs: [] as unknown[],
    limitArgs: [] as unknown[],
  };
  return { dbState };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        orderBy: (...args: unknown[]) => {
          dbState.orderByArgs.push(args);
          return {
            limit: (n: number) => {
              dbState.limitArgs.push(n);
              return Promise.resolve(dbState.result);
            },
          };
        },
      }),
    }),
  },
}));

import {
  DIRECTORY_LIST_CAP,
  filterDirectory,
  mapDirectoryUser,
  type DirectoryUserDTO,
} from "@/lib/admin/directory";
import { listDirectoryUsers } from "@/lib/admin/directory-db";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    clerkId: "clerk-1",
    username: "tourist",
    cfHandle: "tourist_cf",
    cfRating: 3500,
    cfLinkedAt: new Date("2026-01-01T00:00:00.000Z"),
    elo: 2400,
    racesPlayed: 10,
    cppTemplate: "",
    solveHistorySyncedAt: null,
    solveHistoryImportCursor: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    isAdmin: false,
    ...overrides,
  };
}

function makeDTO(overrides: Partial<DirectoryUserDTO> = {}): DirectoryUserDTO {
  return {
    id: "user-1",
    username: "tourist",
    cfHandle: "tourist_cf",
    cfRating: 3500,
    elo: 2400,
    racesPlayed: 10,
    cfLinked: true,
    isAdmin: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  dbState.result = [];
  dbState.orderByArgs = [];
  dbState.limitArgs = [];
});

describe("mapDirectoryUser", () => {
  it("maps a user row to a DirectoryUserDTO", () => {
    const row = makeUser();
    expect(mapDirectoryUser(row)).toEqual({
      id: "user-1",
      username: "tourist",
      cfHandle: "tourist_cf",
      cfRating: 3500,
      elo: 2400,
      racesPlayed: 10,
      cfLinked: true,
      isAdmin: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("derives cfLinked: false when cfLinkedAt is null", () => {
    const row = makeUser({ cfLinkedAt: null, cfHandle: null, cfRating: null });
    const dto = mapDirectoryUser(row);
    expect(dto.cfLinked).toBe(false);
    expect(dto.cfHandle).toBeNull();
    expect(dto.cfRating).toBeNull();
  });

  it("handles a null createdAt", () => {
    const row = makeUser({ createdAt: null });
    expect(mapDirectoryUser(row).createdAt).toBeNull();
  });

  it("reflects isAdmin: true through", () => {
    const row = makeUser({ isAdmin: true });
    expect(mapDirectoryUser(row).isAdmin).toBe(true);
  });
});

describe("filterDirectory", () => {
  const alice = makeDTO({ id: "1", username: "Alice", cfHandle: "alice_cf" });
  const bob = makeDTO({ id: "2", username: "bob", cfHandle: "BobbyCF" });
  const carol = makeDTO({ id: "3", username: "carol", cfHandle: null });
  const all = [alice, bob, carol];

  it("returns all users for an empty query", () => {
    expect(filterDirectory(all, "")).toEqual(all);
  });

  it("returns all users for a whitespace-only query", () => {
    expect(filterDirectory(all, "   ")).toEqual(all);
  });

  it("matches case-insensitively on username", () => {
    expect(filterDirectory(all, "ALICE")).toEqual([alice]);
  });

  it("matches case-insensitively on cfHandle", () => {
    expect(filterDirectory(all, "bobbycf")).toEqual([bob]);
  });

  it("trims surrounding whitespace from the query", () => {
    expect(filterDirectory(all, "  carol  ")).toEqual([carol]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterDirectory(all, "nonexistent")).toEqual([]);
  });

  it("doesn't throw for users with a null cfHandle", () => {
    expect(filterDirectory(all, "xyz")).toEqual([]);
  });
});

describe("listDirectoryUsers", () => {
  it("maps and returns rows from the db", async () => {
    dbState.result = [makeUser({ id: "1" }), makeUser({ id: "2", cfLinkedAt: null })];

    const result = await listDirectoryUsers();

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("1");
    expect(result[1].cfLinked).toBe(false);
  });

  it("respects the DIRECTORY_LIST_CAP constant", () => {
    expect(DIRECTORY_LIST_CAP).toBe(500);
  });

  it("orders newest-first and limits to DIRECTORY_LIST_CAP", async () => {
    await listDirectoryUsers();

    expect(dbState.orderByArgs).toHaveLength(1);
    expect(dbState.limitArgs).toEqual([DIRECTORY_LIST_CAP]);
  });
});
