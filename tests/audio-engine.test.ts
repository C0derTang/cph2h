/**
 * Tests for `initAudioGestures` / `unlockAudioContext` in
 * src/lib/audio/engine.ts (issue #131) — the eager gesture-unlock path.
 *
 * The engine keeps its `AudioContext` singleton and the "listeners already
 * attached" flag as module-level state, so (mirroring `tests/cf-client.test.ts`)
 * every test resets modules and re-imports the engine fresh to avoid
 * bleed-through between cases. Per the module doc, the synth recipes
 * themselves are not tested here — only the gesture-timing/idempotency
 * behavior that was the actual bug.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function importEngine() {
  return await import("../src/lib/audio/engine");
}

/** Minimal fake `AudioContext`: starts `suspended`, `resume()` flips it to
 *  `running` synchronously (before resolving) so tests can assert on state
 *  without awaiting a microtask. */
class FakeAudioContext {
  state: "suspended" | "running" | "closed" = "suspended";
  destination = {};
  compressorNode = {
    threshold: { value: 0 },
    knee: { value: 0 },
    ratio: { value: 0 },
    attack: { value: 0 },
    release: { value: 0 },
    connect: vi.fn(),
  };
  resume = vi.fn(() => {
    this.state = "running";
    return Promise.resolve();
  });
  createGain = vi.fn(() => ({
    gain: { value: 0 },
    connect: vi.fn(),
  }));
  createDynamicsCompressor = vi.fn(() => this.compressorNode);
}

type Listener = () => void;

/** Fake `window`: real `AudioContext` constructor spy + an `addEventListener`
 *  that records listeners by event type so tests can invoke them directly,
 *  simulating an actual pointerdown/keydown gesture. */
function makeFakeWindow(AudioContextCtor: unknown) {
  const listeners: Record<string, Listener[]> = {};
  const addEventListener = vi.fn((type: string, cb: Listener) => {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(cb);
  });
  return {
    window: { AudioContext: AudioContextCtor, addEventListener },
    listeners,
    addEventListener,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("initAudioGestures — SSR safety and idempotency", () => {
  it("does not throw and does nothing when window is undefined (SSR)", async () => {
    const { initAudioGestures } = await importEngine();
    expect(() => initAudioGestures()).not.toThrow();
  });

  it("attaches exactly one pointerdown and one keydown listener", async () => {
    const AudioContextCtor = vi.fn(function AudioContextCtor() {
      return new FakeAudioContext();
    });
    const { window: fakeWindow, addEventListener } = makeFakeWindow(AudioContextCtor);
    vi.stubGlobal("window", fakeWindow);

    const { initAudioGestures } = await importEngine();
    initAudioGestures();

    const types = addEventListener.mock.calls.map((call) => call[0]);
    expect(types).toEqual(["pointerdown", "keydown"]);
  });

  it("is idempotent — calling it again does not attach duplicate listeners", async () => {
    const AudioContextCtor = vi.fn(function AudioContextCtor() {
      return new FakeAudioContext();
    });
    const { window: fakeWindow, addEventListener } = makeFakeWindow(AudioContextCtor);
    vi.stubGlobal("window", fakeWindow);

    const { initAudioGestures } = await importEngine();
    initAudioGestures();
    initAudioGestures();
    initAudioGestures();

    expect(addEventListener).toHaveBeenCalledTimes(2);
  });

  it("never throws even if addEventListener itself throws", async () => {
    vi.stubGlobal("window", {
      AudioContext: vi.fn(function AudioContextCtor() {
        return new FakeAudioContext();
      }),
      addEventListener: () => {
        throw new Error("boom");
      },
    });

    const { initAudioGestures } = await importEngine();
    expect(() => initAudioGestures()).not.toThrow();
  });
});

describe("initAudioGestures — gesture handler create/resume behavior", () => {
  it("creates the AudioContext only once a qualifying gesture fires, not at attach time", async () => {
    const AudioContextCtor = vi.fn(function AudioContextCtor() {
      return new FakeAudioContext();
    });
    const { window: fakeWindow, listeners } = makeFakeWindow(AudioContextCtor);
    vi.stubGlobal("window", fakeWindow);

    const { initAudioGestures } = await importEngine();
    initAudioGestures();
    expect(AudioContextCtor).not.toHaveBeenCalled();

    listeners["pointerdown"][0]();
    expect(AudioContextCtor).toHaveBeenCalledTimes(1);
  });

  it("a gesture creates a running context: create-during-activation resumes a fresh suspended context", async () => {
    const AudioContextCtor = vi.fn(function AudioContextCtor() {
      return new FakeAudioContext();
    });
    const { window: fakeWindow, listeners } = makeFakeWindow(AudioContextCtor);
    vi.stubGlobal("window", fakeWindow);

    const { initAudioGestures } = await importEngine();
    initAudioGestures();
    listeners["keydown"][0]();

    const created = AudioContextCtor.mock.results[0]?.value as FakeAudioContext;
    expect(created.resume).toHaveBeenCalledTimes(1);
    expect(created.state).toBe("running");
  });

  it("routes the master gain through a compressor before the destination", async () => {
    const AudioContextCtor = vi.fn(function AudioContextCtor() {
      return new FakeAudioContext();
    });
    const { window: fakeWindow, listeners } = makeFakeWindow(AudioContextCtor);
    vi.stubGlobal("window", fakeWindow);

    const { initAudioGestures } = await importEngine();
    initAudioGestures();
    listeners["pointerdown"][0]();

    const created = AudioContextCtor.mock.results[0]?.value as FakeAudioContext;
    const masterGain = created.createGain.mock.results[0]?.value;
    expect(created.createDynamicsCompressor).toHaveBeenCalledTimes(1);
    expect(created.compressorNode.threshold.value).toBe(-18);
    expect(created.compressorNode.ratio.value).toBe(8);
    expect(masterGain.connect).toHaveBeenCalledWith(created.compressorNode);
    expect(created.compressorNode.connect).toHaveBeenCalledWith(created.destination);
  });

  it("a later gesture resumes an existing-but-suspended context without recreating it", async () => {
    const AudioContextCtor = vi.fn(function AudioContextCtor() {
      return new FakeAudioContext();
    });
    const { window: fakeWindow, listeners } = makeFakeWindow(AudioContextCtor);
    vi.stubGlobal("window", fakeWindow);

    const { initAudioGestures } = await importEngine();
    initAudioGestures();
    const gesture = listeners["pointerdown"][0];

    gesture();
    const created = AudioContextCtor.mock.results[0]?.value as FakeAudioContext;
    expect(AudioContextCtor).toHaveBeenCalledTimes(1);

    // Simulate the browser re-suspending (e.g. tab backgrounded) and a
    // second real gesture arriving — should resume the same instance, not
    // construct a new one.
    created.state = "suspended";
    created.resume.mockClear();
    gesture();

    expect(AudioContextCtor).toHaveBeenCalledTimes(1);
    expect(created.resume).toHaveBeenCalledTimes(1);
  });

  it("does not call resume when the context is already running", async () => {
    const AudioContextCtor = vi.fn(function AudioContextCtor() {
      return new FakeAudioContext();
    });
    const { window: fakeWindow, listeners } = makeFakeWindow(AudioContextCtor);
    vi.stubGlobal("window", fakeWindow);

    const { initAudioGestures } = await importEngine();
    initAudioGestures();
    const gesture = listeners["pointerdown"][0];

    gesture();
    const created = AudioContextCtor.mock.results[0]?.value as FakeAudioContext;
    created.resume.mockClear();
    // Already running from the first gesture — a further gesture should not
    // call resume again.
    gesture();

    expect(created.resume).not.toHaveBeenCalled();
  });
});

describe("unlockAudioContext", () => {
  it("does not throw when window is undefined (SSR)", async () => {
    const { unlockAudioContext } = await importEngine();
    expect(() => unlockAudioContext()).not.toThrow();
  });

  it("creates the context when absent and resumes it (e.g. an AudioControls toggle click)", async () => {
    const AudioContextCtor = vi.fn(function AudioContextCtor() {
      return new FakeAudioContext();
    });
    const { window: fakeWindow } = makeFakeWindow(AudioContextCtor);
    vi.stubGlobal("window", fakeWindow);

    const { unlockAudioContext } = await importEngine();
    unlockAudioContext();

    expect(AudioContextCtor).toHaveBeenCalledTimes(1);
    const created = AudioContextCtor.mock.results[0]?.value as FakeAudioContext;
    expect(created.resume).toHaveBeenCalledTimes(1);
    expect(created.state).toBe("running");
  });

  it("is a no-op (never throws) when no AudioContext constructor is available", async () => {
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    const { unlockAudioContext } = await importEngine();
    expect(() => unlockAudioContext()).not.toThrow();
  });
});
