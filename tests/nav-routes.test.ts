import { describe, it, expect } from "vitest";
import { isBackRoute, isKnownRoute } from "@/lib/nav-routes";

describe("isBackRoute", () => {
  it("matches exact back-route prefixes", () => {
    expect(isBackRoute("/leaderboard")).toBe(true);
    expect(isBackRoute("/queue")).toBe(true);
    expect(isBackRoute("/challenge")).toBe(true);
    expect(isBackRoute("/settings")).toBe(true);
    expect(isBackRoute("/race")).toBe(true);
  });

  it("matches back-route subpaths", () => {
    expect(isBackRoute("/challenge/new")).toBe(true);
    expect(isBackRoute("/settings/cf")).toBe(true);
    expect(isBackRoute("/race/abc123")).toBe(true);
  });

  it("matches /admin as a back route", () => {
    expect(isBackRoute("/admin")).toBe(true);
    expect(isBackRoute("/admin/reports")).toBe(true);
  });

  it("does not match menu routes or unrelated paths", () => {
    expect(isBackRoute("/")).toBe(false);
    expect(isBackRoute("/dashboard")).toBe(false);
    expect(isBackRoute("/sign-in")).toBe(false);
  });

  it("does not match a path that merely starts with a prefix's letters", () => {
    // /adminX is a different route than /admin, not a subpath of it.
    expect(isBackRoute("/adminX")).toBe(false);
    expect(isBackRoute("/racecar")).toBe(false);
  });
});

describe("isKnownRoute", () => {
  it("is true for menu routes", () => {
    expect(isKnownRoute("/")).toBe(true);
    expect(isKnownRoute("/dashboard")).toBe(true);
  });

  it("is true for back routes and their subpaths", () => {
    expect(isKnownRoute("/leaderboard")).toBe(true);
    expect(isKnownRoute("/queue")).toBe(true);
    expect(isKnownRoute("/challenge/new")).toBe(true);
    expect(isKnownRoute("/settings/cf")).toBe(true);
    expect(isKnownRoute("/race/abc123")).toBe(true);
    expect(isKnownRoute("/admin")).toBe(true);
    expect(isKnownRoute("/admin/reports")).toBe(true);
  });

  it("is true for auth pages, including their subpaths", () => {
    expect(isKnownRoute("/sign-in")).toBe(true);
    expect(isKnownRoute("/sign-up")).toBe(true);
    expect(isKnownRoute("/sign-in/factor-one")).toBe(true);
    expect(isKnownRoute("/sign-up/verify-email-address")).toBe(true);
  });

  it("is false for unknown paths", () => {
    expect(isKnownRoute("/nope")).toBe(false);
    expect(isKnownRoute("/foo/bar")).toBe(false);
  });

  it("does not treat a lookalike prefix as a subpath match", () => {
    // /adminX must NOT match /admin — it's a different top-level route, not
    // a subpath of it, and must fall through to "unknown".
    expect(isKnownRoute("/adminX")).toBe(false);
    expect(isKnownRoute("/sign-inX")).toBe(false);
  });
});
