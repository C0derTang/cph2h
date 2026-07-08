/**
 * Synthesized audio engine (issue #112) — Clash-Royale-*style* energy without
 * any Clash Royale/Supercell assets: every sound here is built at runtime
 * from Web Audio oscillators/noise + gain envelopes, never a loaded file.
 *
 * Client-only. Every exported entry point guards `typeof window ===
 * "undefined"` and is wrapped so it can never throw — a synth glitch or an
 * autoplay-policy rejection must never break the race UI around it. The
 * synth recipes themselves are not unit tested (per the issue: "do not
 * attempt to test AudioContext"); the pure, testable logic (prefs,
 * transition detection) lives in sibling modules. `initAudioGestures` /
 * `unlockAudioContext` (issue #131) ARE unit tested with a mocked
 * `window`/`AudioContext` constructor — see `tests/audio-engine.test.ts` —
 * since their gesture-timing/idempotency behavior is exactly the bug this
 * module previously had.
 */

import { readBgmEnabled, readSfxEnabled } from "@/lib/audio/prefs";
import type { SfxName } from "@/lib/audio/sfx";

const MASTER_GAIN = 0.9;
const BGM_GAIN = 0.15;

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterCompressor: DynamicsCompressorNode | null = null;
let gestureListenersAttached = false;

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Lazily create (or return) the singleton `AudioContext` + master gain.
 *  Kept as a fallback creation path for call sites (`playSfx`/`startBgm`)
 *  that may run before `initAudioGestures` has had a qualifying gesture —
 *  the primary unlock path is now `initAudioGestures`/`unlockAudioContext`
 *  below, called eagerly from a mount effect so real user gestures create
 *  the context *during* user activation instead of from a timer/poll
 *  callback (see module doc + issue #131). */
function getContext(): { ctx: AudioContext; gain: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (audioContext && masterGain && masterCompressor) return { ctx: audioContext, gain: masterGain };
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    const gain = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    gain.gain.value = MASTER_GAIN;
    compressor.threshold.value = -18;
    compressor.knee.value = 24;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    gain.connect(compressor);
    compressor.connect(ctx.destination);
    audioContext = ctx;
    masterGain = gain;
    masterCompressor = compressor;
    initAudioGestures();
    return { ctx, gain };
  } catch {
    return null;
  }
}

/**
 * Create-or-resume the singleton `AudioContext` from an *actual* user
 * gesture. Creating an `AudioContext` synchronously inside a user-activation
 * event (or resuming an already-created one) starts it running immediately
 * under the browser autoplay policy — unlike creating it lazily from a
 * timer/poll callback, which is born `suspended` and stays that way.
 *
 * Exported so any real gesture handler (the eager listeners below, or an
 * explicit click like an `AudioControls` toggle) can unlock audio. Client
 * -only, idempotent in effect, and never throws.
 */
export function unlockAudioContext(): void {
  if (typeof window === "undefined") return;
  try {
    const context = getContext();
    if (!context) return;
    if (context.ctx.state === "suspended") {
      context.ctx.resume().catch(() => {
        // Best-effort — the next gesture will retry.
      });
    }
  } catch {
    // Never throw.
  }
}

/**
 * Eagerly attach `pointerdown`/`keydown` listeners that unlock the
 * `AudioContext` (see `unlockAudioContext`). Call this once, as early as
 * possible — a mount effect in `RaceAudio`/`AudioControls` — so the
 * listeners exist from the lobby onward, *before* any sound is attempted.
 * The first qualifying gesture (e.g. the READY click) then unlocks audio
 * for the whole session, instead of the context being created for the
 * first time by a non-gesture callback and staying suspended forever.
 *
 * Idempotent (safe to call from multiple mount points), client-only, and
 * never throws.
 */
export function initAudioGestures(): void {
  if (typeof window === "undefined" || gestureListenersAttached) return;
  gestureListenersAttached = true;
  try {
    window.addEventListener("pointerdown", unlockAudioContext, { passive: true });
    window.addEventListener("keydown", unlockAudioContext);
  } catch {
    // Never throw.
  }
}

function safeResume(ctx: AudioContext): void {
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// SFX recipes — each a small, self-contained oscillator + envelope "patch".
// ---------------------------------------------------------------------------

type SfxRecipe = (ctx: AudioContext, destination: AudioNode) => void;

/** One tone: oscillator -> gain envelope -> destination, auto-stopping. */
function tone(
  ctx: AudioContext,
  destination: AudioNode,
  {
    type,
    freq,
    endFreq,
    startTime = 0,
    duration,
    peak = 0.5,
  }: {
    type: OscillatorType;
    freq: number;
    endFreq?: number;
    startTime?: number;
    duration: number;
    peak?: number;
  },
): void {
  const t0 = ctx.currentTime + startTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + duration);
  }
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.02, duration / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Short burst of filtered noise (snare/womp textures). */
function noiseBurst(
  ctx: AudioContext,
  destination: AudioNode,
  { startTime = 0, duration, peak = 0.3, filterFreq = 1200 }: {
    startTime?: number;
    duration: number;
    peak?: number;
    filterFreq?: number;
  },
): void {
  const t0 = ctx.currentTime + startTime;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = filterFreq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(t0);
  source.stop(t0 + duration + 0.02);
}

const RECIPES: Record<SfxName, SfxRecipe> = {
  // Light, high tick — one per countdown second.
  countdown_tick: (ctx, dest) => {
    tone(ctx, dest, { type: "square", freq: 880, duration: 0.08, peak: 0.25 });
  },
  // Big horn/fanfare: a rising triad stab.
  race_start: (ctx, dest) => {
    tone(ctx, dest, { type: "sawtooth", freq: 220, duration: 0.22, peak: 0.4 });
    tone(ctx, dest, { type: "sawtooth", freq: 277, startTime: 0.05, duration: 0.22, peak: 0.4 });
    tone(ctx, dest, { type: "sawtooth", freq: 330, startTime: 0.1, duration: 0.35, peak: 0.45 });
    tone(ctx, dest, { type: "square", freq: 440, startTime: 0.1, duration: 0.4, peak: 0.2 });
  },
  // Triumphant little arpeggio — "your submission passed".
  verdict_ok: (ctx, dest) => {
    tone(ctx, dest, { type: "triangle", freq: 523.25, duration: 0.12, peak: 0.35 });
    tone(ctx, dest, { type: "triangle", freq: 659.25, startTime: 0.09, duration: 0.14, peak: 0.35 });
    tone(ctx, dest, { type: "triangle", freq: 783.99, startTime: 0.18, duration: 0.22, peak: 0.4 });
  },
  // Sad descending womp — "your submission failed".
  verdict_fail: (ctx, dest) => {
    tone(ctx, dest, { type: "sawtooth", freq: 300, endFreq: 140, duration: 0.35, peak: 0.3 });
    noiseBurst(ctx, dest, { duration: 0.08, peak: 0.15, filterFreq: 600 });
  },
  // Quick knock — someone entered the lobby.
  opponent_joined: (ctx, dest) => {
    tone(ctx, dest, { type: "sine", freq: 392, duration: 0.1, peak: 0.3 });
    tone(ctx, dest, { type: "sine", freq: 523.25, startTime: 0.08, duration: 0.14, peak: 0.3 });
  },
  // Victory fanfare — bigger arpeggio + a held top note.
  win: (ctx, dest) => {
    tone(ctx, dest, { type: "sawtooth", freq: 523.25, duration: 0.15, peak: 0.4 });
    tone(ctx, dest, { type: "sawtooth", freq: 659.25, startTime: 0.13, duration: 0.15, peak: 0.4 });
    tone(ctx, dest, { type: "sawtooth", freq: 783.99, startTime: 0.26, duration: 0.15, peak: 0.4 });
    tone(ctx, dest, { type: "square", freq: 1046.5, startTime: 0.39, duration: 0.5, peak: 0.35 });
  },
  // Defeat sting — descending minor interval + a low thud.
  lose: (ctx, dest) => {
    tone(ctx, dest, { type: "sawtooth", freq: 392, duration: 0.2, peak: 0.35 });
    tone(ctx, dest, { type: "sawtooth", freq: 311.13, startTime: 0.18, duration: 0.5, peak: 0.35 });
    noiseBurst(ctx, dest, { startTime: 0.18, duration: 0.15, peak: 0.2, filterFreq: 400 });
  },
};

/** Play one synthesized SFX by name. No-op (silently) if SFX are muted, the
 *  browser lacks Web Audio, or we're server-side. Never throws. */
export function playSfx(name: SfxName): void {
  if (typeof window === "undefined") return;
  try {
    if (!readSfxEnabled()) return;
    const context = getContext();
    if (!context) return;
    safeResume(context.ctx);
    RECIPES[name](context.ctx, context.gain);
  } catch {
    // Synth failures must never break the race UI.
  }
}

// ---------------------------------------------------------------------------
// BGM — a short original chiptune-ish arpeggio loop, low gain so voice chat
// stays audible. Self-scheduling step sequencer rather than a loaded file.
// ---------------------------------------------------------------------------

/** 8-bar-ish arpeggio in a minor key, in scale degrees relative to a root. */
const BGM_STEP_SEMITONES = [0, 3, 7, 10, 7, 3, 0, -2, 0, 3, 7, 12, 7, 3, 0, -5];
const BGM_ROOT_FREQ = 196; // G3
const BGM_STEP_SEC = 0.22;

let bgmGain: GainNode | null = null;
let bgmTimer: ReturnType<typeof setTimeout> | null = null;
let bgmStepIndex = 0;
let bgmPlaying = false;

function semitoneToFreq(root: number, semitones: number): number {
  return root * Math.pow(2, semitones / 12);
}

function scheduleBgmStep(ctx: AudioContext, gain: GainNode): void {
  if (!bgmPlaying) return;
  const semitones = BGM_STEP_SEMITONES[bgmStepIndex % BGM_STEP_SEMITONES.length];
  const freq = semitoneToFreq(BGM_ROOT_FREQ, semitones);
  tone(ctx, gain, {
    type: bgmStepIndex % 4 === 0 ? "square" : "triangle",
    freq,
    duration: BGM_STEP_SEC * 0.85,
    peak: 0.6,
  });
  bgmStepIndex += 1;
  bgmTimer = setTimeout(() => {
    if (!bgmPlaying) return;
    const current = getContext();
    if (!current) return;
    scheduleBgmStep(current.ctx, bgmGain ?? current.gain);
  }, BGM_STEP_SEC * 1000);
}

/** Start the looped BGM (idempotent — a no-op if already playing). No-op if
 *  BGM is muted, Web Audio is unavailable, or we're server-side. Never throws. */
export function startBgm(): void {
  if (typeof window === "undefined") return;
  try {
    if (!readBgmEnabled()) return;
    if (bgmPlaying) return;
    const context = getContext();
    if (!context) return;
    safeResume(context.ctx);
    if (!bgmGain) {
      bgmGain = context.ctx.createGain();
      bgmGain.gain.value = BGM_GAIN;
      bgmGain.connect(context.gain);
    }
    bgmPlaying = true;
    bgmStepIndex = 0;
    scheduleBgmStep(context.ctx, bgmGain);
  } catch {
    bgmPlaying = false;
  }
}

/** Stop the looped BGM (idempotent — a no-op if not playing). Never throws. */
export function stopBgm(): void {
  if (typeof window === "undefined") return;
  try {
    bgmPlaying = false;
    if (bgmTimer != null) {
      clearTimeout(bgmTimer);
      bgmTimer = null;
    }
  } catch {
    // Never throw.
  }
}
