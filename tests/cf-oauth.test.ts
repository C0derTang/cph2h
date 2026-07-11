/**
 * Unit tests for the pure Codeforces OIDC helpers (src/lib/cf/oauth.ts).
 *
 * These cover the load-bearing security invariants that are pure: CSRF `state`
 * comparison, id_token *claim* validation (iss/aud/exp/handle), same-origin
 * result redirects, and the handle-conflict decision. The HS256 *signature*
 * check lives in the route (needs the secret + `jose`) and is exercised
 * separately.
 */

import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  buildTokenRequestBody,
  callbackRedirectUri,
  CF_AUTHORIZE_ENDPOINT,
  CF_ISSUER,
  generateState,
  handleConflictsWithOtherUser,
  resultRedirectUrl,
  safeStringEquals,
  stateIsValid,
  validateIdTokenClaims,
  type CfIdTokenClaims,
} from "@/lib/cf/oauth";

const CLIENT_ID = "cph2h-client";
const NOW_SEC = 1_800_000_000;

function claims(overrides: Partial<CfIdTokenClaims> = {}): CfIdTokenClaims {
  return {
    iss: CF_ISSUER,
    aud: CLIENT_ID,
    exp: NOW_SEC + 3600,
    handle: "tourist",
    ...overrides,
  };
}

describe("generateState", () => {
  it("returns 64 hex chars", () => {
    const state = generateState();
    expect(state).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is effectively unique across calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateState());
    expect(seen.size).toBe(100);
  });
});

describe("safeStringEquals", () => {
  it("is true only for identical strings", () => {
    expect(safeStringEquals("abc", "abc")).toBe(true);
    expect(safeStringEquals("abc", "abd")).toBe(false);
    expect(safeStringEquals("abc", "ab")).toBe(false);
    expect(safeStringEquals("", "")).toBe(true);
  });
});

describe("stateIsValid", () => {
  it("requires a present, matching cookie + query state", () => {
    expect(stateIsValid("s123", "s123")).toBe(true);
  });

  it("rejects mismatch, missing cookie, missing query, and empty values", () => {
    expect(stateIsValid("s123", "other")).toBe(false);
    expect(stateIsValid(null, "s123")).toBe(false);
    expect(stateIsValid(undefined, "s123")).toBe(false);
    expect(stateIsValid("s123", null)).toBe(false);
    expect(stateIsValid("s123", undefined)).toBe(false);
    expect(stateIsValid("", "")).toBe(false);
  });
});

describe("callbackRedirectUri", () => {
  it("builds an absolute same-origin callback path", () => {
    expect(callbackRedirectUri("http://localhost:3000")).toBe(
      "http://localhost:3000/api/cf/oauth/callback",
    );
    expect(callbackRedirectUri("https://cph2h.example.com")).toBe(
      "https://cph2h.example.com/api/cf/oauth/callback",
    );
  });
});

describe("buildAuthorizeUrl", () => {
  it("targets the CF authorize endpoint with the OIDC params", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: CLIENT_ID,
        redirectUri: "http://localhost:3000/api/cf/oauth/callback",
        state: "state-xyz",
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(CF_AUTHORIZE_ENDPOINT);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/cf/oauth/callback",
    );
    expect(url.searchParams.get("scope")).toBe("openid");
    expect(url.searchParams.get("state")).toBe("state-xyz");
  });
});

describe("buildTokenRequestBody", () => {
  it("encodes the client_secret_post exchange body", () => {
    const body = buildTokenRequestBody({
      code: "auth-code",
      clientId: CLIENT_ID,
      clientSecret: "shhh",
      redirectUri: "http://localhost:3000/api/cf/oauth/callback",
    });
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("client_id")).toBe(CLIENT_ID);
    expect(body.get("client_secret")).toBe("shhh");
    expect(body.get("redirect_uri")).toBe(
      "http://localhost:3000/api/cf/oauth/callback",
    );
  });
});

describe("resultRedirectUrl", () => {
  it("lands on the settings page, same origin, with linked=1 on success", () => {
    const url = new URL(resultRedirectUrl("https://cph2h.example.com"));
    expect(url.origin).toBe("https://cph2h.example.com");
    expect(url.pathname).toBe("/settings/cf");
    expect(url.searchParams.get("linked")).toBe("1");
    expect(url.searchParams.get("error")).toBeNull();
  });

  it("carries an error code and never leaves the origin", () => {
    const url = new URL(resultRedirectUrl("https://cph2h.example.com", "handle_taken"));
    expect(url.origin).toBe("https://cph2h.example.com");
    expect(url.pathname).toBe("/settings/cf");
    expect(url.searchParams.get("error")).toBe("handle_taken");
  });
});

describe("validateIdTokenClaims", () => {
  it("accepts a well-formed token and extracts handle + rating", () => {
    const result = validateIdTokenClaims(claims({ rating: 3800 }), {
      clientId: CLIENT_ID,
      nowSec: NOW_SEC,
    });
    expect(result).toEqual({ ok: true, handle: "tourist", rating: 3800 });
  });

  it("accepts an audience array containing the client id", () => {
    const result = validateIdTokenClaims(claims({ aud: ["other", CLIENT_ID] }), {
      clientId: CLIENT_ID,
      nowSec: NOW_SEC,
    });
    expect(result.ok).toBe(true);
  });

  it("returns rating null when the claim is absent or non-numeric", () => {
    const absent = validateIdTokenClaims(claims(), { clientId: CLIENT_ID, nowSec: NOW_SEC });
    expect(absent).toEqual({ ok: true, handle: "tourist", rating: null });
    const nonNumeric = validateIdTokenClaims(claims({ rating: "high" }), {
      clientId: CLIENT_ID,
      nowSec: NOW_SEC,
    });
    expect(nonNumeric).toEqual({ ok: true, handle: "tourist", rating: null });
  });

  it("rejects a wrong issuer", () => {
    const result = validateIdTokenClaims(claims({ iss: "https://evil.example.com" }), {
      clientId: CLIENT_ID,
      nowSec: NOW_SEC,
    });
    expect(result).toEqual({ ok: false, error: "oauth_invalid_token" });
  });

  it("rejects a wrong audience (string and array)", () => {
    expect(
      validateIdTokenClaims(claims({ aud: "someone-else" }), {
        clientId: CLIENT_ID,
        nowSec: NOW_SEC,
      }).ok,
    ).toBe(false);
    expect(
      validateIdTokenClaims(claims({ aud: ["a", "b"] }), {
        clientId: CLIENT_ID,
        nowSec: NOW_SEC,
      }).ok,
    ).toBe(false);
  });

  it("rejects an expired token (outside the clock tolerance)", () => {
    const result = validateIdTokenClaims(claims({ exp: NOW_SEC - 100 }), {
      clientId: CLIENT_ID,
      nowSec: NOW_SEC,
    });
    expect(result.ok).toBe(false);
  });

  it("allows a just-expired token within the small clock tolerance", () => {
    const result = validateIdTokenClaims(claims({ exp: NOW_SEC - 10 }), {
      clientId: CLIENT_ID,
      nowSec: NOW_SEC,
      clockToleranceSec: 30,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a missing/non-numeric exp", () => {
    expect(
      validateIdTokenClaims(claims({ exp: undefined }), {
        clientId: CLIENT_ID,
        nowSec: NOW_SEC,
      }).ok,
    ).toBe(false);
    expect(
      validateIdTokenClaims(claims({ exp: "soon" }), {
        clientId: CLIENT_ID,
        nowSec: NOW_SEC,
      }).ok,
    ).toBe(false);
  });

  it("rejects a missing or empty handle", () => {
    expect(
      validateIdTokenClaims(claims({ handle: undefined }), {
        clientId: CLIENT_ID,
        nowSec: NOW_SEC,
      }).ok,
    ).toBe(false);
    expect(
      validateIdTokenClaims(claims({ handle: "   " }), {
        clientId: CLIENT_ID,
        nowSec: NOW_SEC,
      }).ok,
    ).toBe(false);
    expect(
      validateIdTokenClaims(claims({ handle: 123 }), {
        clientId: CLIENT_ID,
        nowSec: NOW_SEC,
      }).ok,
    ).toBe(false);
  });
});

describe("handleConflictsWithOtherUser", () => {
  it("is a conflict only when another user already owns the handle", () => {
    expect(handleConflictsWithOtherUser("user-2", "user-1")).toBe(true);
    expect(handleConflictsWithOtherUser("user-1", "user-1")).toBe(false);
    expect(handleConflictsWithOtherUser(null, "user-1")).toBe(false);
    expect(handleConflictsWithOtherUser(undefined, "user-1")).toBe(false);
  });
});
