import type { NextConfig } from "next";

/**
 * Baseline security response headers (issue #185).
 *
 * Conservative, low-risk headers applied to every route. Deliberately no
 * enforcing `Content-Security-Policy` here: Clerk and LiveKit both inject
 * inline scripts/styles and open connections to external origins (clerk.*,
 * LiveKit Cloud/SFU WebSockets), and Turbopack's dev HMR uses inline eval +
 * websocket. Authoring an accurate `Content-Security-Policy-Report-Only`
 * requires an authenticated end-to-end `pnpm dev` run with real Clerk/LiveKit
 * credentials to enumerate every needed source — which isn't exercisable in
 * this worktree — so per the issue it is intentionally skipped rather than
 * shipped half-verified. The XSS defense-in-depth stays the render-layer
 * sanitization (server `sanitize-html` + client `dompurify` on the sole
 * `dangerouslySetInnerHTML` in `ProblemPane`).
 *
 * `Permissions-Policy` keeps camera + microphone allowed for `self` because
 * the compete gate (LiveKit A/V) depends on them; geolocation is denied.
 */
const SECURITY_HEADERS: { key: string; value: string }[] = [
  // Block MIME-type sniffing (stops a text response being run as script/HTML).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs (with query/tokens) to cross-origin destinations.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disallow framing entirely — clickjacking defense (no first-party embeds).
  { key: "X-Frame-Options", value: "DENY" },
  // Camera/mic stay allowed for self (compete gate); geolocation fully off.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Every route, including API routes and static assets.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export { SECURITY_HEADERS };
export default nextConfig;
