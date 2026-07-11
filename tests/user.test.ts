/**
 * Tests for src/lib/user.ts (issue #48).
 *
 * `ensureUser` is the single place that provisions a `users` row for a
 * signed-in Clerk identity — it must never leave a genuinely signed-in user
 * without a row (dead-ending them with "User not found"), and it must be
 * safe under a concurrent insert race. `@clerk/nextjs/server` and `@/lib/db`
 * are mocked at the call shapes the module uses, following the pattern in
 * tests/cf-link-route.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/db/schema";

const { authMock, currentUserMock, selectMock, insertValuesMock, insertOnConflictMock } =
  vi.hoisted(() => {
    const insertOnConflictMock = vi.fn();
    const insertValuesMock = vi.fn(() => ({ onConflictDoNothing: insertOnConflictMock }));
    return {
      authMock: vi.fn(),
      currentUserMock: vi.fn(),
      selectMock: vi.fn(),
      insertValuesMock,
      insertOnConflictMock,
    };
  });

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  currentUser: currentUserMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: selectMock,
    insert: vi.fn(() => ({ values: insertValuesMock })),
  },
}));

import { ensureUser } from "@/lib/user";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    clerkId: "clerk-1",
    username: "tourist",
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

/**
 * Queue up successive `db.select()...where()...limit(1)` results in call
 * order. The returned value is thenable *and* exposes `.limit()` so it
 * matches `ensureUser`'s `.where(...).limit(1)` call shape.
 */
function mockSelectSequence(results: unknown[][]) {
  let i = 0;
  selectMock.mockImplementation(() => ({
    from: () => ({
      where: () => {
        const result = results[i++] ?? [];
        return {
          limit: () => Promise.resolve(result),
          then: (resolve: (value: unknown) => void) => resolve(result),
        };
      },
    }),
  }));
}

beforeEach(() => {
  authMock.mockReset();
  currentUserMock.mockReset();
  selectMock.mockReset();
  insertValuesMock.mockClear();
  insertOnConflictMock.mockReset().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
});

describe("ensureUser", () => {
  it("returns null when there is no signed-in Clerk user", async () => {
    authMock.mockResolvedValue({ userId: null });

    const result = await ensureUser();

    expect(result).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns the existing row without inserting when one is found", async () => {
    authMock.mockResolvedValue({ userId: "clerk-1" });
    const existing = makeUser();
    mockSelectSequence([[existing]]);

    const result = await ensureUser();

    expect(result).toEqual(existing);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("creates a row deriving the username from Clerk when none exists", async () => {
    authMock.mockResolvedValue({ userId: "clerk-new" });
    currentUserMock.mockResolvedValue({
      username: "cool_coder",
      firstName: "Cool",
      emailAddresses: [{ emailAddress: "cool@example.com" }],
    });
    mockSelectSequence([[]]); // no existing row
    const created = makeUser({ clerkId: "clerk-new", username: "cool_coder" });
    insertOnConflictMock.mockReturnValue({ returning: vi.fn().mockResolvedValue([created]) });

    const result = await ensureUser();

    expect(result).toEqual(created);
    expect(insertValuesMock).toHaveBeenCalledWith({
      clerkId: "clerk-new",
      username: "cool_coder",
    });
  });

  it("re-selects the winner when a concurrent insert wins the race", async () => {
    authMock.mockResolvedValue({ userId: "clerk-race" });
    currentUserMock.mockResolvedValue({
      username: null,
      firstName: "Racer",
      emailAddresses: [],
    });
    const winner = makeUser({ clerkId: "clerk-race", username: "Racer" });
    // First select: no existing row. Second select (after losing the
    // insert race): the row a concurrent request created.
    mockSelectSequence([[], [winner]]);
    // onConflictDoNothing().returning() comes back empty — this insert lost.
    insertOnConflictMock.mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });

    const result = await ensureUser();

    expect(result).toEqual(winner);
    expect(selectMock).toHaveBeenCalledTimes(2);
  });

  it("derives username precedence: username > firstName > email > default", async () => {
    authMock.mockResolvedValue({ userId: "clerk-a" });
    mockSelectSequence([[]]);
    insertOnConflictMock.mockReturnValue({ returning: vi.fn().mockResolvedValue([makeUser()]) });

    currentUserMock.mockResolvedValue({
      username: "has-username",
      firstName: "First",
      emailAddresses: [{ emailAddress: "a@example.com" }],
    });
    await ensureUser();
    expect(insertValuesMock).toHaveBeenLastCalledWith({
      clerkId: "clerk-a",
      username: "has-username",
    });
  });

  it("falls back to firstName when username is absent", async () => {
    authMock.mockResolvedValue({ userId: "clerk-b" });
    mockSelectSequence([[]]);
    insertOnConflictMock.mockReturnValue({ returning: vi.fn().mockResolvedValue([makeUser()]) });

    currentUserMock.mockResolvedValue({
      username: null,
      firstName: "First",
      emailAddresses: [{ emailAddress: "b@example.com" }],
    });
    await ensureUser();
    expect(insertValuesMock).toHaveBeenLastCalledWith({
      clerkId: "clerk-b",
      username: "First",
    });
  });

  it("falls back to the email local part (never the full email) when username and firstName are absent", async () => {
    authMock.mockResolvedValue({ userId: "clerk-c" });
    mockSelectSequence([[]]);
    insertOnConflictMock.mockReturnValue({ returning: vi.fn().mockResolvedValue([makeUser()]) });

    currentUserMock.mockResolvedValue({
      username: null,
      firstName: null,
      emailAddresses: [{ emailAddress: "c@example.com" }],
    });
    await ensureUser();
    expect(insertValuesMock).toHaveBeenLastCalledWith({
      clerkId: "clerk-c",
      username: "c_",
    });
  });

  it("truncates a long email local part to 20 characters", async () => {
    authMock.mockResolvedValue({ userId: "clerk-long" });
    mockSelectSequence([[]]);
    insertOnConflictMock.mockReturnValue({ returning: vi.fn().mockResolvedValue([makeUser()]) });

    currentUserMock.mockResolvedValue({
      username: null,
      firstName: null,
      emailAddresses: [
        { emailAddress: "this.is.a.very.long.local.part@example.com" },
      ],
    });
    await ensureUser();
    expect(insertValuesMock).toHaveBeenLastCalledWith({
      clerkId: "clerk-long",
      username: "this.is.a.very.long.",
    });
  });

  it("falls back to a default username when Clerk has nothing usable", async () => {
    authMock.mockResolvedValue({ userId: "clerk-d" });
    mockSelectSequence([[]]);
    insertOnConflictMock.mockReturnValue({ returning: vi.fn().mockResolvedValue([makeUser()]) });

    currentUserMock.mockResolvedValue({
      username: null,
      firstName: null,
      emailAddresses: [],
    });
    await ensureUser();
    expect(insertValuesMock).toHaveBeenLastCalledWith({
      clerkId: "clerk-d",
      username: "racer",
    });
  });

  it("falls back to the default username when currentUser() throws", async () => {
    authMock.mockResolvedValue({ userId: "clerk-e" });
    mockSelectSequence([[]]);
    insertOnConflictMock.mockReturnValue({ returning: vi.fn().mockResolvedValue([makeUser()]) });

    currentUserMock.mockRejectedValue(new Error("Clerk backend unavailable"));
    await ensureUser();
    expect(insertValuesMock).toHaveBeenLastCalledWith({
      clerkId: "clerk-e",
      username: "racer",
    });
  });
});
