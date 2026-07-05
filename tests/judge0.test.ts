/**
 * Tests for src/lib/judge0.ts — pure helpers only (no network).
 */

import { describe, expect, it } from "vitest";
import {
  decodeBase64,
  encodeBase64,
  normalizeOutput,
  outputsMatch,
  statusDescription,
} from "@/lib/judge0";

describe("base64 helpers", () => {
  it("round-trips text through encode/decode", () => {
    const text = "int main() { return 0; }\n";
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it("decodes null/undefined as an empty string", () => {
    expect(decodeBase64(null)).toBe("");
    expect(decodeBase64(undefined)).toBe("");
  });
});

describe("statusDescription", () => {
  it("maps known Judge0 status ids", () => {
    expect(statusDescription(3)).toBe("Accepted");
    expect(statusDescription(6)).toBe("Compilation Error");
  });

  it("falls back to the provided description for unknown ids", () => {
    expect(statusDescription(999, "Something Else")).toBe("Something Else");
  });

  it("falls back to a generic label when nothing else is available", () => {
    expect(statusDescription(999)).toBe("Unknown status (999)");
  });
});

describe("normalizeOutput / outputsMatch", () => {
  it("strips trailing whitespace and blank lines", () => {
    expect(normalizeOutput("1 2 3 \n4\t\n\n\n")).toBe("1 2 3\n4");
  });

  it("treats identical output as a match", () => {
    expect(outputsMatch("3\n", "3\n")).toBe(true);
  });

  it("ignores trailing blank lines", () => {
    expect(outputsMatch("3\n\n\n", "3\n")).toBe(true);
    expect(outputsMatch("3", "3\n\n")).toBe(true);
  });

  it("ignores trailing whitespace on each line", () => {
    expect(outputsMatch("3 \n4\t\n", "3\n4\n")).toBe(true);
  });

  it("normalizes CRLF line endings", () => {
    expect(outputsMatch("3\r\n4\r\n", "3\n4\n")).toBe(true);
  });

  it("does not ignore meaningful whitespace mid-line", () => {
    expect(outputsMatch("1 2\n", "12\n")).toBe(false);
  });

  it("rejects genuinely different output", () => {
    expect(outputsMatch("3\n", "4\n")).toBe(false);
  });

  it("rejects a differing number of significant lines", () => {
    expect(outputsMatch("1\n2\n", "1\n")).toBe(false);
  });
});
