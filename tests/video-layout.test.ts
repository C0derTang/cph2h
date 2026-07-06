import { describe, it, expect } from "vitest";
import { classifyVideoLayout, type VideoLayoutTrack } from "@/lib/race/video-layout";

function track(
  identity: string,
  isLocal: boolean,
  publication?: { isMuted: boolean },
): VideoLayoutTrack {
  return { participant: { identity, isLocal }, publication };
}

describe("classifyVideoLayout", () => {
  it("returns null spotlight and null pip for zero tracks", () => {
    expect(classifyVideoLayout([])).toEqual({ spotlight: null, pip: null });
  });

  it("splits local into pip and remote into spotlight", () => {
    const self = track("me", true, { isMuted: false });
    const opponent = track("them", false, { isMuted: false });

    const result = classifyVideoLayout([self, opponent]);

    expect(result.spotlight).toEqual({ track: opponent, live: true });
    expect(result.pip).toEqual({ track: self, live: true });
  });

  it("order in the input array doesn't matter", () => {
    const self = track("me", true, { isMuted: false });
    const opponent = track("them", false, { isMuted: false });

    const result = classifyVideoLayout([opponent, self]);

    expect(result.spotlight?.track).toBe(opponent);
    expect(result.pip?.track).toBe(self);
  });

  it("spotlight is null when the remote participant is missing (not yet connected, or disconnected)", () => {
    const self = track("me", true, { isMuted: false });

    const result = classifyVideoLayout([self]);

    expect(result.spotlight).toBeNull();
    expect(result.pip).toEqual({ track: self, live: true });
  });

  it("pip is null when the local participant is missing", () => {
    const opponent = track("them", false, { isMuted: false });

    const result = classifyVideoLayout([opponent]);

    expect(result.pip).toBeNull();
    expect(result.spotlight).toEqual({ track: opponent, live: true });
  });

  it("marks a track live=false when both are muted", () => {
    const self = track("me", true, { isMuted: true });
    const opponent = track("them", false, { isMuted: true });

    const result = classifyVideoLayout([self, opponent]);

    expect(result.spotlight).toEqual({ track: opponent, live: false });
    expect(result.pip).toEqual({ track: self, live: false });
  });

  it("marks a track live=false when it's a placeholder (no publication at all)", () => {
    const self = track("me", true); // no publication -> placeholder, camera never enabled
    const opponent = track("them", false);

    const result = classifyVideoLayout([self, opponent]);

    expect(result.spotlight).toEqual({ track: opponent, live: false });
    expect(result.pip).toEqual({ track: self, live: false });
  });

  it("handles a mix: local live, remote camera-off placeholder", () => {
    const self = track("me", true, { isMuted: false });
    const opponent = track("them", false);

    const result = classifyVideoLayout([self, opponent]);

    expect(result.pip).toEqual({ track: self, live: true });
    expect(result.spotlight).toEqual({ track: opponent, live: false });
  });

  it("picks the first match for each side defensively when duplicates exist", () => {
    const selfA = track("me", true, { isMuted: false });
    const selfB = track("me-dup", true, { isMuted: true });
    const opponent = track("them", false, { isMuted: false });

    const result = classifyVideoLayout([selfA, selfB, opponent]);

    expect(result.pip?.track).toBe(selfA);
  });
});
