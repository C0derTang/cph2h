/**
 * Race vignettes (issue #194, rebuilt in #197) — four miniature animated
 * mock-UI panels that replace the landing page's wordy step paragraphs and
 * the retired features grid (each panel absorbs one feature's pitch: video,
 * Elo, CF-verified). Each panel is a faithful miniature of the real screen
 * it depicts — copied class recipes, not invented layouts: `QueueVignette`
 * mirrors the `/queue` searching card, `FaceOffVignette` mirrors
 * `VideoTiles`' spotlight + self PiP, `VerdictVignette` mirrors
 * `VerdictFeed`'s row/ticker recipe, `EloVignette` mirrors `ResultCard`'s
 * stamp heading + `PlayerResultTile` grid.
 *
 * Every panel is `aria-hidden` and purely decorative: the step captions in
 * page.tsx carry the real information, so the page reads completely without
 * these. Motion is pure CSS (`vignette-swap` / `vignette-wave` in
 * globals.css) — no JS state, no IntersectionObserver. Layer swaps are eased
 * crossfades (opacity ramp + a slight translateY drift on the entering
 * layer), not hard snaps. Under `prefers-reduced-motion: reduce` every panel
 * freezes on its final, resolved state (matched / OK / +12) for free — see
 * the CSS comment.
 */

import { CheckCircle2, Clock3, Trophy, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/** A tiny 5-bar audio waveform, staggered via inline `animation-delay` so
 * the bars don't bounce in lockstep. Static (pre-animation) heights already
 * read as a plausible frozen waveform under reduced motion. `size="sm"` is
 * the self-PiP scale inside `FaceOffVignette`. */
function WaveformBars({
  tone,
  size = "md",
}: {
  tone: "self" | "opponent";
  size?: "md" | "sm";
}) {
  const heights =
    size === "sm"
      ? ["h-1", "h-1.5", "h-1", "h-2", "h-1"]
      : ["h-2", "h-3.5", "h-2.5", "h-4", "h-2"];
  const barColor =
    tone === "self" ? "bg-player-self/70" : "bg-player-opponent/70";
  return (
    <div
      className={cn("flex items-end gap-0.5", size === "sm" ? "h-2" : "h-4")}
    >
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

/** Mirrors `PlayerResultTile` (ResultCard.tsx) at miniature scale: an
 * identity-colored initial chip, name, and a delta that's verdict-toned
 * (never identity-toned) — `null` renders the real component's "—". */
function MiniPlayerTile({
  initial,
  name,
  delta,
  tone,
  winner,
}: {
  initial: string;
  name: string;
  delta: number | null;
  tone: "self" | "opponent";
  winner: boolean;
}) {
  const isSelf = tone === "self";
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 p-2 text-center",
        winner && (isSelf ? "bg-player-self/10" : "bg-player-opponent/10"),
        !winner && "opacity-60",
      )}
    >
      <span
        className={cn(
          "flex size-5 items-center justify-center font-display text-[10px] font-bold",
          isSelf
            ? "bg-player-self text-player-self-foreground"
            : "bg-player-opponent text-player-opponent-foreground",
        )}
      >
        {initial}
      </span>
      <span className="truncate text-[10px] font-medium">{name}</span>
      <span
        className={cn(
          "font-mono text-xs font-semibold tabular-nums",
          delta != null && delta > 0 && "text-verdict-ok",
          delta != null && delta < 0 && "text-verdict-fail",
          delta == null && "text-muted-foreground",
        )}
      >
        {delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta}`}
      </span>
    </div>
  );
}

/** Step 01 — matchmaking. Mirrors the `/queue` searching card
 * (queue/page.tsx:218-256). Layer A: the searching frame — a `// scan.active`
 * `hud-meta` ornament above a two-cell `stat-plate` grid (Elapsed /
 * Rating band), exactly the real card's stat layout. Layer B (the resolved /
 * default frame): the matched pairing row with a rating-delta chip, plus the
 * real queue's "Opponent found." copy. */
export function QueueVignette() {
  return (
    <div aria-hidden className="panel flex h-40 flex-col overflow-hidden">
      <div className="ticker px-3 py-1.5">
        <span>quick match</span>
      </div>
      <div className="vignette-stack flex-1 items-center px-3">
        <div className="vignette-layer-a flex flex-col justify-center gap-2">
          <span className="hud-meta text-muted-foreground/80">
            {"// scan.active"}
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="stat-plate p-1.5">
              <p className="eyebrow text-muted-foreground">Elapsed</p>
              <p className="mt-0.5 font-mono text-xs font-semibold tabular-nums">
                0:07
              </p>
            </div>
            <div className="stat-plate p-1.5">
              <p className="eyebrow text-muted-foreground">Rating band</p>
              <p className="mt-0.5 font-mono text-xs font-semibold tabular-nums">
                ±100
              </p>
            </div>
          </div>
        </div>
        <div className="vignette-layer-b flex flex-col justify-center gap-1.5">
          <span className="font-display text-xs tracking-tight uppercase">
            Opponent found.
          </span>
          <div className="flex items-center justify-between gap-2">
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
    </div>
  );
}

/** Step 02 — the race itself. Mirrors `VideoTiles`' opponent spotlight +
 * self PiP (VideoTiles.tsx:83-153), not the old equal-tiles layout (issue
 * #67 / #196 follow-up): one ringed `aspect-video` opponent tile with a
 * full-width bottom name band, and a self PiP docked in the corner with its
 * own ringed tile and name chip. No layer swap — this vignette just breathes
 * continuously via the two waveforms. Absorbs the "voice and video built in"
 * feature. */
export function FaceOffVignette() {
  return (
    <div aria-hidden className="panel flex h-40 flex-col overflow-hidden">
      <div className="flex flex-1 items-center justify-center p-2">
        <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius)] bg-muted/40 ring-2 ring-player-opponent/70">
          <div className="flex size-full items-center justify-center">
            <WaveformBars tone="opponent" />
          </div>
          <span className="absolute inset-x-0 bottom-0 truncate bg-player-opponent/85 px-2 py-1 text-[11px] font-medium text-player-opponent-foreground">
            maras
          </span>

          <div className="absolute right-1.5 bottom-6 w-[30%] min-w-14">
            <div className="relative aspect-video size-full overflow-hidden rounded-[var(--radius-sm)] bg-muted/60 ring-2 ring-player-self">
              <div className="flex size-full items-center justify-center">
                <WaveformBars tone="self" size="sm" />
              </div>
              <span className="absolute inset-x-0 bottom-0 truncate bg-player-self/85 px-1 py-0.5 text-[9px] font-medium text-player-self-foreground">
                You
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="ticker justify-between px-3 py-1.5">
        <span>1794C</span>
        <span className="font-mono tabular-nums">40:00</span>
      </div>
    </div>
  );
}

/** Step 03 — judging. Mirrors `VerdictFeed` (VerdictFeed.tsx:53-121): a
 * `Watching CF` poll indicator in the ticker, and two feed rows using the
 * real hairline row recipe. Row 1 (static): a stamped `WRONG_ANSWER` — the
 * real feed always shows the raw CF verdict string. Row 2 is the swap: layer
 * A is the real pending treatment (plain mono `judging…`, not a stamp),
 * layer B (the resolved / default frame) is a stamped `OK`. Absorbs the
 * "Codeforces-verified" feature. */
export function VerdictVignette() {
  return (
    <div aria-hidden className="panel flex h-40 flex-col overflow-hidden">
      <div className="ticker justify-between px-3 py-1.5">
        <span>verdicts</span>
        <span className="flex items-center gap-1.5 text-verdict-pending">
          <span className="size-1.5 rounded-full bg-verdict-pending motion-safe:animate-pulse" />
          Watching CF
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1.5 p-2.5">
        <div className="flex items-center justify-between gap-2 rounded-none border border-border bg-background/40 px-2.5 py-1.5 text-xs">
          <span className="flex min-w-0 items-center gap-1.5">
            <XCircle
              className="size-3.5 shrink-0 text-verdict-fail"
              aria-hidden
            />
            <span className="truncate font-medium">Opponent</span>
          </span>
          <span className="stamp max-w-[55%] truncate text-[10px] text-verdict-fail">
            WRONG_ANSWER
          </span>
        </div>
        <div className="rounded-none border border-border bg-background/40 px-2.5 py-1.5 text-xs">
          <div className="vignette-stack">
            <div className="vignette-layer-a flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <Clock3
                  className="size-3.5 shrink-0 text-verdict-pending"
                  aria-hidden
                />
                <span className="truncate font-medium">You</span>
              </span>
              <span className="shrink-0 font-mono text-[10px] tracking-[0.12em] text-verdict-pending uppercase">
                judging…
              </span>
            </div>
            <div className="vignette-layer-b flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <CheckCircle2
                  className="size-3.5 shrink-0 text-verdict-ok"
                  aria-hidden
                />
                <span className="truncate font-medium">You</span>
              </span>
              <span className="stamp shrink-0 text-[10px] text-verdict-ok">
                OK
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Step 04 — the payoff. Mirrors `ResultCard` (ResultCard.tsx:97-141,
 * 205-251): a `stamp` "Bodied." heading over a two-column
 * `divide-x`/`border-t` grid of `PlayerResultTile` miniatures. Layer A: both
 * tiles pre-resolve — deltas render the real null-delta "—", no heading.
 * Layer B (the resolved / default frame): deltas landed (+12 / −12, both
 * verdict-toned per the real component, never identity-toned) under the
 * "Bodied." stamp. Both layers bottom-align their tile grid so the swap
 * reads as the heading landing above a fixed grid, not a jump. */
export function EloVignette() {
  return (
    <div aria-hidden className="panel flex h-40 flex-col overflow-hidden">
      <div className="ticker justify-between px-3 py-1.5">
        <span>race &middot; result</span>
        <Trophy className="size-3 shrink-0 text-verdict-ok" aria-hidden />
      </div>
      <div className="vignette-stack flex-1">
        <div className="vignette-layer-a flex flex-col justify-end">
          <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
            <MiniPlayerTile
              initial="Y"
              name="you"
              delta={null}
              tone="self"
              winner={false}
            />
            <MiniPlayerTile
              initial="M"
              name="maras"
              delta={null}
              tone="opponent"
              winner={false}
            />
          </div>
        </div>
        <div className="vignette-layer-b flex flex-col justify-end">
          <p className="stamp mx-auto mt-2 mb-1 text-[11px] text-player-self">
            Bodied.
          </p>
          <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
            <MiniPlayerTile
              initial="Y"
              name="you"
              delta={12}
              tone="self"
              winner
            />
            <MiniPlayerTile
              initial="M"
              name="maras"
              delta={-12}
              tone="opponent"
              winner={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
