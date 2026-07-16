/**
 * Tests for src/lib/tournament/registration.ts (issue #209). Pure functions,
 * no mocks.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeGithubUrl,
  normalizeLinkedinUrl,
} from "../src/lib/tournament/registration";

describe("normalizeGithubUrl", () => {
  it("accepts a scheme-less input", () => {
    expect(normalizeGithubUrl("github.com/torvalds")).toBe(
      "https://github.com/torvalds",
    );
  });

  it("canonicalizes www.github.com to github.com", () => {
    expect(normalizeGithubUrl("https://www.github.com/torvalds")).toBe(
      "https://github.com/torvalds",
    );
  });

  it("canonicalizes http to https", () => {
    expect(normalizeGithubUrl("http://github.com/torvalds")).toBe(
      "https://github.com/torvalds",
    );
  });

  it("strips a trailing slash", () => {
    expect(normalizeGithubUrl("https://github.com/torvalds/")).toBe(
      "https://github.com/torvalds",
    );
  });

  it("strips query and hash", () => {
    expect(normalizeGithubUrl("https://github.com/torvalds?tab=repos#readme")).toBe(
      "https://github.com/torvalds",
    );
  });

  it("rejects a root path (no profile)", () => {
    expect(normalizeGithubUrl("https://github.com")).toBeNull();
    expect(normalizeGithubUrl("https://github.com/")).toBeNull();
  });

  it("rejects the wrong host", () => {
    expect(normalizeGithubUrl("https://gitlab.com/torvalds")).toBeNull();
  });

  it("rejects a lookalike host", () => {
    expect(normalizeGithubUrl("https://github.com.evil.com/torvalds")).toBeNull();
  });

  it("rejects a javascript: scheme", () => {
    expect(normalizeGithubUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects over-length input", () => {
    const long = "github.com/" + "a".repeat(200);
    expect(normalizeGithubUrl(long)).toBeNull();
  });
});

describe("normalizeLinkedinUrl", () => {
  it("accepts a scheme-less input", () => {
    expect(normalizeLinkedinUrl("linkedin.com/in/someone")).toBe(
      "https://www.linkedin.com/in/someone",
    );
  });

  it("accepts www.", () => {
    expect(normalizeLinkedinUrl("https://www.linkedin.com/in/someone")).toBe(
      "https://www.linkedin.com/in/someone",
    );
  });

  it("accepts a country subdomain", () => {
    expect(normalizeLinkedinUrl("https://uk.linkedin.com/in/someone")).toBe(
      "https://uk.linkedin.com/in/someone",
    );
  });

  it("canonicalizes bare linkedin.com to www.linkedin.com", () => {
    expect(normalizeLinkedinUrl("https://linkedin.com/in/someone")).toBe(
      "https://www.linkedin.com/in/someone",
    );
  });

  it("canonicalizes http to https", () => {
    expect(normalizeLinkedinUrl("http://www.linkedin.com/in/someone")).toBe(
      "https://www.linkedin.com/in/someone",
    );
  });

  it("strips a trailing slash", () => {
    expect(normalizeLinkedinUrl("https://www.linkedin.com/in/someone/")).toBe(
      "https://www.linkedin.com/in/someone",
    );
  });

  it("strips query and hash", () => {
    expect(
      normalizeLinkedinUrl("https://www.linkedin.com/in/someone?x=1#y"),
    ).toBe("https://www.linkedin.com/in/someone");
  });

  it("does not over-restrict the path (allows /pub/)", () => {
    expect(normalizeLinkedinUrl("https://www.linkedin.com/pub/someone/1/2/3")).toBe(
      "https://www.linkedin.com/pub/someone/1/2/3",
    );
  });

  it("rejects a root path (no profile)", () => {
    expect(normalizeLinkedinUrl("https://www.linkedin.com")).toBeNull();
    expect(normalizeLinkedinUrl("https://www.linkedin.com/")).toBeNull();
  });

  it("rejects the wrong host", () => {
    expect(normalizeLinkedinUrl("https://twitter.com/in/someone")).toBeNull();
  });

  it("rejects a lookalike host", () => {
    expect(
      normalizeLinkedinUrl("https://linkedin.com.evil.com/in/someone"),
    ).toBeNull();
  });

  it("rejects a javascript: scheme", () => {
    expect(normalizeLinkedinUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects over-length input", () => {
    const long = "linkedin.com/in/" + "a".repeat(200);
    expect(normalizeLinkedinUrl(long)).toBeNull();
  });
});
