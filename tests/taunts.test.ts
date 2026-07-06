import { describe, it, expect } from "vitest";
import {
  addTaunt,
  canTaunt,
  expireTaunt,
  isKnownTauntId,
  pruneExpiredTaunts,
  tauntCooldownRemainingMs,
  tauntEmoteGlyph,
  tauntPresetText,
  type TauntBubbles,
} from "@/lib/race/taunts";
import { TAUNT_COOLDOWN_MS, TAUNT_DISPLAY_MS } from "@/lib/types";

describe("isKnownTauntId", () => {
  it("is true for a known preset id", () => {
    expect(isKnownTauntId("skill-issue")).toBe(true);
  });

  it("is true for a known emote id", () => {
    expect(isKnownTauntId("fire")).toBe(true);
  });

  it("is false for an unknown id", () => {
    expect(isKnownTauntId("this-is-not-a-real-taunt")).toBe(false);
  });

  it("is false for prototype-pollution-style ids (own-property check, not `in`)", () => {
    expect(isKnownTauntId("toString")).toBe(false);
    expect(isKnownTauntId("constructor")).toBe(false);
  });
});

describe("tauntPresetText / tauntEmoteGlyph", () => {
  it("resolves a preset's display text", () => {
    expect(tauntPresetText("gg")).toBe("gg go next");
  });

  it("returns null for an emote id passed to tauntPresetText", () => {
    expect(tauntPresetText("fire")).toBeNull();
  });

  it("resolves an emote's glyph", () => {
    expect(tauntEmoteGlyph("skull")).toBe("💀");
  });

  it("returns null for a preset id passed to tauntEmoteGlyph", () => {
    expect(tauntEmoteGlyph("gg")).toBeNull();
  });

  it("returns null for unknown ids", () => {
    expect(tauntPresetText("nope")).toBeNull();
    expect(tauntEmoteGlyph("nope")).toBeNull();
  });
});

describe("canTaunt", () => {
  it("allows the first taunt (no prior send)", () => {
    expect(canTaunt(null, 1_000)).toBe(true);
  });

  it("blocks a second taunt inside the cooldown window", () => {
    expect(canTaunt(1_000, 1_000 + TAUNT_COOLDOWN_MS - 1)).toBe(false);
  });

  it("allows a taunt exactly at the cooldown boundary", () => {
    expect(canTaunt(1_000, 1_000 + TAUNT_COOLDOWN_MS)).toBe(true);
  });

  it("allows a taunt well after the cooldown window", () => {
    expect(canTaunt(1_000, 1_000 + TAUNT_COOLDOWN_MS + 5_000)).toBe(true);
  });
});

describe("tauntCooldownRemainingMs", () => {
  it("is 0 when there's no prior send", () => {
    expect(tauntCooldownRemainingMs(null, 1_000)).toBe(0);
  });

  it("counts down toward 0 inside the window", () => {
    expect(tauntCooldownRemainingMs(1_000, 1_000 + 1_000)).toBe(TAUNT_COOLDOWN_MS - 1_000);
  });

  it("floors at 0 once the cooldown has elapsed", () => {
    expect(tauntCooldownRemainingMs(1_000, 1_000 + TAUNT_COOLDOWN_MS + 500)).toBe(0);
  });
});

describe("addTaunt", () => {
  it("adds a bubble for a new sender", () => {
    const result = addTaunt({}, "user-1", "skull", 1_000);
    expect(result).toEqual({ "user-1": { tauntId: "skull", sentAt: 1_000 } });
  });

  it("replaces an existing bubble from the same sender", () => {
    const before: TauntBubbles = { "user-1": { tauntId: "skull", sentAt: 1_000 } };
    const result = addTaunt(before, "user-1", "fire", 2_000);
    expect(result).toEqual({ "user-1": { tauntId: "fire", sentAt: 2_000 } });
  });

  it("leaves other senders' bubbles untouched", () => {
    const before: TauntBubbles = { "user-2": { tauntId: "gg", sentAt: 500 } };
    const result = addTaunt(before, "user-1", "skull", 1_000);
    expect(result).toEqual({
      "user-2": { tauntId: "gg", sentAt: 500 },
      "user-1": { tauntId: "skull", sentAt: 1_000 },
    });
  });

  it("ignores an unknown taunt id and returns bubbles unchanged", () => {
    const before: TauntBubbles = { "user-2": { tauntId: "gg", sentAt: 500 } };
    const result = addTaunt(before, "user-1", "not-a-real-taunt", 1_000);
    expect(result).toBe(before);
  });
});

describe("expireTaunt", () => {
  it("removes a bubble matching the given sentAt", () => {
    const before: TauntBubbles = { "user-1": { tauntId: "skull", sentAt: 1_000 } };
    const result = expireTaunt(before, "user-1", 1_000);
    expect(result).toEqual({});
  });

  it("is a no-op when the sender has no bubble", () => {
    const before: TauntBubbles = {};
    const result = expireTaunt(before, "user-1", 1_000);
    expect(result).toBe(before);
  });

  it("does not remove a newer bubble that replaced the one the timer was scheduled for", () => {
    // Sender taunts at t=1000, then again at t=1500 before the first
    // bubble's auto-dismiss timer (scheduled against sentAt=1000) fires.
    let bubbles = addTaunt({}, "user-1", "skull", 1_000);
    bubbles = addTaunt(bubbles, "user-1", "fire", 1_500);

    // The stale timer for the first bubble fires and tries to expire sentAt=1000.
    const result = expireTaunt(bubbles, "user-1", 1_000);

    expect(result).toEqual({ "user-1": { tauntId: "fire", sentAt: 1_500 } });
  });
});

describe("pruneExpiredTaunts", () => {
  it("keeps bubbles still inside the display window", () => {
    const bubbles: TauntBubbles = { "user-1": { tauntId: "skull", sentAt: 1_000 } };
    const result = pruneExpiredTaunts(bubbles, 1_000 + TAUNT_DISPLAY_MS - 1);
    expect(result).toBe(bubbles);
  });

  it("drops bubbles whose display window has elapsed", () => {
    const bubbles: TauntBubbles = { "user-1": { tauntId: "skull", sentAt: 1_000 } };
    const result = pruneExpiredTaunts(bubbles, 1_000 + TAUNT_DISPLAY_MS);
    expect(result).toEqual({});
  });

  it("prunes a mix, keeping only the still-live bubble", () => {
    const bubbles: TauntBubbles = {
      "user-1": { tauntId: "skull", sentAt: 1_000 }, // expired
      "user-2": { tauntId: "fire", sentAt: 4_000 }, // still live
    };
    const result = pruneExpiredTaunts(bubbles, 1_000 + TAUNT_DISPLAY_MS);
    expect(result).toEqual({ "user-2": { tauntId: "fire", sentAt: 4_000 } });
  });
});
