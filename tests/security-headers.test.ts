import { describe, expect, it } from "vitest";

import nextConfig, { SECURITY_HEADERS } from "../next.config";

/**
 * Regression tests for the baseline security headers (issue #185). Lock in the
 * exact header set and that `headers()` applies it to every route, so a future
 * config edit can't silently drop a header or narrow the source pattern.
 */
describe("security response headers", () => {
  it("declares the four baseline headers with the specced values", () => {
    const map = new Map(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(map.get("X-Content-Type-Options")).toBe("nosniff");
    expect(map.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(map.get("X-Frame-Options")).toBe("DENY");
    expect(map.get("Permissions-Policy")).toBe(
      "camera=(self), microphone=(self), geolocation=()",
    );
  });

  it("keeps camera + microphone allowed for self (compete gate depends on A/V)", () => {
    const permissions = SECURITY_HEADERS.find(
      (h) => h.key === "Permissions-Policy",
    )?.value;
    expect(permissions).toContain("camera=(self)");
    expect(permissions).toContain("microphone=(self)");
    // geolocation stays denied.
    expect(permissions).toContain("geolocation=()");
  });

  it("ships no enforcing or report-only CSP in this PR", () => {
    const keys = SECURITY_HEADERS.map((h) => h.key.toLowerCase());
    expect(keys).not.toContain("content-security-policy");
    expect(keys).not.toContain("content-security-policy-report-only");
  });

  it("applies the headers to every route via headers()", async () => {
    expect(typeof nextConfig.headers).toBe("function");
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    expect(rules[0].headers).toEqual(SECURITY_HEADERS);
  });
});
