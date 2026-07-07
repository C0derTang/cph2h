/**
 * Tests for src/lib/audio/prefs.ts
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readBgmEnabled,
  readSfxEnabled,
  writeBgmEnabled,
  writeSfxEnabled,
} from "../src/lib/audio/prefs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readSfxEnabled / readBgmEnabled (no-DOM environment)", () => {
  it("readSfxEnabled defaults to true when localStorage/window is unavailable", () => {
    expect(readSfxEnabled()).toBe(true);
  });

  it("readBgmEnabled defaults to true when localStorage/window is unavailable", () => {
    expect(readBgmEnabled()).toBe(true);
  });

  it("writeSfxEnabled does not throw when localStorage/window is unavailable", () => {
    expect(() => writeSfxEnabled(false)).not.toThrow();
  });

  it("writeBgmEnabled does not throw when localStorage/window is unavailable", () => {
    expect(() => writeBgmEnabled(false)).not.toThrow();
  });
});

/** Minimal in-memory localStorage stand-in for the mocked-window tests below. */
function makeFakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe("readSfxEnabled / writeSfxEnabled (mocked window)", () => {
  it("defaults to true when nothing has been persisted yet", () => {
    vi.stubGlobal("window", { localStorage: makeFakeStorage() });
    expect(readSfxEnabled()).toBe(true);
  });

  it("persists false and reads it back", () => {
    vi.stubGlobal("window", { localStorage: makeFakeStorage() });
    writeSfxEnabled(false);
    expect(readSfxEnabled()).toBe(false);
  });

  it("persists true explicitly and reads it back", () => {
    vi.stubGlobal("window", { localStorage: makeFakeStorage() });
    writeSfxEnabled(false);
    writeSfxEnabled(true);
    expect(readSfxEnabled()).toBe(true);
  });

  it("falls back to the default when localStorage.getItem throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("quota/private-browsing");
        },
        setItem: () => {},
      },
    });
    expect(readSfxEnabled()).toBe(true);
  });

  it("does not throw when localStorage.setItem throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota exceeded");
        },
      },
    });
    expect(() => writeSfxEnabled(false)).not.toThrow();
  });
});

describe("readBgmEnabled / writeBgmEnabled (mocked window)", () => {
  it("defaults to true when nothing has been persisted yet", () => {
    vi.stubGlobal("window", { localStorage: makeFakeStorage() });
    expect(readBgmEnabled()).toBe(true);
  });

  it("persists false and reads it back", () => {
    vi.stubGlobal("window", { localStorage: makeFakeStorage() });
    writeBgmEnabled(false);
    expect(readBgmEnabled()).toBe(false);
  });

  it("is independent of the SFX preference", () => {
    vi.stubGlobal("window", { localStorage: makeFakeStorage() });
    writeSfxEnabled(false);
    expect(readBgmEnabled()).toBe(true);
    expect(readSfxEnabled()).toBe(false);
  });

  it("falls back to the default when localStorage.getItem throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("quota/private-browsing");
        },
        setItem: () => {},
      },
    });
    expect(readBgmEnabled()).toBe(true);
  });

  it("does not throw when localStorage.setItem throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota exceeded");
        },
      },
    });
    expect(() => writeBgmEnabled(false)).not.toThrow();
  });
});
