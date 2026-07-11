/**
 * Tests for src/lib/race/av-requirements.ts
 */

import { describe, it, expect } from "vitest";
import {
  canCompete,
  micGrantedFromPermissionState,
  UNMET_AV_REQUIREMENTS,
  type AvRequirementState,
} from "../src/lib/race/av-requirements";

describe("canCompete", () => {
  const met: AvRequirementState = {
    micGranted: true,
    micLive: true,
    camGranted: true,
    camLive: true,
  };

  it("is true when all four requirements are met", () => {
    expect(canCompete(met)).toBe(true);
  });

  it("is false at the all-unmet default", () => {
    expect(canCompete(UNMET_AV_REQUIREMENTS)).toBe(false);
  });

  it("is false when mic permission is denied", () => {
    expect(canCompete({ ...met, micGranted: false })).toBe(false);
  });

  it("is false when mic is granted but not live (e.g. device vanished)", () => {
    expect(canCompete({ ...met, micLive: false })).toBe(false);
  });

  it("is false when camera permission is denied", () => {
    expect(canCompete({ ...met, camGranted: false })).toBe(false);
  });

  it("is false when camera is granted but not live (e.g. webcam unplugged)", () => {
    expect(canCompete({ ...met, camLive: false })).toBe(false);
  });

  it("is false when only mic requirements are met and camera is entirely unmet", () => {
    expect(
      canCompete({ ...met, camGranted: false, camLive: false }),
    ).toBe(false);
  });

  it("is false when only camera requirements are met and mic is entirely unmet", () => {
    expect(
      canCompete({ ...met, micGranted: false, micLive: false }),
    ).toBe(false);
  });
});

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
