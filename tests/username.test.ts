/**
 * Tests for src/lib/username.ts (issue #111).
 */

import { describe, it, expect } from "vitest";
import {
  dismissUsernameBanner,
  emailLocalPart,
  isUsernameBannerDismissed,
  isUsernameValid,
  looksLikeEmailUsername,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  usernameSchema,
} from "../src/lib/username";

describe("emailLocalPart", () => {
  it("returns everything before the @", () => {
    expect(emailLocalPart("cool@example.com")).toBe("cool");
  });

  it("truncates a long local part to MAX_USERNAME_LENGTH", () => {
    const longLocal = "a".repeat(MAX_USERNAME_LENGTH + 10);
    const result = emailLocalPart(`${longLocal}@example.com`);
    expect(result).toHaveLength(MAX_USERNAME_LENGTH);
    expect(result).toBe(longLocal.slice(0, MAX_USERNAME_LENGTH));
  });

  it("never returns a string containing @", () => {
    expect(emailLocalPart("someone@example.com")).not.toContain("@");
  });

  it("falls back to the whole string when there is no @ (defensive)", () => {
    expect(emailLocalPart("noatsign")).toBe("noatsign");
  });
});

describe("usernameSchema / isUsernameValid", () => {
  it("accepts a normal alphanumeric name", () => {
    expect(isUsernameValid("tourist")).toBe(true);
  });

  it("accepts names with internal separators (. _ - and space)", () => {
    expect(isUsernameValid("cool.coder")).toBe(true);
    expect(isUsernameValid("cool_coder")).toBe(true);
    expect(isUsernameValid("cool-coder")).toBe(true);
    expect(isUsernameValid("cool coder")).toBe(true);
  });

  it("accepts a name exactly at the minimum length", () => {
    expect(isUsernameValid("ab")).toBe(true);
  });

  it("accepts a name exactly at the maximum length", () => {
    expect(isUsernameValid("a".repeat(MAX_USERNAME_LENGTH))).toBe(true);
  });

  it("trims surrounding whitespace before validating", () => {
    const result = usernameSchema.safeParse({ username: "  tourist  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe("tourist");
    }
  });

  it("rejects a name shorter than the minimum length", () => {
    expect(isUsernameValid("a")).toBe(false);
  });

  it("rejects a name longer than the maximum length", () => {
    expect(isUsernameValid("a".repeat(MAX_USERNAME_LENGTH + 1))).toBe(false);
  });

  it("rejects a name containing @", () => {
    expect(isUsernameValid("me@example.com")).toBe(false);
  });

  it("rejects a leading separator (surrounding whitespace is trimmed first, so only . _ - apply here)", () => {
    expect(isUsernameValid(".tourist")).toBe(false);
    expect(isUsernameValid("-tourist")).toBe(false);
    expect(isUsernameValid("_tourist")).toBe(false);
  });

  it("rejects a trailing separator (surrounding whitespace is trimmed first, so only . _ - apply here)", () => {
    expect(isUsernameValid("tourist.")).toBe(false);
    expect(isUsernameValid("tourist-")).toBe(false);
    expect(isUsernameValid("tourist_")).toBe(false);
  });

  it("trims a leading/trailing space before validating, so it does not reject on its own", () => {
    expect(isUsernameValid(" tourist")).toBe(true);
    expect(isUsernameValid("tourist ")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isUsernameValid("")).toBe(false);
  });

  it("surfaces a helpful message on rejection", () => {
    const result = usernameSchema.safeParse({ username: "a" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(
        new RegExp(`at least ${MIN_USERNAME_LENGTH}`),
      );
    }
  });
});

describe("looksLikeEmailUsername", () => {
  it("is true for a legacy full-email username", () => {
    expect(looksLikeEmailUsername("someone@example.com")).toBe(true);
  });

  it("is false for a normal display name", () => {
    expect(looksLikeEmailUsername("tourist")).toBe(false);
  });
});

describe("isUsernameBannerDismissed / dismissUsernameBanner (no-DOM environment)", () => {
  it("isUsernameBannerDismissed returns false when localStorage is unavailable", () => {
    expect(isUsernameBannerDismissed()).toBe(false);
  });

  it("dismissUsernameBanner does not throw when localStorage is unavailable", () => {
    expect(() => dismissUsernameBanner()).not.toThrow();
  });
});
