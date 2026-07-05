/**
 * Tests for src/lib/editor/template.ts
 */

import { describe, it, expect } from "vitest";
import { MAX_TEMPLATE_LENGTH, isTemplateSizeValid, templateSchema } from "../src/lib/editor/template";

describe("isTemplateSizeValid", () => {
  it("accepts an empty template", () => {
    expect(isTemplateSizeValid("")).toBe(true);
  });

  it("accepts a template exactly at the cap", () => {
    expect(isTemplateSizeValid("a".repeat(MAX_TEMPLATE_LENGTH))).toBe(true);
  });

  it("rejects a template one character over the cap", () => {
    expect(isTemplateSizeValid("a".repeat(MAX_TEMPLATE_LENGTH + 1))).toBe(false);
  });
});

describe("templateSchema", () => {
  it("parses a valid template", () => {
    const result = templateSchema.safeParse({ template: "#include <bits/stdc++.h>\n" });
    expect(result.success).toBe(true);
  });

  it("rejects an oversized template with a helpful message", () => {
    const result = templateSchema.safeParse({
      template: "a".repeat(MAX_TEMPLATE_LENGTH + 1),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/characters or fewer/);
    }
  });

  it("rejects a non-string template", () => {
    const result = templateSchema.safeParse({ template: 123 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing template field", () => {
    const result = templateSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
