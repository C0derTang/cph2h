/**
 * Tests for src/lib/race/av-requirements.ts
 */

import { describe, it, expect } from "vitest";
import {
  canCompete,
  clampVolume,
  DEFAULT_VOLUME,
  isVolumeAudible,
  micGrantedFromPermissionState,
  readVolume,
  UNMET_AV_REQUIREMENTS,
  writeVolume,
  type AvRequirementState,
} from "../src/lib/race/av-requirements";

describe("canCompete", () => {
  const met: AvRequirementState = {
    micGranted: true,
    micLive: true,
    volumeAudible: true,
  };

  it("is true when all three requirements are met", () => {
    expect(canCompete(met)).toBe(true);
  });

  it("is false at the all-unmet default", () => {
    expect(canCompete(UNMET_AV_REQUIREMENTS)).toBe(false);
  });

  it("is false when mic permission is denied even if volume is audible", () => {
    expect(canCompete({ ...met, micGranted: false })).toBe(false);
  });

  it("is false when mic is granted but not live (e.g. device vanished)", () => {
    expect(canCompete({ ...met, micLive: false })).toBe(false);
  });

  it("is false when mic is on but volume is muted", () => {
    expect(canCompete({ ...met, volumeAudible: false })).toBe(false);
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

describe("clampVolume", () => {
  it("passes through in-range values", () => {
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(1)).toBe(1);
  });

  it("clamps above 1 down to 1", () => {
    expect(clampVolume(1.5)).toBe(1);
  });

  it("clamps below 0 up to 0", () => {
    expect(clampVolume(-0.2)).toBe(0);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampVolume(NaN)).toBe(DEFAULT_VOLUME);
    expect(clampVolume(Infinity)).toBe(DEFAULT_VOLUME);
  });
});

describe("isVolumeAudible", () => {
  it("is false at exactly 0", () => {
    expect(isVolumeAudible(0)).toBe(false);
  });

  it("is true for any positive volume", () => {
    expect(isVolumeAudible(0.01)).toBe(true);
    expect(isVolumeAudible(1)).toBe(true);
  });

  it("is false for a negative volume (defensive)", () => {
    expect(isVolumeAudible(-1)).toBe(false);
  });
});

describe("readVolume / writeVolume (no-DOM environment)", () => {
  it("readVolume returns the default when localStorage is unavailable", () => {
    expect(readVolume()).toBe(DEFAULT_VOLUME);
  });

  it("writeVolume does not throw when localStorage is unavailable", () => {
    expect(() => writeVolume(0.7)).not.toThrow();
  });
});
