# cph2h design system — the Cyberpunk Glitch HUD

This is the canonical visual spec (**v4, "cyberpunk glitch HUD" — supersedes
the v3 "neon glass grid" wholesale**). Every UI issue codes against it. If a
surface you are building isn't sketched here, derive it from the tokens and
surface recipes below rather than inventing new colors, shapes, or one-off
cards. All values are copied verbatim from `src/app/globals.css` — if this doc
and the CSS ever disagree, the CSS wins and the doc is stale.

## Direction

**A glitching arcade HUD, not a glass showroom.** cph2h is a 1v1 duel with
cameras on and mouths running: two people, one problem, one clock, one winner.
The interface fuses Cyberpunk-2077 menu chrome with tetr.io main-menu energy —
**a flat near-black glitch ground under a fixed scanline + film-grain texture,
matte hard-edged plates with hairline borders and corner brackets, ONE huge
neon graffiti hero word per screen with an RGB-split glitch, scattered tiny
mono metadata chrome, acid-yellow self vs crimson opponent.** Confidence comes
from hard edges, neon bloom, and restraint — not frosted glass and soft light.

Four ideas carry the whole system:

1. **The versus axis.** You are always **self** (`--player-self`, acid
   yellow, `oklch(0.92 0.19 100)` on dark). Your opponent is always
   **opponent** (`--player-opponent`, crimson, `oklch(0.64 0.26 25)` on dark).
   These two never swap and never appear as decoration — a color on screen
   means an identity. The ground carries both dimly: a yellow pool from the
   top-left, a crimson pool from the bottom-right (`spotlight` / the base
   `body` pools, all ≤12% alpha), so the versus axis is ambient before it's
   ever a UI element.
2. **The plate.** Content lives on matte hard-edged HUD plates (`panel`):
   near-opaque `--card` fill, a 1px hairline border, a hardened `--radius:
   0.125rem`, a shallow floor shadow — **no backdrop-filter anywhere**. Hero
   plates earn corner brackets (`bracket-frame`); everything sits over the
   scanline + grain `noise-ground`. The game-menu screens keep the tetr.io
   slabs (`menu-row`), now matte and glitching on hover.
3. **The hero word.** Each screen carries exactly ONE huge aria-hidden neon
   graffiti word (Sedgwick Ave Display via the `HeroWord` component) with an
   RGB-split glitch — "bars", "seek", "bodied". It is set dressing, never UI
   text, never a number; the screen must read completely without it. Around
   it, tiny scattered `hud-meta` mono chrome (route markers, build tags) does
   the quiet world-building.
4. **The stamp.** Verdict moments are stamped, not animated with confetti: a
   square stencil frame reads **"Bodied."** on a result hero, **AC / WA** in
   the feed — hard-edged (radius 0), 2px border, neon bloom via layered
   `text-shadow` in the verdict's own ink.

Dark ("the glitch ground") is the hero and the default (`<html class="dark">`,
set via `:root.dark` so it wins the cascade regardless of source order). Light
("daylight HUD") is warm paper with the same inks, darkened for contrast —
fully defined and accessible for a future toggle, but design and screenshot
against dark. **No halftone, no speech bubbles, no rotation/sticker energy, no
comic-panel motifs — this is a HUD, not a poster.**

## Brand voice

Unchanged from v2 — the visual language changed, the voice didn't. cph2h
talks like a battle rapper who already knows they've won: **cold, superior,
funny because it's deadpan.** Not cartoonish, not jokey. The tagline is
**"Shittalk your way to a higher rating."**

Profanity is **seasoning, not wallpaper** — full explicit where it lands
hardest (the hero, taglines, win/loss result screens), clean-but-cutting
everywhere else.

### Canonical copy (writers extend in this voice)

| Surface | Copy |
| --- | --- |
| Landing hero | **Same problem. Same clock. Catch these bars.** |
| Tagline | **Shittalk your way to a higher rating.** |
| Win result | **Bodied.** |
| Loss result | You got bodied. |
| Empty leaderboard | Nobody's stepped up. |
| No-match banner | No problems match. Widen the filters or keep hiding. |
| Forfeit button | Throw in the towel |
| Waiting for opponent | They're stalling. |
| Leaderboard name | **The Ladder** |

### Voice rules

- **Data stays data.** Real CF verdict strings (`WRONG_ANSWER`, `ACCEPTED`),
  ratings, Elo deltas, handles, timestamps are **never** rewritten. Attitude
  lives in the copy *around* the data, never inside it.
- **Deadpan and superior, not loud.** The line is funnier delivered flat.
  "Nobody's stepped up." beats an exclamation. Let the confidence sit.
- **Active, second-person.** "Step up," "Throw in the towel" — aimed at
  *you* or *them*, never at "the user."
- **One explicit beat per surface, max.** Pick the moment that hits hardest
  and let the rest play straight.
- **Errors and empties still do their job.** Say what happened and how to
  fix it, in-voice ("No problems match. Widen the filters or keep hiding."
  names the fix and keeps the register). Never vague, never an apology.
- **Never punch at protected traits** — the target is always skill/effort/
  nerve.

## Typography

Three UI roles plus one decorative face, loaded via `next/font/google` in
`layout.tsx`.

| Role | Face | Tailwind | Use for |
| --- | --- | --- | --- |
| Display / UI | **Chakra Petch** | `font-display`, `font-heading` | `h1`–`h3`, wordmark, VS names, stamps, game-menu slab labels, slab buttons — **uppercase** |
| Body | **Geist Sans** | `font-sans` (default) | paragraphs, descriptions, form labels |
| Data / mono | **Geist Mono** | `font-mono` | problem IDs, verdict feed, eyebrows, tickers, `hud-meta`, code, **and every live number** |
| Graffiti (decorative) | **Sedgwick Ave Display** | `font-graffiti` (via `--font-graffiti`) | **exactly one aria-hidden hero word per screen via `HeroWord` — never UI text, never numbers** |

`font-heading` and `font-display` are the same face (Chakra Petch) —
`font-heading` exists for the shadcn `CardTitle` contract; prefer
`font-display` in new code. Chakra Petch is a squared techno-grotesque with a
gaming-HUD cadence, loaded at weights 400/500/600/700 (`layout.tsx`) so the
same face carries quiet UI labels (500/600) and loud lockups (700). It **must
be set uppercase** for headings/lockups/stamps — it's a HUD letterform, not a
sentence face. Track it tight (`tracking-tight`) on big lockups.

Sedgwick Ave Display (weight 400 only) never appears outside the `hero-word`
utility / `HeroWord` component. It is a spray-paint face: unreadable at UI
sizes, decorative at hero sizes — that's the point.

### The numeral rule (load-bearing)

**Chakra Petch's digits are not tabular** — the numerals are uneven width and
jitter when a value changes in place. (Sedgwick Ave Display never renders
numbers at all.) Therefore, unchanged from v2/v3:

- **Live / animated numbers use `font-mono tabular-nums`, never
  `font-display`.** This means the race clock, countdown, live sample
  counts, and any number that ticks or updates while you watch it. See
  `RaceHUD`'s countdown/timer (`font-mono text-4xl font-semibold
  tabular-nums`) and `Lobby`'s broadcast countdown (`font-mono text-6xl
  font-semibold tabular-nums`) for the canonical shipped pattern.
- **Static display numbers may use `font-display`** for HUD punch — a step
  index ("01"…"04", see the landing "how it works" list), a headline figure
  that never changes on screen. When in doubt, or when the number sits in a
  scoreboard column next to a live one, use mono so the column stays aligned.
- Ratings and Elo deltas in scoreboards/history: prefer **mono
  tabular-nums** (aligned columns that update between races) — the
  dashboard `IdentityPlate`'s Elo/CF-rating/race-count `stat-plate`s all do
  this. A same-render, non-ticking figure (the dashboard `Record` tile's
  W–L, a result card's Elo delta) may use `font-display tabular-nums`
  instead, but never in a column that also holds a live number.

### Type scale & rules

| Token | Size / leading | Notes |
| --- | --- | --- |
| Hero word | `clamp(4rem, 18vw, 14rem)` / `0.9` | the `hero-word` utility — graffiti face, aria-hidden, one per screen |
| Hero `h1` | `text-[2.15rem]`→`text-8xl` / `leading-[1]`→`leading-[0.9]` | `font-display uppercase tracking-tight`; set the decisive line in `text-player-self` |
| Section `h2` | `text-3xl`→`text-4xl` | `font-display uppercase tracking-tight` |
| Panel title / lobby heading | `text-lg`→`text-xl` | `font-display uppercase tracking-tight` |
| Game-menu slab label | `text-xl`→`text-4xl` | `font-display uppercase tracking-tight leading-none` (see `menu-row` recipe) |
| VS name | `text-lg`→`text-2xl` | `font-display uppercase tracking-tight` in a VS lockup |
| Live number (clock/countdown) | `text-lg`+ | **`font-mono tabular-nums`** — see numeral rule |
| Eyebrow / ticker | `text-[11px]` | `font-mono uppercase tracking-[0.18em] font-semibold` (the `eyebrow` utility) |
| HUD meta | `10px` | `font-mono uppercase tracking-[0.2em]`, dimmed (the `hud-meta` utility) — edge chrome only |
| Body | `text-sm`→`text-base` / `leading-6`–`leading-7` | `text-muted-foreground` for secondary copy |
| Data inline | `text-[11px]`→`text-xs` | `font-mono` — ratings, sample counts, IDs |

Rules: headings, lockups, and game-menu slab labels are never `font-sans` and
always `uppercase`. Numbers that update live are `font-mono tabular-nums`.
Eyebrows and tickers are `font-mono uppercase` with wide tracking — never
sentence-case body. The graffiti face never carries information.

## Color tokens

All defined in `src/app/globals.css` on `:root.dark` (the glitch ground —
hero) and `:root` (light — secondary), surfaced to Tailwind via `@theme
inline` as `--color-*`. Use the utility, never a raw hex or a Tailwind palette
color (`emerald-500`, `amber-400`, `text-white`, …).

### Neutrals & core (shadcn contract)

`background`, `foreground`, `card`, `card-foreground`, `popover`, `muted`,
`muted-foreground`, `secondary`, `accent`, `border`, `input`, `ring`,
`destructive`, `destructive-foreground`.

| Token | Dark (the glitch ground — hero) | Light ("daylight HUD") | Meaning |
| --- | --- | --- | --- |
| `--background` | `oklch(0.13 0.01 285)` flat near-black, faint violet cast | `oklch(0.97 0.005 100)` warm paper | the flat ground under the noise texture |
| `--foreground` | `oklch(0.95 0.005 100)` warm phosphor white | `oklch(0.2 0.015 285)` | text |
| `--card` | `oklch(0.18 0.012 285)` | `oklch(0.99 0.003 100)` | matte plate fill (near-opaque in `panel`) |
| `--border` | `oklch(0.9 0.01 100 / 16%)` warm translucent hairline | `oklch(0.2 0.02 285 / 12%)` | neutral hairline; also the bracket/tick ink |
| `--primary` | `oklch(0.92 0.19 100)` acid yellow | `oklch(0.52 0.11 100)` | primary CTA / focus — same value as `--player-self` |
| `--muted-foreground` | `oklch(0.72 0.02 100)` | `oklch(0.45 0.015 285)` | secondary copy |
| `--destructive` | `oklch(0.55 0.22 27)` | `oklch(0.5 0.21 27)` | destructive actions (cancel, forfeit, block) — **not** a verdict token, see below |
| `--destructive-foreground` | `oklch(0.98 0.01 27)` | `oklch(0.99 0.02 27)` | text on a filled destructive surface |
| `--radius` | `0.125rem` (both themes) | — | hardened HUD edge — replaces v3's soft `0.5rem` glass rounding |

`--primary` is the same value as `--player-self` on both themes: the CTA
language and the identity language are one hue. **Destructive vs opponent:**
`--destructive` (L 0.55, hue 27) sits almost on the opponent's hue (25) but is
deliberately darker and duller than `--player-opponent` (L 0.64, C 0.26) — the
lightness gap plus context separates *action-red* from *identity-red*. Use
`destructive` for actions that destroy state (cancel a race, forfeit, block)
and for blocking configuration warnings (`warning-glyph`); use
`player-opponent` only for the other player; use `verdict-fail` only for a
judge outcome.

### Player identity — the versus axis

| Token | Dark | Light | Meaning | Utilities |
| --- | --- | --- | --- | --- |
| `--player-self` | `oklch(0.92 0.19 100)` | `oklch(0.52 0.11 100)` | self — acid yellow | `bg/text/border-player-self` |
| `--player-self-foreground` | `oklch(0.17 0.04 100)` | `oklch(0.99 0.01 100)` | text on a filled yellow surface | `text-player-self-foreground` |
| `--player-opponent` | `oklch(0.64 0.26 25)` | `oklch(0.52 0.22 25)` | opponent — crimson | `bg/text/border-player-opponent` |
| `--player-opponent-foreground` | `oklch(0.13 0.03 25)` | `oklch(0.99 0.01 25)` | text on a filled crimson surface | `text-player-opponent-foreground` |

Always put text on a filled identity chip with its `-foreground` pair, never
`text-white` — **note that on dark, the opponent's `-foreground` is dark ink:
white text on the crimson fill fails WCAG AA**, so both dark-theme
`-foreground` pairs are dark-on-bright by design. Opacity modifiers are fine
for rules/washes/glows: `bg-player-self/10` (a winner wash on `ResultCard`),
`border-player-self/40` (the VS-lockup rule), `color-mix(in oklch,
var(--player-self) 70%, transparent)` (the `glow-self` halo) — but don't dim
identity-colored *copy* itself with opacity; both `-self`/`-opponent` inks are
picked to read clearly as text on `--background` and the matte plate fill in
both themes. The two anchor hues — yellow 100, crimson 25 — are the whole
visual language; they never swap and never appear as decoration.

### Verdict semantics — the single source for judge outcomes only

| Token | Dark | Light | Meaning | Utilities |
| --- | --- | --- | --- | --- |
| `--verdict-ok` | `oklch(0.8 0.19 160)` emerald | `oklch(0.5 0.14 160)` | Accepted / passing | `text/bg-verdict-ok` |
| `--verdict-fail` | `oklch(0.7 0.24 340)` hot magenta | `oklch(0.52 0.22 340)` | WA / RE / TLE / rejected | `text/bg-verdict-fail` |
| `--verdict-pending` | `oklch(0.78 0.12 230)` cyan-blue | `oklch(0.5 0.1 232)` | running / queued / awaiting judgment | `text/bg-verdict-pending` |

Each has a `-foreground` pair for text sitting on the filled color. The
identity clashes are handled by hue on purpose, and the hue map changed in v4:

- **Fail is magenta now.** v3's opponent hue (magenta ~350) was freed when the
  opponent moved to crimson, and it is recycled as `verdict-fail` (340). It
  sits 45°+ and a full brightness step away from the opponent's crimson (25),
  so a failing verdict never reads as the opponent's identity. **Do not use
  magenta for anything else.**
- ok emerald (160) sits 60° from self yellow (100); pending cyan-blue (230)
  is 130° from self yellow. All three verdicts are ≥45° clear of both
  identity hues.
- destructive (27) nearly shares the opponent's hue but is separated by
  lightness and context — see the note above.

But never lean on hue alone: verdict colors describe **what a judge decided**,
identity colors describe **who**.

**Codified rule (v3, enforced by issue #141, survives verbatim in v4):
verdict hues mean judge outcomes ONLY.** `verdict-ok` / `verdict-fail` /
`verdict-pending` may only be used for an actual Codeforces judge verdict or
the platform's direct restatement of one (a submission's AC/WA/TLE, a race's
win/loss/draw outcome badge, a live "awaiting judgment" indicator tied to a
real pending submission). They are **not** a generic "green/red/blue"
palette. Every other tri-state UI reaches for a different axis instead:

- **Presence / connectivity** ("opponent is in the room," "mic is live") —
  a neutral treatment (`text-muted-foreground` / a dimmed fill for absent)
  or the relevant **identity** color for present, never `verdict-ok`/`-fail`.
- **Readiness** ("ready" vs "not ready" in the lobby) — identity or neutral
  (e.g. a filled identity chip for ready, a muted outline for not-ready),
  not `verdict-pending`/`verdict-ok`.
- **Permission / link state** ("Codeforces not linked," "settings need
  attention") — neutral or **destructive** (it's a blocking configuration
  problem, not a judge rejection; the `warning-glyph` chip is the v4
  treatment), not `verdict-fail`.
- **Mute / audio-device state** (mic-off, speaker-muted icons) — neutral or
  destructive, not verdict tokens.
- **Low-time race warning** (timer under 2 minutes) — **destructive**, not
  `verdict-fail`: running out of time is a threat, not a judge outcome.

### Charts

`--chart-1`…`--chart-5` map to: self yellow, opponent crimson, ok emerald,
pending cyan-blue, neutral. Series that mean a player or a verdict must use
the matching slot.

## Surface recipes

Named utilities in `globals.css` replace ad-hoc `rounded-xl border bg-card`.
Reach for these first. **No `backdrop-filter` exists anywhere in the system;
never reintroduce it.** Animations are transform/opacity/clip-path/text-shadow
only, always inside `prefers-reduced-motion: no-preference` guards — never an
animated `filter`.

### `panel` / `panel-solid` — matte HUD plates

The frosted glass tiers are retired; both plates are now matte, hard-edged,
and near-opaque, differing only in opacity and what may sit on them:

- **`panel`** — the default surface: a ~96%-opaque `--card` fill, 1px
  hairline `--border`, `--radius` (2px) corners, shallow floor shadow. Use
  for feature tiles, VS lockups, content cards, result cards, lobby cards,
  menu-row containers. It fills via `background-color`, so `bracket-frame`'s
  corner chrome layers compose with it.
- **`panel-solid`** — the max-legibility tier at ~98% opacity (the race
  problem-statement pane). **No texture or bracket overlap allowed on it** —
  nothing sits between the reader and long-form text.

```html
<div class="panel p-5"> … </div>
<div class="panel bracket-frame p-6"> … hero surface … </div>
<div class="panel-solid p-6"> … problem statement … </div>
```

### `bracket-frame` — corner-bracket chrome

Four corner L-brackets (~14px arms, 1.5px thick, brightened border ink) drawn
as background layers on a single element. A companion class — layer it WITH
`panel` on **hero surfaces only** (a screen's main plate, the RaceHUD). Never
on `panel-solid`, never on every card in a grid.

### `stat-plate` — flat inset cell

A darker, flat inset cell for a single number + label (Elo, rank, streak,
race count, CF rating). Hairline border, subtle inset shadow, and a single
6px corner tick (top-left, border ink) as its HUD detail. Sits inside a
`panel`.

```html
<div class="stat-plate px-3 py-2">
  <p class="eyebrow text-muted-foreground">Elo</p>
  <p class="font-mono text-2xl font-semibold tabular-nums">1540</p>
</div>
```

### `ticker` — broadcast lower-third bar

Mono, uppercase, wide-tracked, with a thin **self-yellow rule** along its top
edge (auto-retints via `var(--player-self)`) and a translucent low-opacity
background. Its first child automatically carries a leading `//` ornament in
muted ink (drawn via `::before` on the first child, so `justify-between`
layouts are unaffected). Header/footer status strip for a HUD. Put live
numbers inside in `font-mono tabular-nums`.

```html
<div class="ticker justify-between px-4 py-2.5">
  <span>race · 1794C</span>
  <span class="flex items-center gap-1.5 text-verdict-pending">
    <span class="size-1.5 rounded-full bg-verdict-pending animate-pulse"></span>live
  </span>
</div>
```

### `hero-word` + `glitch-text` — the graffiti hero word (`HeroWord`)

`hero-word` sets the graffiti face at `clamp(4rem, 18vw, 14rem)`, line-height
0.9, currentColor ink, layered `text-shadow` neon bloom, `user-select: none`.
`glitch-text` adds the RGB-split fringe: `::before`/`::after` re-render the
element's `data-text` offset ±2px in cyan/red at `mix-blend-mode: screen`;
motion-safe, they intermittently slice via `clip-path` inset keyframes (no
filter); under reduced motion the split stays static. Always use the
component, never raw classes:

```tsx
import { HeroWord } from "@/components/hud/hero-word";

<HeroWord word="seek" />                          {/* self yellow, glitching */}
<HeroWord word="versus" tone="foreground" />
<HeroWord word="link" tone="muted" glitch={false} />
```

Rules: **exactly ONE per screen** (see the placement map below), always
`aria-hidden` (the component enforces it), never UI text, never numbers, and
the screen must read completely without it. Typically positioned absolutely
behind/above the real heading at low stacking priority.

### `noise-ground` — the scanline + grain texture

The fixed full-viewport texture: 1px scanlines every 4px at 4% black plus an
SVG `feTurbulence` grain tile at 5% opacity, `pointer-events-none`, z-index
-1 so all in-flow content paints above it. Mounted **once** in `layout.tsx`
as the first child of `<body>` — never mount a second instance, never add
extra texture layers to a view (the active race stage explicitly forbids
added texture). Motion-safe it flickers its opacity ≤8% on a 7s `steps()`
cycle; static under reduced motion.

### `hud-meta` / `hud-meta-vertical` — scattered metadata chrome

Tiny mono chrome (10px, `tracking-[0.2em]`, uppercase, 70%-dimmed muted ink)
for the world-building details: route markers ("/queue"), build tags,
coordinates, section indices. `hud-meta-vertical` is the same set
`writing-mode: vertical-rl` for screen edges.

**hud-meta discipline** (the quieter sibling of eyebrow discipline): it lives
at the **corners and edges of a screen** — never inline with content, never
as a label for a value (that's `eyebrow`), and **max ~3 scatter points per
view**. It's chrome, not information; nothing may depend on reading it.

### `warning-glyph` — hazard chip

A small (~18px) hexagonal chip — destructive-tinted fill, destructive ink,
centers its content (an icon or "!"). For blocking configuration problems
("Codeforces not linked"), destructive confirmations, and hazard markers.
Never for judge verdicts.

```html
<span class="warning-glyph">!</span>
```

### `spotlight` — the ambient light, focused

A dim yellow pool from the top-center, a crimson counter-pool from the far
corner, and a very faint magenta tertiary fringe — all ≤12% alpha, quieter
than v3 (the texture does the atmospheric work now). Layer behind hero
content (`-z-10`); it's atmosphere, not a surface. The body carries a subtler
version of the two identity pools (≤10%) so every page has ambient identity
light even without a `spotlight` div.

```html
<div aria-hidden class="spotlight pointer-events-none absolute inset-0 -z-10"></div>
```

### `stamp` — verdict stencil

An upright, boxed, uppercase, **square** stencil frame (Chakra Petch,
`border: 2px solid currentColor`, `border-radius: 0`, neon bloom via layered
`text-shadow` in currentColor — never a filter) for verdict moments —
**"Bodied."** on a result hero, an **AC / WA** stamp in the feed. Sets the
display face; the caller sets the ink via text color.

```html
<span class="stamp text-player-self text-3xl">Bodied.</span>
<span class="stamp text-verdict-ok text-sm">AC</span>
```

### `menu-row` / `menu-row-icon` / `menu-row-arrow` — the game-menu slab

The tetr.io main-menu language (issue #124), now matte: a full-width
horizontal action row — a left accent stripe, a matte accent-tinted fill (no
blur), an icon plate (`menu-row-icon`), a tall Chakra Petch label + mono
tagline, and a trailing arrow (`menu-row-arrow`) that slides in on hover.
Hover/focus slides the whole row right, blooms the accent glow, and fires a
**one-shot ~150ms glitch**: a 2-pose transform jitter plus a brief cyan/red
RGB `text-shadow` flash (motion-safe only; reduced motion gets a static
state change). Keyboard focus gets the same treatment plus a visible outline.
Each row sets its hue via the inline custom property `--row-accent` (pass a
CSS color through `accentStyle()` in `src/components/menu/menu-row.tsx`).

```tsx
<MenuRowLink
  href="/queue"
  accent="var(--player-self)"
  icon={Swords}
  label="Quick match"
  tagline="Matched by rating — usually in seconds"
/>
```

### `menu-row-sm` — the slab button (`SlabButton`)

The condensed sibling of the menu row (issue #129), rendered by
`src/components/menu/slab-button.tsx`: the same left-accent-stripe, matte
tinted fill, uppercase label, glitch-on-hover language shrunk to button scale
for significant CTAs app-wide — the lobby READY, the race action bar, result
and queue actions, primary form submits. A button, not a list row, so it
lifts + glitches on hover instead of sliding right, and sizes to its content
(`w-full`/`flex-1` to fill). Padding is em-based so `size="lg"` scales the
whole control via one `font-size`. Hue comes from the `tone` prop, mapped to
`--row-accent`:

| `tone` | Hue | Use for |
| --- | --- | --- |
| `primary` / `self` | `--player-self` | the dominant CTA (ready up, rematch, quick match) |
| `opponent` | `--player-opponent` | opponent-framed actions |
| `destructive` | `--destructive` | cancel/forfeit/leave ("Throw in the towel") |
| `neutral` | `--muted-foreground` | quiet secondary actions (back, decline) |

Small utility controls (icon toggles, mic/cam, pagination, ghost
"cancel"/"back" links) deliberately stay on the plain `ui/button`, not
`SlabButton` — reserve the slab language for CTAs that carry real weight in
the flow.

```tsx
<SlabButton tone="self" size="lg" className="w-full">I&apos;m ready</SlabButton>
<SlabButton tone="destructive" className="w-full">Throw in the towel</SlabButton>
```

### `glow-self` / `glow-opponent` — identity halo

A hard neon `box-shadow` halo in each identity's hue (auto-retints via the
tokens; blur tightened ~30% from v3 for a harder edge), layered over the
same floor shadow as `panel`. Apply alongside `panel` on an
elevated/interactive surface that needs to visibly belong to one side (a
winner tile, a focused player column).

### `clip-notch` / `clip-notch-sm` — signature chamfer

Clips two opposite corners for a poster-plate silhouette — 14px
(`clip-notch`, the existing race surfaces) or 8px (`clip-notch-sm`, small
chips and compact plates). Use sparingly; it's a texture accent, not a
default.

### `eyebrow` — the one label treatment app-wide

Squared mono, uppercase, wide-tracked (`0.18em`), semibold, `11px`. Color is
left to the caller — `text-muted-foreground` by default, or an identity/
verdict hue where the label is semantic. See **eyebrow discipline** below.

### `shell` / `shell-narrow`

The shared spacing rhythm: `shell` (`max-w-6xl`) for standard page width,
`shell-narrow` (`max-w-3xl`) for copy-heavy pages. Both are `mx-auto w-full`
with responsive `px-6 md:px-8`.

Buttons/badges keep the existing shadcn components (they already read from
`primary`/`destructive`/verdict tokens); do not restyle them per-surface.
Buttons inherit `--radius` (`0.125rem`), the hardened HUD edge — leave it.

## Eyebrow discipline

**Page-level eyebrows default OFF.** Don't add a redundant page-title kicker
("DASHBOARD", "SETTINGS") above every `h1` just because `eyebrow` exists —
the nav and the URL already say what page this is. The `eyebrow` utility is
for **panel, tile, and field labels**: a `stat-plate`'s "Elo"/"Record"
caption, a `panel`'s section header, a `ticker`'s own type, a VS lockup's
"Champion"/"Challenger" tag. The landing hero's small kicker line and the
dashboard main-menu section label are the narrow exception — a single content
flourish above a hero heading, at most once per view, never a per-page
template element.

`hud-meta` is the quieter edge-chrome sibling with its own discipline (see
its recipe): screen corners/edges only, max ~3 scatter points per view, never
a label for a value, never load-bearing.

## Hero-word placement map

One `HeroWord` per screen, or none. This table is exhaustive — a screen not
listed here gets **no** hero word until this map says otherwise.

| Screen | Word | Tone | Notes |
| --- | --- | --- | --- |
| Landing `/` | `cph2h` | `self` | the wordmark IS the hero (in-flow, centered); an `sr-only` `h1` carries the name for AT |
| Dashboard | `play` | `self` | over the menu column |
| Queue | `seek` | `self` | |
| Leaderboard | `ladder` | `self` | |
| Lobby | `versus` | `foreground` | glitch RGB fringe carries the color |
| **Active race stage** | — | — | **NO hero word** (perf + focus) |
| Result card | `bodied` | `self` on win, `opponent` on loss | the `stamp` stays the verdict moment |
| Challenge new | `callout` | `self` | |
| Challenge accept | `answer` | `opponent` | |
| Settings / CF link | `link` | `muted` | |
| Sign-in | `again` | `muted` | |
| Sign-up | `step up` | `self` | |

## Retired motifs (v3 → v4)

The following v3 "neon glass grid" motifs are retired. Do not reintroduce
them:

- **Frosted glass / `backdrop-filter`** — every surface is now a matte
  near-opaque plate; there is NO backdrop-blur anywhere in the system
  (perf + the flat HUD look). This includes ad-hoc `backdrop-blur-*`
  utilities on nav/overlays — strip them during reskins.
- **Specular top-edge highlights** (the inset white top line on panels) —
  plates are matte; edge interest comes from `bracket-frame` corners and the
  `stat-plate` tick instead.
- **Soft `0.5rem` rounding** — `--radius` is `0.125rem` (both themes);
  panels/plates/buttons all harden from it via `--radius-sm…4xl`.
- **Cyan/magenta identity** (`--player-self` cyan ~200 / `--player-opponent`
  magenta ~350) — replaced by **acid yellow (hue 100) / crimson (hue 25)**.
  Magenta is recycled as `verdict-fail`; cyan-blue as `verdict-pending`.
- **Ambient cyan/magenta glow pools** — the body/spotlight pools survive but
  retint via the identity tokens and are dimmed to ≤12% alpha; atmosphere now
  comes primarily from the `noise-ground` scanline+grain texture.
- **Glow-field-as-identity** (glass panels lit by the glow field as the
  primary identity carrier) — identity now lives in inks, stripes, halos
  (`glow-self`/`glow-opponent`, tightened), and the yellow ticker rule;
  the ground stays near-flat.
- Still banned from earlier eras: Anton, gold/crimson-on-warm-black (v2),
  halftone/comic energy, speech bubbles, rotation/sticker treatments, the
  terminal-prompt wordmark.

**Changelog note.** v2 shipped a warm near-black stage with gold/crimson
identity and Anton display type (issues up to ~#100). v3 (issues #124–#154)
replaced it with a cool blue-violet ground, an ambient cyan/magenta glow
field, frosted liquid-glass panels at `0.5rem` radius, Chakra Petch, and the
tetr.io game-menu slab. v4 (this spec) keeps Chakra Petch, the slab idiom,
the shell rhythm, the voice, the numeral rule, and the verdict-scope rule —
and replaces the glass with matte hard-edged glitch-HUD plates, retints the
versus axis to acid yellow / crimson, remaps the verdict hues
(fail→magenta 340, pending→cyan-blue 230, ok→emerald 160), adds the
noise-ground texture, the graffiti hero word, corner brackets, and hud-meta
chrome. Token and utility **names** are unchanged from v3 — only their
values/internals changed — so v3 call sites reskin automatically.

## Per-surface sketches

This section is the **contract for the v4 reskin issues** — each paragraph
names the utilities and the hero word for its screen. Layout uses the
`shell`/`shell-narrow` width utilities. Section dividers are `border-t
border-border`. A thin yellow rule (`bg-player-self/40`) splits the two
corners on a VS surface.

- **Nav (`src/components/nav.tsx`).** The wordmark keeps its `font-display
  uppercase` form; its 3px underline rule auto-retints to self yellow via
  `bg-player-self`. The full nav's top versus-gradient hairline
  (`from-player-self via-border to-player-opponent`) likewise retints via
  tokens — leave the markup, drop the `backdrop-blur-sm` /
  `supports-[backdrop-filter]` classes from the sticky header (near-opaque
  `bg-background/95` instead). On non-menu routes, add ONE `hud-meta` route
  marker at the right edge of the bar (e.g. `//&nbsp;/queue`) — the nav's
  single scatter point.
- **Landing `/` (`src/app/page.tsx`).** The neon graffiti **wordmark is the
  hero**: `HeroWord word="cph2h"` (self), in-flow and centered, with an
  `sr-only` `h1` carrying the name for assistive tech. No display headline
  lockup — the hero is eyebrow → graffiti wordmark → one short tagline →
  a compact centered `SlabButton` row (every destination one click; stacks
  full-width on mobile). The `VersusPoster` sits below as the centered
  companion plate (corner brackets allowed). Feature tiles upgrade from bare
  `panel` to `panel bracket-frame` (the lead tile at minimum). Scatter up to
  three `hud-meta` corner markers (build/date/route, e.g. footer corner +
  hero edge).
- **Dashboard (`src/app/dashboard/page.tsx`).** `HeroWord word="play"`
  (self) over/behind the menu column. The `MenuRowLink` slab stack and the
  side rail (`IdentityPlate` panel, `stat-plate` 2×2 grid, Elo sparkline,
  recent races) all reskin via tokens automatically. One
  `hud-meta-vertical` edge label is allowed down the outer rail edge. The
  Settings row's CF-unlinked accent moves off `verdict-fail` onto
  `--destructive` with a `warning-glyph` (issue #141 rule).
- **Queue (`src/app/queue/…`).** `HeroWord word="seek"` (self). Searching
  state is `verdict`-free: the pulse/status is neutral or self-identity.
  Panels + `SlabButton`s reskin via tokens.
- **Leaderboard (`src/app/leaderboard/…`).** `HeroWord word="ladder"`
  (self). Rank/rating columns stay `font-mono tabular-nums`; the empty state
  keeps "Nobody's stepped up."
- **Lobby (`src/components/race/Lobby.tsx`).** `HeroWord word="versus"`
  (**foreground** tone — the RGB glitch fringe carries the color). The VS
  lockup's two corners retint yellow/crimson via tokens; the ready state
  follows the readiness rule (identity/neutral, not verdict). The broadcast
  countdown stays `font-mono text-6xl tabular-nums`. `panel clip-notch`
  shell, `ticker`, `stat-plate` filters/checklist, `SlabButton`s ("I'm
  ready" self / "Throw in the towel" destructive) all survive as-is.
- **Active race stage (`RaceRoom` / `RaceHUD` / verdict feed).** **NO hero
  word, NO added texture** — perf and focus; the one `noise-ground` in the
  layout is all the texture this screen gets. Panels, `ticker`, and the HUD
  retint via tokens. `bracket-frame` is allowed on the `RaceHUD` plate
  ONLY. The low-time timer warning (<2min) must switch from `verdict-fail`
  to **`destructive`** — time pressure is a threat, not a judge outcome.
  The verdict feed keeps real verdict tokens per actual judge results.
  Overlays (`RaceEndOverlay`, forfeit dialog backdrop) drop their
  `backdrop-blur-sm` for a near-opaque `bg-background/95` scrim.
- **Result card (`src/components/race/ResultCard.tsx`).** `HeroWord
  word="bodied"` — tone **self on win, opponent on loss** (draw/aborted: no
  hero word). The `stamp` stays the verdict moment ("Bodied." / plain
  heading), now square-edged with text-shadow bloom automatically. Winner
  wash `bg-player-self/10` / `bg-player-opponent/10`, Elo deltas
  `font-mono tabular-nums` in verdict inks (they restate the judged
  outcome), `SlabButton`s for Rematch (self) / Back (neutral).
- **Challenge new (`src/app/challenge/new/…`).** `HeroWord word="callout"`
  (self). Form panels + primary submit `SlabButton` (self).
- **Challenge accept (`src/app/challenge/[id]/…` accept view).** `HeroWord
  word="answer"` (**opponent** — you're the one being called out).
- **Settings / CF link (`src/app/settings/cf/…`).** `HeroWord word="link"`
  (muted). The verify flow's states follow the permission rule:
  neutral/destructive (`warning-glyph`), never verdict tokens — except the
  actual COMPILE_ERROR confirmation, which is a real judge verdict and may
  use verdict tokens.
- **Sign-in (`src/app/sign-in/…`).** `HeroWord word="again"` (muted). The
  Clerk card is themed from layout.tsx (matte plate, yellow top rule) —
  the page just supplies the hero word + `spotlight`.
- **Sign-up (`src/app/sign-up/…`).** `HeroWord word="step up"` (self).

## Do / Don't

**Do**

- Use identity tokens for *who* (self yellow / opponent crimson) and verdict
  tokens for **judge outcomes only** — always. Presence, readiness,
  permission, mute, and low-time states get neutral/identity/destructive
  treatment instead (see the codified rule above).
- Reach for `panel` (matte plate, most surfaces) or `panel-solid`
  (max-legibility, long-form text, no texture/brackets) before writing a new
  surface style; never a third ad-hoc card style.
- Layer `bracket-frame` only on a screen's hero plate(s); keep `hud-meta` to
  screen corners/edges, max ~3 per view.
- Render exactly ONE `HeroWord` per screen per the placement map — always
  decorative, always the component (it enforces `aria-hidden` and
  `data-text`).
- Reach for `menu-row`/`MenuRowLink` for a full-width navigating action and
  `menu-row-sm`/`SlabButton` for a significant CTA; leave small utility
  controls on the plain `ui/button`.
- Set every **live** number in `font-mono tabular-nums`; keep static display
  numbers in `font-display` only when they never move and don't share a
  column with a live one.
- Set headings, lockups, stamps, and menu-row/slab labels in `font-display
  uppercase tracking-tight`; keep eyebrows/tickers `font-mono uppercase`.
- Keep all animation to transform/opacity/clip-path/text-shadow inside
  `prefers-reduced-motion: no-preference` guards.
- Design and verify against **dark** (the glitch ground); sanity-check light
  doesn't break.

**Don't**

- Don't use `backdrop-filter`/`backdrop-blur-*` anywhere, or animate
  `filter` — ever.
- Don't use raw palette colors (`emerald-*`, `amber-*`, `green-600`,
  `red-600`, `text-white`) or hex literals in components — only tokens.
- Don't use a verdict color to mean presence, readiness, permission, mute,
  or time pressure, and don't use a player color to mean a verdict.
- Don't set the graffiti face on UI text or numbers, don't give a screen two
  hero words, and don't put a hero word on the active race stage.
- Don't set a **live** number in `font-display` (it jitters — numeral rule),
  and don't set HUD headings in `font-sans` or sentence case.
- Don't reintroduce frosted glass, specular edges, `0.5rem` rounding,
  cyan/magenta identity, Anton, halftone/comic energy, or the
  terminal-prompt wordmark — see Retired motifs above.
- Don't scatter the `stamp`; it marks a verdict moment — nowhere else.
- Don't restyle shared `Button`/`Badge` per surface; extend tokens instead.
