import { describe, it, expect } from "vitest";
import { buildJoinUrl } from "@/lib/race/join-url";

describe("buildJoinUrl", () => {
  it("builds an absolute join URL from an origin and token", () => {
    expect(buildJoinUrl("https://cph2h.example", "abc123")).toBe(
      "https://cph2h.example/challenge/abc123",
    );
  });

  it("normalizes an origin with a trailing slash", () => {
    expect(buildJoinUrl("https://cph2h.example/", "abc123")).toBe(
      "https://cph2h.example/challenge/abc123",
    );
  });

  it("works with localhost dev origins including a port", () => {
    expect(buildJoinUrl("http://localhost:3000", "tok_xyz")).toBe(
      "http://localhost:3000/challenge/tok_xyz",
    );
  });

  it("preserves nanoid's URL-safe alphabet unchanged", () => {
    // nanoid() (used by generateChallengeToken) only emits A-Za-z0-9_- , all
    // of which are already valid path characters.
    expect(buildJoinUrl("https://cph2h.example", "AbC-9_xyZ")).toBe(
      "https://cph2h.example/challenge/AbC-9_xyZ",
    );
  });

  it("percent-encodes characters that are unsafe in a path segment", () => {
    expect(buildJoinUrl("https://cph2h.example", "a b/c")).toBe(
      "https://cph2h.example/challenge/a%20b%2Fc",
    );
  });
});
