/**
 * Username validation, email-fallback derivation, and the dashboard
 * migration-nudge predicate/storage — all shared, dependency-light (issue
 * #111).
 *
 * Kept free of `@/lib/db` and `@clerk/nextjs/server` imports so this module
 * is safe to import from both the `PUT /api/settings/username` route and
 * "use client" components (the username form's client-side pre-flight
 * check, and the dashboard's email-username banner) without pulling
 * server-only secrets into the client bundle.
 */

import { z } from "zod";

export const MIN_USERNAME_LENGTH = 2;
export const MAX_USERNAME_LENGTH = 20;

/**
 * Must start and end with a letter or number; `. _ -` and spaces are only
 * allowed between two alphanumerics (no leading/trailing separator, no `@`).
 */
export const USERNAME_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._ -]*[A-Za-z0-9])?$/;

const USERNAME_FORMAT_MESSAGE =
  "Username must start and end with a letter or number, and can only contain letters, numbers, spaces, and . _ - in between.";

export const usernameSchema = z.object({
  username: z
    .string()
    .trim()
    .min(
      MIN_USERNAME_LENGTH,
      `Username must be at least ${MIN_USERNAME_LENGTH} characters.`,
    )
    .max(
      MAX_USERNAME_LENGTH,
      `Username must be ${MAX_USERNAME_LENGTH} characters or fewer.`,
    )
    .regex(USERNAME_PATTERN, USERNAME_FORMAT_MESSAGE),
});

export type UsernameInput = z.infer<typeof usernameSchema>;

/** Pure validity check, useful for client-side pre-flight before hitting the API. */
export function isUsernameValid(username: string): boolean {
  return usernameSchema.safeParse({ username }).success;
}

// ---------------------------------------------------------------------------
// Email-fallback derivation (deriveUsername in src/lib/user.ts)
// ---------------------------------------------------------------------------

/**
 * Local-part-of-email fallback used when Clerk has no username or first
 * name. Never store a full email as a username — truncated to
 * `MAX_USERNAME_LENGTH`.
 */
export function emailLocalPart(email: string): string {
  const [local] = email.split("@");
  return (local || email).slice(0, MAX_USERNAME_LENGTH);
}

// ---------------------------------------------------------------------------
// Dashboard migration nudge: "Pick a display name" banner
// ---------------------------------------------------------------------------

/**
 * True when this username still looks like the old full-email fallback
 * (pre-#111 signups). Drives the dashboard's dismissible nudge banner.
 */
export function looksLikeEmailUsername(username: string): boolean {
  return username.includes("@");
}

const BANNER_DISMISSED_KEY = "cph2h:username-nudge:dismissed";

function hasLocalStorage(): boolean {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

/** Whether the "pick a display name" banner was dismissed. SSR-safe. */
export function isUsernameBannerDismissed(): boolean {
  if (!hasLocalStorage()) return false;
  try {
    return window.localStorage.getItem(BANNER_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the dismissal. No-ops if storage is unavailable/full — the banner
 * just reappears next session, which is not a functional break. */
export function dismissUsernameBanner(): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(BANNER_DISMISSED_KEY, "1");
  } catch {
    // Best-effort — see comment above.
  }
}
