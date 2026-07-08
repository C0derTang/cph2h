/**
 * Email-fallback username derivation (issue #111).
 *
 * The display name itself is no longer user-editable (issue #120) — it
 * follows the linked Codeforces handle, synced in
 * `src/app/api/cf/verify/check/route.ts`. This module now only holds the
 * fallback used before a user links CF, via `deriveUsername` in
 * `src/lib/user.ts`.
 *
 * Kept free of `@/lib/db` and `@clerk/nextjs/server` imports so it stays
 * safe to import from anywhere, including "use client" components, without
 * pulling server-only secrets into the client bundle.
 */

export const MAX_USERNAME_LENGTH = 20;
export const MIN_USERNAME_LENGTH = 2;
export const DEFAULT_USERNAME = "racer";

/**
 * Local-part-of-email fallback used when Clerk has no username or first
 * name. Never store a full email as a username — truncated to
 * `MAX_USERNAME_LENGTH`.
 */
export function emailLocalPart(email: string): string {
  const [local] = email.split("@");
  const username = (local || DEFAULT_USERNAME).slice(0, MAX_USERNAME_LENGTH);
  return username.length < MIN_USERNAME_LENGTH
    ? username.padEnd(MIN_USERNAME_LENGTH, "_")
    : username;
}
