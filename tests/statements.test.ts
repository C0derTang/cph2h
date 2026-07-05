import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseStatementHtml } from "@/lib/cf/statements";

const fixture = readFileSync(
  path.resolve(__dirname, "fixtures/cf-problem.html"),
  "utf-8",
);

describe("parseStatementHtml", () => {
  const parsed = parseStatementHtml(fixture);

  it("extracts every input/output sample pair", () => {
    expect(parsed.samples).toHaveLength(2);
  });

  it("preserves multiline input line breaks (test-example-line markup)", () => {
    expect(parsed.samples[0].input).toBe("2\n3\n1 2 3\n4\n10 20 30 40");
  });

  it("preserves multiline output line breaks and trims trailing newline", () => {
    expect(parsed.samples[0].output).toBe("3 5 10\n40 90 140 200");
  });

  it("parses a second plain-text sample block", () => {
    expect(parsed.samples[1]).toEqual({
      input: "1\n5\n5 4 3 2 1",
      output: "5 9 12 14 15",
    });
  });

  it("returns a non-empty statement body", () => {
    expect(parsed.html.trim().length).toBeGreaterThan(0);
  });

  it("keeps the statement legend and specifications but drops header/samples", () => {
    expect(parsed.html).toContain("subsequences");
    expect(parsed.html).toContain("Input");
    // Header title and the raw sample <pre> must not leak into the body.
    expect(parsed.html).not.toContain("time limit per test");
    expect(parsed.html).not.toContain("test-example-line");
  });

  it("pre-renders LaTeX to KaTeX markup (no raw $$$ delimiters left)", () => {
    expect(parsed.html).toContain("katex");
    expect(parsed.html).not.toContain("$$$");
  });

  it("produces sanitized HTML with no script tags", () => {
    expect(parsed.html.toLowerCase()).not.toContain("<script");
  });
});
