/**
 * Tests for src/lib/username.ts.
 *
 * Only `emailLocalPart` survives from issue #111 — the rest of the
 * user-editable-username surface (validation schema, banner) was removed by
 * issue #120, which makes the display name follow the linked CF handle.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_USERNAME,
  emailLocalPart,
  MAX_USERNAME_LENGTH,
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
    expect(emailLocalPart("@example.com")).not.toContain("@");
  });

  it("falls back to the whole string when there is no @ (defensive)", () => {
    expect(emailLocalPart("noatsign")).toBe("noatsign");
  });

  it("falls back to the default username when the local part is empty", () => {
    expect(emailLocalPart("@example.com")).toBe(DEFAULT_USERNAME);
  });

  it("pads a one-character local part to satisfy username validation", () => {
    expect(emailLocalPart("a@example.com")).toBe("a_");
  });
});
