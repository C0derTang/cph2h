/**
 * Tests for src/lib/editor/draft.ts
 */

import { describe, it, expect } from "vitest";
import { buildDraftKey, clearDraft, readDraft, writeDraft } from "../src/lib/editor/draft";

describe("buildDraftKey", () => {
  it("prefixes the scope with the draft namespace", () => {
    expect(buildDraftKey("race:1")).toBe("cph2h:draft:race:1");
  });

  it("trims surrounding whitespace", () => {
    expect(buildDraftKey("  settings:template  ")).toBe("cph2h:draft:settings:template");
  });

  it("produces distinct keys for distinct scopes", () => {
    expect(buildDraftKey("race:1")).not.toBe(buildDraftKey("race:2"));
  });

  it("throws on an empty scope", () => {
    expect(() => buildDraftKey("")).toThrow();
    expect(() => buildDraftKey("   ")).toThrow();
  });
});

describe("readDraft / writeDraft / clearDraft (no-DOM environment)", () => {
  it("readDraft returns null when localStorage is unavailable", () => {
    expect(readDraft(buildDraftKey("race:1"))).toBeNull();
  });

  it("writeDraft and clearDraft do not throw when localStorage is unavailable", () => {
    expect(() => writeDraft(buildDraftKey("race:1"), "int main() {}")).not.toThrow();
    expect(() => clearDraft(buildDraftKey("race:1"))).not.toThrow();
  });
});
