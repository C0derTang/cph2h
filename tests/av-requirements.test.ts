/**
 * Tests for src/lib/race/av-requirements.ts
 */

import { describe, it, expect } from "vitest";
import { micGrantedFromPermissionState } from "../src/lib/race/av-requirements";

describe("micGrantedFromPermissionState", () => {
  it("is true for 'granted'", () => {
    expect(micGrantedFromPermissionState("granted")).toBe(true);
  });

  it("is false for 'denied'", () => {
    expect(micGrantedFromPermissionState("denied")).toBe(false);
  });

  it("is false for 'prompt'", () => {
    expect(micGrantedFromPermissionState("prompt")).toBe(false);
  });

  it("is false for null (permission API unsupported / not yet probed)", () => {
    expect(micGrantedFromPermissionState(null)).toBe(false);
  });
});
