import { describe, it, expect } from "vitest";
import { isBackRoute, isKnownRoute, routeMarkerLabel } from "@/lib/nav-routes";

describe("isBackRoute", () => {
  it("matches exact back-route prefixes", () => {
    expect(isBackRoute("/leaderboard")).toBe(true);
    expect(isBackRoute("/queue")).toBe(true);
    expect(isBackRoute("/challenge")).toBe(true);
    expect(isBackRoute("/settings")).toBe(true);
    expect(isBackRoute("/race")).toBe(true);
    expect(isBackRoute("/tournament")).toBe(true);
  });

  it("matches back-route subpaths", () => {
    expect(isBackRoute("/challenge/new")).toBe(true);
    expect(isBackRoute("/settings/cf")).toBe(true);
    expect(isBackRoute("/race/abc123")).toBe(true);
    expect(isBackRoute("/tournament/rules")).toBe(true);
  });

  it("does NOT match /admin — the admin surface is deliberately unadvertised", () => {
    // /admin 404s for non-admins (404-not-403, issue #175); the nav must not
    // be able to distinguish it from a nonexistent path.
    expect(isBackRoute("/admin")).toBe(false);
    expect(isBackRoute("/admin/reports")).toBe(false);
  });

  it("does not match menu routes or unrelated paths", () => {
    expect(isBackRoute("/")).toBe(false);
    expect(isBackRoute("/dashboard")).toBe(false);
    expect(isBackRoute("/sign-in")).toBe(false);
  });

  it("does not match a path that merely starts with a prefix's letters", () => {
    expect(isBackRoute("/racecar")).toBe(false);
    expect(isBackRoute("/settingsX")).toBe(false);
    expect(isBackRoute("/tournamentx")).toBe(false);
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
    expect(isKnownRoute("/tournament")).toBe(true);
    expect(isKnownRoute("/tournament/rules")).toBe(true);
  });

  it("is false for /admin — indistinguishable from a nonexistent path", () => {
    // The admin surface is unadvertised (404-not-403, issue #175): its chrome
    // must be pixel-identical to a truly unknown route's, so /admin is in no
    // known-route set.
    expect(isKnownRoute("/admin")).toBe(false);
    expect(isKnownRoute("/admin/reports")).toBe(false);
    expect(isKnownRoute("/admin/anything")).toBe(false);
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
    // /settingsX must NOT match /settings — it's a different top-level route,
    // not a subpath of it, and must fall through to "unknown".
    expect(isKnownRoute("/settingsX")).toBe(false);
    expect(isKnownRoute("/sign-inX")).toBe(false);
    expect(isKnownRoute("/racecar")).toBe(false);
    // Same rule for /tournament: /tournamentx is a different route, not a
    // subpath of /tournament, so it must remain unknown (garbage route).
    expect(isKnownRoute("/tournamentx")).toBe(false);
  });
});

describe("routeMarkerLabel", () => {
  it("returns the fixed label for each known section's exact prefix", () => {
    expect(routeMarkerLabel("/queue")).toBe("queue");
    expect(routeMarkerLabel("/race")).toBe("race");
    expect(routeMarkerLabel("/challenge")).toBe("challenge");
    expect(routeMarkerLabel("/settings")).toBe("settings");
    expect(routeMarkerLabel("/leaderboard")).toBe("ladder");
    expect(routeMarkerLabel("/sign-in")).toBe("auth");
    expect(routeMarkerLabel("/sign-up")).toBe("auth");
    expect(routeMarkerLabel("/tournament")).toBe("tournament");
  });

  it("returns the same fixed label for subpaths, including garbage ones", () => {
    expect(routeMarkerLabel("/queue/abc123")).toBe("queue");
    expect(routeMarkerLabel("/race/abc123")).toBe("race");
    expect(routeMarkerLabel("/challenge/new")).toBe("challenge");
    expect(routeMarkerLabel("/settings/cf")).toBe("settings");
    expect(routeMarkerLabel("/leaderboard/weekly")).toBe("ladder");
    expect(routeMarkerLabel("/sign-in/factor-one")).toBe("auth");
    expect(routeMarkerLabel("/sign-up/verify-email-address")).toBe("auth");
    expect(routeMarkerLabel("/tournament/rules")).toBe("tournament");
  });

  it("pins that a nonexistent subpath under a known prefix yields the fixed label, not the raw path", () => {
    // The bug this issue fixes: /settings/admin 404s but must never echo
    // "/settings/admin" — only the fixed "settings" label.
    expect(routeMarkerLabel("/settings/admin")).toBe("settings");
  });

  it("returns null for menu routes", () => {
    expect(routeMarkerLabel("/")).toBeNull();
    expect(routeMarkerLabel("/dashboard")).toBeNull();
  });

  it("returns null for unknown paths", () => {
    expect(routeMarkerLabel("/nope")).toBeNull();
    expect(routeMarkerLabel("/foo/bar")).toBeNull();
    expect(routeMarkerLabel("/admin")).toBeNull();
    expect(routeMarkerLabel("/admin/reports")).toBeNull();
  });

  it("does not treat a lookalike prefix as a subpath match", () => {
    expect(routeMarkerLabel("/settingsX")).toBeNull();
    expect(routeMarkerLabel("/sign-inX")).toBeNull();
    expect(routeMarkerLabel("/racecar")).toBeNull();
    expect(routeMarkerLabel("/tournamentx")).toBeNull();
  });
});
