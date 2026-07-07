/**
 * Persisted audio preferences (issue #112): independent SFX/BGM mute toggles,
 * both default ON. Mirrors the SSR-safe wrap-and-swallow localStorage pattern
 * from `src/lib/race/av-requirements.ts:62-105` — a full/disabled/absent
 * `localStorage` (SSR, private browsing, quota) must never throw; it just
 * falls back to the default (on).
 */

const SFX_STORAGE_KEY = "cph2h:audio:sfx";
const BGM_STORAGE_KEY = "cph2h:audio:bgm";

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readEnabled(key: string): boolean {
  if (!hasLocalStorage()) return true;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return true;
    return raw !== "0";
  } catch {
    return true;
  }
}

function writeEnabled(key: string, enabled: boolean): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(key, enabled ? "1" : "0");
  } catch {
    // Storage may be full or disabled (e.g. private browsing) — best-effort
    // persistence only; the in-memory value still governs this session.
  }
}

/** Read the persisted SFX-enabled preference, defaulting to `true`. */
export function readSfxEnabled(): boolean {
  return readEnabled(SFX_STORAGE_KEY);
}

/** Persist the SFX-enabled preference. No-op if storage is unavailable/full. */
export function writeSfxEnabled(enabled: boolean): void {
  writeEnabled(SFX_STORAGE_KEY, enabled);
}

/** Read the persisted BGM-enabled preference, defaulting to `true`. */
export function readBgmEnabled(): boolean {
  return readEnabled(BGM_STORAGE_KEY);
}

/** Persist the BGM-enabled preference. No-op if storage is unavailable/full. */
export function writeBgmEnabled(enabled: boolean): void {
  writeEnabled(BGM_STORAGE_KEY, enabled);
}
