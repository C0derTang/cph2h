/**
 * Race vignettes (issue #194) — four miniature animated mock-UI panels that
 * replace the landing page's wordy step paragraphs and the retired features
 * grid (each panel absorbs one feature's pitch: video, Elo, CF-verified).
 * Structural template is `VersusPoster` (src/app/page.tsx): a `panel` plate,
 * `ticker` header/footer, identity split via the player-self/opponent
 * tokens, and `font-mono tabular-nums` for every live-looking digit (the
 * numeral rule — the display face's digits aren't tabular).
 *
 * Every panel is `aria-hidden` and purely decorative: the step captions in
 * page.tsx carry the real information, so the page reads completely without
 * these. Motion is pure CSS (`vignette-swap` / `vignette-scan` /
 * `vignette-wave` in globals.css) — no JS state, no IntersectionObserver.
 * Under `prefers-reduced-motion: reduce` every panel freezes on its final,
 * resolved state (matched / AC / +12) for free — see the CSS comment.
 */

import { cn } from "@/lib/utils";

/** A tiny 5-bar audio waveform, staggered via inline `animation-delay` so
 * the bars don't bounce in lockstep. Static (pre-animation) heights already
 * read as a plausible frozen waveform under reduced motion. */
function WaveformBars({ tone }: { tone: "self" | "opponent" }) {
  const heights = ["h-2", "h-3.5", "h-2.5", "h-4", "h-2"];
  const barColor =
    tone === "self" ? "bg-player-self/70" : "bg-player-opponent/70";
  return (
    <div className="flex h-4 items-end gap-0.5">
      {heights.map((h, i) => (
        <span
          key={i}
          style={{ animationDelay: `${i * 110}ms` }}
          className={cn("vignette-wave-bar w-1", h, barColor)}
        />
      ))}
    </div>
  );
}

/** Step 01 — matchmaking. Layer A: a "searching…" scan sweep. Layer B (the
 * resolved / default frame): the matched pairing with a rating-delta chip. */
export function QueueVignette() {
  return (
    <div aria-hidden className="panel flex h-32 flex-col overflow-hidden">
      <div className="ticker px-3 py-1.5">
        <span>queue</span>
      </div>
      <div className="vignette-stack flex-1 items-center px-3">
        <div className="vignette-layer-a relative flex items-center overflow-hidden">
          <span className="font-mono text-[11px] tracking-wide text-muted-foreground">
            searching…
          </span>
          <span className="vignette-scan-bar absolute inset-y-1 left-0 w-10 bg-player-self/25" />
        </div>
        <div className="vignette-layer-b flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[11px] tabular-nums">
            <span className="text-player-self">you 1540</span>
            <span className="text-muted-foreground"> · vs · </span>
            <span className="text-player-opponent">maras 1552</span>
          </span>
          {/* Digit-bearing stamps override the stamp's display face — the
              numeral rule holds inside chrome too. */}
          <span className="stamp shrink-0 font-mono text-[9px] text-verdict-ok tabular-nums">
            Δ12
          </span>
        </div>
      </div>
    </div>
  );
}

/** Step 02 — the race itself. Two hairline-bordered video tiles (self
 * yellow / opponent crimson), each with its own waveform. No layer swap —
 * this vignette just breathes continuously. Absorbs the "voice and video
 * built in" feature. */
export function FaceOffVignette() {
  return (
    <div aria-hidden className="panel flex h-32 flex-col overflow-hidden">
      <div className="grid flex-1 grid-cols-2 gap-1.5 p-2">
        <div className="flex flex-col items-center justify-center gap-1.5 border border-player-self/50 bg-background/40">
          <span className="eyebrow text-player-self">You</span>
          <WaveformBars tone="self" />
        </div>
        <div className="flex flex-col items-center justify-center gap-1.5 border border-player-opponent/50 bg-background/40">
          <span className="eyebrow text-player-opponent">Opp</span>
          <WaveformBars tone="opponent" />
        </div>
      </div>
      <div className="ticker justify-between px-3 py-1.5">
        <span>1794C</span>
        <span className="font-mono tabular-nums">40:00</span>
      </div>
    </div>
  );
}

/** Step 03 — judging. Layer A: a live verdict feed (a fail, then a pending
 * row pulsing). Layer B (the resolved / default frame): the AC stamp.
 * Absorbs the "Codeforces-verified" feature. */
export function VerdictVignette() {
  return (
    <div aria-hidden className="panel flex h-32 flex-col overflow-hidden">
      <div className="vignette-stack flex-1 items-center px-3">
        <div className="vignette-layer-a flex flex-col justify-center gap-1 font-mono text-[11px] tabular-nums">
          <span className="text-verdict-fail">#331 WA</span>
          <span className="text-verdict-pending motion-safe:animate-pulse">
            #332 testing
          </span>
        </div>
        <div className="vignette-layer-b flex items-center justify-center">
          <span className="stamp text-lg text-verdict-ok">AC</span>
        </div>
      </div>
      <div className="ticker px-3 py-1.5">
        <span>src: codeforces.com</span>
      </div>
    </div>
  );
}

/** Step 04 — the payoff. Layer A: both ratings sitting unresolved. Layer B
 * (the resolved / default frame): both deltas landed plus a "BODIED." stamp.
 * Absorbs the "real Elo ladder" feature. */
export function EloVignette() {
  return (
    <div aria-hidden className="panel flex h-32 flex-col overflow-hidden">
      <div className="ticker px-3 py-1.5">
        <span>elo</span>
      </div>
      <div className="vignette-stack flex-1 items-center px-3">
        <div className="vignette-layer-a flex flex-col justify-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground">
          <span>you 1540</span>
          <span>maras 1565</span>
        </div>
        <div className="vignette-layer-b flex flex-col justify-center gap-1">
          <span className="flex items-center justify-between gap-1.5 font-mono text-[11px] tabular-nums">
            <span className="text-player-self">you 1540 → 1552</span>
            <span className="stamp font-mono text-[9px] text-verdict-ok tabular-nums">
              +12
            </span>
          </span>
          <span className="flex items-center justify-between gap-1.5 font-mono text-[11px] tabular-nums">
            <span className="text-player-opponent">maras 1565 → 1553</span>
            <span className="stamp font-mono text-[9px] text-player-opponent tabular-nums">
              −12
            </span>
          </span>
          <span className="stamp self-end text-[9px] text-player-self">
            BODIED.
          </span>
        </div>
      </div>
    </div>
  );
}
