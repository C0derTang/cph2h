/**
 * Local-storage draft persistence for the Monaco editor (issue #12).
 *
 * A "draft" is the in-progress contents of an editor, keyed by an
 * application-supplied scope (e.g. `race:{id}` or `settings:template`).
 * Drafts are a best-effort convenience — a full or disabled storage quota
 * must never break the editor, so every storage access is wrapped and
 * failures are swallowed.
 */

const DRAFT_KEY_PREFIX = "cph2h:draft:";

/** Debounce window (ms) between edits and the localStorage write. */
export const DRAFT_SAVE_DEBOUNCE_MS = 500;

/**
 * Build the localStorage key for a draft scope, e.g. `buildDraftKey("race:1")`
 * -> `"cph2h:draft:race:1"`.
 */
export function buildDraftKey(scope: string): string {
  const trimmed = scope.trim();
  if (!trimmed) {
    throw new Error("buildDraftKey: scope must be a non-empty string");
  }
  return `${DRAFT_KEY_PREFIX}${trimmed}`;
}

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** Read a previously saved draft by its full storage key, or `null` if absent/unavailable. */
export function readDraft(key: string): string | null {
  if (!hasLocalStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Persist a draft under its full storage key. No-ops if storage is unavailable/full. */
export function writeDraft(key: string, value: string): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be full or disabled (e.g. private browsing) — drafts are a
    // best-effort convenience, never required for correctness.
  }
}

/** Remove a saved draft, e.g. after an explicit reset. */
export function clearDraft(key: string): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // See writeDraft.
  }
}
