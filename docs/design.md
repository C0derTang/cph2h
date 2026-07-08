# cph2h design system — the Neon Glass Grid

This is the canonical visual spec (**v3, "neon glass grid" — supersedes the v2
"battle stage" wholesale**). Every UI issue codes against it. If a surface
you are building isn't sketched here, derive it from the tokens and surface
recipes below rather than inventing new colors, shapes, or one-off cards. All
values are copied verbatim from `src/app/globals.css` — if this doc and the
CSS ever disagree, the CSS wins and the doc is stale.

## Direction

**A dark cold arcade stage, not a battle poster.** cph2h is a 1v1 duel with
cameras on and mouths running: two people, one problem, one clock, one
winner. The interface takes its energy from tetr.io's main-menu screen —
**a cold near-black ground lit by an ambient cyan/magenta glow field, frosted
liquid-glass panels floating over it, tall squared game-menu slabs you slide
into, electric-cyan self vs hot-magenta opponent.** Confidence comes from
glow and glass, not gold trim and hard edges.

Three ideas carry the whole system:

1. **The versus axis.** You are always **self** (`--player-self`, electric
   cyan, `oklch(0.82 0.13 200)` on dark). Your opponent is always
   **opponent** (`--player-opponent`, hot magenta, `oklch(0.7 0.24 350)` on
   dark). These two never swap and never appear as decoration — a color on
   screen means an identity. The body itself is washed in both: a cyan pool
   from the top-left, a magenta pool from the bottom-right (`spotlight` /
   the base `body` glow), so the versus axis is ambient before it's ever a
   UI element.
2. **The glass.** Content lives on frosted liquid-glass panels (`panel`):
   softly rounded (`--radius: 0.5rem`), a translucent hairline border, a
   specular top-edge highlight, a bounded backdrop-blur, and a soft floor
   shadow — lit glass floating over the glow field, not matte set dressing.
   The game-menu screens (landing, dashboard) go further: full-width
   `menu-row` slabs with a left accent stripe that slides and blooms on
   hover, tetr.io's main-menu language transplanted wholesale.
3. **The stamp.** Verdict moments are still stamped, not animated with
   confetti: a stencil frame reads **"Bodied."** on a result hero, **AC / WA**
   in the feed — now rendered in the squared Chakra Petch display face with a
   neon glow bloomed off the frame, instead of Anton on gold.

Dark ("the grid") is the hero and the default (`<html class="dark">`, set via
`:root.dark` so it wins the cascade regardless of source order). Light
("daylight grid") is cool frost paper with the same inks, darkened for
contrast — fully defined and accessible for a future toggle, but design and
screenshot against dark. **No halftone, no speech bubbles, no rotation/sticker
energy, no comic-panel motifs — this is a HUD, not a poster.**

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
| Taunt picker action | **Spit a bar** |

### Voice rules

- **Data stays data.** Real CF verdict strings (`WRONG_ANSWER`, `ACCEPTED`),
  ratings, Elo deltas, handles, timestamps are **never** rewritten. Attitude
  lives in the copy *around* the data, never inside it.
- **Deadpan and superior, not loud.** The line is funnier delivered flat.
  "Nobody's stepped up." beats an exclamation. Let the confidence sit.
- **Active, second-person.** "Step up," "Throw in the towel," "Spit a bar" —
  aimed at *you* or *them*, never at "the user."
- **One explicit beat per surface, max.** Pick the moment that hits hardest
  and let the rest play straight.
- **Errors and empties still do their job.** Say what happened and how to
  fix it, in-voice ("No problems match. Widen the filters or keep hiding."
  names the fix and keeps the register). Never vague, never an apology.
- **Never punch at protected traits** — the target is always skill/effort/
  nerve.

## Typography

Three roles, three faces, loaded via `next/font/google` in `layout.tsx`.

| Role | Face | Tailwind | Use for |
| --- | --- | --- | --- |
| Display / UI | **Chakra Petch** | `font-display`, `font-heading` | `h1`–`h3`, wordmark, VS names, stamps, game-menu slab labels, slab buttons — **uppercase** |
| Body | **Geist Sans** | `font-sans` (default) | paragraphs, descriptions, form labels |
| Data / mono | **Geist Mono** | `font-mono` | problem IDs, verdict feed, eyebrows, tickers, code, **and every live number** |

`font-heading` and `font-display` are the same face (Chakra Petch) —
`font-heading` exists for the shadcn `CardTitle` contract; prefer
`font-display` in new code. Chakra Petch is a squared techno-grotesque with a
gaming-HUD cadence, loaded at weights 400/500/600/700 (`layout.tsx`) so the
same face carries quiet UI labels (500/600) and loud lockups (700). It **must
be set uppercase** for headings/lockups/stamps — it's a HUD letterform, not a
sentence face. Track it tight (`tracking-tight`) on big lockups.

### The numeral rule (load-bearing)

**Chakra Petch's digits are not tabular** — same as Anton before it, the
numerals are uneven width and jitter when a value changes in place.
Therefore, unchanged from v2:

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
| Hero `h1` | `text-[2.15rem]`→`text-8xl` / `leading-[1]`→`leading-[0.9]` | `font-display uppercase tracking-tight`; set the decisive line in `text-player-self` |
| Section `h2` | `text-3xl`→`text-4xl` | `font-display uppercase tracking-tight` |
| Panel title / lobby heading | `text-lg`→`text-xl` | `font-display uppercase tracking-tight` |
| Game-menu slab label | `text-xl`→`text-4xl` | `font-display uppercase tracking-tight leading-none` (see `menu-row` recipe) |
| VS name | `text-lg`→`text-2xl` | `font-display uppercase tracking-tight` in a VS lockup |
| Live number (clock/countdown) | `text-lg`+ | **`font-mono tabular-nums`** — see numeral rule |
| Eyebrow / ticker | `text-[11px]` | `font-mono uppercase tracking-[0.18em] font-semibold` (the `eyebrow` utility) |
| Body | `text-sm`→`text-base` / `leading-6`–`leading-7` | `text-muted-foreground` for secondary copy |
| Data inline | `text-[11px]`→`text-xs` | `font-mono` — ratings, sample counts, IDs |

Rules: headings, lockups, and game-menu slab labels are never `font-sans` and
always `uppercase`. Numbers that update live are `font-mono tabular-nums`.
Eyebrows and tickers are `font-mono uppercase` with wide tracking — never
sentence-case body.

## Color tokens

All defined in `src/app/globals.css` on `:root.dark` (the grid — hero) and
`:root` (light — secondary), surfaced to Tailwind via `@theme inline` as
`--color-*`. Use the utility, never a raw hex or a Tailwind palette color
(`emerald-500`, `amber-400`, `text-white`, …).

### Neutrals & core (shadcn contract)

`background`, `foreground`, `card`, `card-foreground`, `popover`, `muted`,
`muted-foreground`, `secondary`, `accent`, `border`, `input`, `ring`,
`destructive`.

| Token | Dark (the grid — hero) | Light ("daylight grid") | Meaning |
| --- | --- | --- | --- |
| `--background` | `oklch(0.145 0.022 262)` cold near-black, blue-violet tint | `oklch(0.97 0.008 240)` cool frost paper | the ground the glow field paints onto |
| `--foreground` | `oklch(0.95 0.008 240)` | `oklch(0.2 0.02 260)` | text |
| `--card` | `oklch(0.215 0.03 262)` | `oklch(0.99 0.005 240)` | glass panel base fill (mixed translucent in the `panel` recipe) |
| `--border` | `oklch(0.86 0.05 250 / 14%)` translucent cool hairline | `oklch(0.2 0.03 260 / 12%)` | neutral hairline |
| `--primary` | `oklch(0.82 0.13 200)` electric cyan | `oklch(0.54 0.14 220)` | primary CTA / focus — same value as `--player-self` |
| `--muted-foreground` | `oklch(0.73 0.028 250)` | `oklch(0.46 0.02 255)` | secondary copy |
| `--destructive` | `oklch(0.66 0.25 20)` | `oklch(0.55 0.24 22)` | destructive actions (cancel, forfeit, block) — **not** a verdict token, see below |
| `--radius` | `0.5rem` (both themes) | — | softer glass rounding — replaces v2's hard `0.25rem` |

`--primary` is the same value as `--player-self` on both themes: the CTA
language and the identity language are one hue. `--destructive` happens to
land near `--verdict-fail`'s hue on dark (both ~20) but is a distinct token —
use `destructive` for actions that destroy state (cancel a race, forfeit,
block), `verdict-fail` only for a judge outcome.

### Player identity — the versus axis

| Token | Dark | Light | Meaning | Utilities |
| --- | --- | --- | --- | --- |
| `--player-self` | `oklch(0.82 0.13 200)` | `oklch(0.52 0.15 222)` | self — electric cyan | `bg/text/border-player-self` |
| `--player-self-foreground` | `oklch(0.16 0.03 220)` | `oklch(0.99 0.01 220)` | text on a filled cyan surface | `text-player-self-foreground` |
| `--player-opponent` | `oklch(0.7 0.24 350)` | `oklch(0.52 0.24 350)` | opponent — hot magenta | `bg/text/border-player-opponent` |
| `--player-opponent-foreground` | `oklch(0.15 0.03 350)` | `oklch(0.99 0.01 350)` | text on a filled magenta surface | `text-player-opponent-foreground` |

Always put text on a filled identity chip with its `-foreground` pair, never
`text-white`. Opacity modifiers are fine for rules/washes/glows:
`bg-player-self/10` (a winner wash on `ResultCard`), `border-player-self/40`
(the VS-lockup rule), `color-mix(in oklch, var(--player-self) 70%,
transparent)` (the `glow-self` halo) — but per the globals.css comment on the
dark theme's identity block, don't dim identity-colored *copy* itself with
opacity; both `-self`/`-opponent` inks are picked to read clearly as text on
`--background` and the translucent glass fill in both themes, and both
`-foreground` pairs are dark-on-bright (dark theme) / light-on-medium (light
theme) so the two corners of a VS lockup follow the same pattern in both
themes. The two anchor hues — cyan ~200, magenta ~350 — are the whole visual
language; they never swap and never appear as decoration.

### Verdict semantics — the single source for judge outcomes only

| Token | Dark | Light | Meaning | Utilities |
| --- | --- | --- | --- | --- |
| `--verdict-ok` | `oklch(0.84 0.2 150)` | `oklch(0.5 0.16 150)` | Accepted / passing | `text/bg-verdict-ok` |
| `--verdict-fail` | `oklch(0.66 0.25 20)` | `oklch(0.55 0.24 22)` | WA / RE / TLE / rejected | `text/bg-verdict-fail` |
| `--verdict-pending` | `oklch(0.83 0.16 85)` | `oklch(0.52 0.14 82)` | running / queued / awaiting judgment | `text/bg-verdict-pending` |

Each has a `-foreground` pair for text sitting on the filled color. Two
identity clashes are handled by hue on purpose — per the globals.css
comment: **fail red (hue ~20, orange-lean) is well clear of the opponent's
magenta (hue ~350)**, so a failing verdict never reads as the opponent's
identity; pending amber (hue ~85) is likewise clear of self-cyan (hue ~200).
But never lean on hue alone: verdict colors describe **what a judge decided**,
identity colors describe **who**.

**Codified rule (new in v3, enforced in code by issue #141): verdict hues
mean judge outcomes ONLY.** `verdict-ok` / `verdict-fail` / `verdict-pending`
may only be used for an actual Codeforces judge verdict or the platform's
direct restatement of one (a submission's AC/WA/TLE, a race's win/loss/draw
outcome badge, a live "awaiting judgment" indicator tied to a real pending
submission). They are **not** a generic "green/red/amber" palette. Every
other tri-state UI reaches for a different axis instead:

- **Presence / connectivity** ("opponent is in the room," "mic is live") —
  a neutral treatment (`text-muted-foreground` / a dimmed fill for absent)
  or the relevant **identity** color for present, never `verdict-ok`/`-fail`.
- **Readiness** ("ready" vs "not ready" in the lobby) — identity or neutral
  (e.g. a filled identity chip for ready, a muted outline for not-ready),
  not `verdict-pending`/`verdict-ok`.
- **Permission / link state** ("Codeforces not linked," "settings need
  attention") — neutral or **destructive** (it's a blocking configuration
  problem, not a judge rejection), not `verdict-fail`.
- **Mute / audio-device state** (mic-off, speaker-muted icons) — neutral or
  destructive, not verdict tokens.

At the time of writing this rule is mid-migration: `RaceHUD`'s
`PresenceRow`, `Lobby`'s ready `Badge`, and a `Settings` game-menu-row accent
still read `verdict-ok`/`verdict-pending`/`verdict-fail` for presence,
readiness, and link-permission respectively — issue #141 replatforms these
onto neutral/identity/destructive. Don't copy those call sites; copy the rule
above. `dashboard/page.tsx`'s `outcomeBadgeVariant` (draw → `outline`, not a
verdict variant, because a draw is a settled neutral result, not a pending
one) is the pattern to follow.

## Surface recipes

Named utilities in `globals.css` replace ad-hoc `rounded-xl border bg-card`.
Reach for these first.

### Glass tiers — `panel` vs `panel-solid`

Liquid glass is carried by translucency + hairline border + specular
highlight, with backdrop-blur capped at 10px so compositing cost stays
bounded even with several always-on panels per view. There are two tiers —
pick by whether long-form text sits directly on the surface:

- **`panel`** — the default: a frosted translucent pane (`~78%→60%` opaque
  gradient fill, `blur(10px) saturate(1.4)`, hairline border, inset
  specular top-edge, floor shadow). Use for feature tiles, VS lockups,
  content cards, result cards, lobby cards, menu-row containers — anything
  that benefits from the glow field showing through.
- **`panel-solid`** — the near-opaque sibling for surfaces that must stay
  maximally legible with **no** backdrop-blur: a ~95%-opaque `--card` fill,
  same hairline border/specular/floor shadow, but long-form text never sits
  over a live-blurred backdrop. This is the one deliberately-not-glass
  content surface (issue #127) — currently the race problem-statement pane.
  Everything else picks `panel`.

```html
<div class="panel p-5"> … </div>
<div class="panel-solid p-6"> … problem statement … </div>
```

### `stat-plate` — recessed glass plate

A darker, inset plate for a single number + label (Elo, rank, streak, race
count, CF rating). Sits inside a `panel` so it reads as carved into the
glass — neutral hairline, an inset shadow, no blur of its own.

```html
<div class="stat-plate px-3 py-2">
  <p class="eyebrow text-muted-foreground">Elo</p>
  <p class="font-mono text-2xl font-semibold tabular-nums">1540</p>
</div>
```

### `ticker` — broadcast lower-third bar

Mono, uppercase, wide-tracked, with a thin **cyan (self) rule** along its top
edge and a translucent low-opacity background. Header/footer status strip
for a HUD (problem id, live state, clock). Ships its own type + background;
add padding + `justify-between`. Put live numbers inside in `font-mono
tabular-nums`.

```html
<div class="ticker justify-between px-4 py-2.5">
  <span>race · 1794C</span>
  <span class="flex items-center gap-1.5 text-verdict-pending">
    <span class="size-1.5 rounded-full bg-verdict-pending animate-pulse"></span>live
  </span>
</div>
```

### `spotlight` — the ambient glow, focused

A cyan pool from the top-center and a magenta counter-pool from the far
corner, washing into the dark. Layer behind hero content (`-z-10`); it's
atmosphere, not a surface. The body itself carries a subtler, unfocused
version of the same two pools (see `@layer base body` in globals.css) so
every page has ambient identity light even without a `spotlight` div.

```html
<div aria-hidden class="spotlight pointer-events-none absolute inset-0 -z-10"></div>
```

### `stamp` — verdict stencil / rubber stamp

An upright boxed uppercase frame (Chakra Petch, `border: 3px solid
currentColor`, a neon `drop-shadow` bloom in the same hue) for verdict
moments — **"Bodied."** on a result hero, an **AC / WA** stamp in the feed.
Sets the display face; the caller sets the ink via text color.

```html
<span class="stamp text-player-self text-3xl">Bodied.</span>
<span class="stamp text-verdict-ok text-sm">AC</span>
```

### `menu-row` / `menu-row-icon` / `menu-row-arrow` — the game-menu slab

The tetr.io main-menu language (issue #124): a full-width horizontal action
row — a left accent stripe, a tinted liquid-glass fill, an icon plate
(`menu-row-icon`), a tall Chakra Petch label + mono tagline, and a trailing
arrow (`menu-row-arrow`, or a custom `trailing` node e.g. a disclosure
chevron) that slides in on hover. Hover/focus slides the whole row right and
blooms the accent glow; keyboard focus gets the same treatment plus a
visible outline. Each row sets its hue via the inline custom property
`--row-accent` (pass a CSS color such as `"var(--player-self)"` through the
`accentStyle()` helper in `src/components/menu/menu-row.tsx`) — the icon
plate, stripe, and arrow all inherit it. Used by the dashboard main menu and
the landing entry actions (`MenuRowLink`).

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
`src/components/menu/slab-button.tsx`: the same left-accent-stripe,
tinted-glass, uppercase-label, glow-on-hover language shrunk to button scale
for significant CTAs app-wide — the lobby READY, the race action bar, result
and queue actions, primary form submits. A button, not a list row, so it
lifts + blooms on hover instead of sliding right, and sizes to its content
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

A soft neon `box-shadow` halo in each identity's hue, layered on top of the
same inset-specular + floor-shadow stack as `panel`. Apply alongside `panel`
on an elevated/interactive surface that needs to visibly belong to one side
(a winner tile, a focused player column).

### `clip-notch` — signature chamfer

Clips two opposite corners for a poster-plate silhouette. Retained from v2
for existing race surfaces (`RaceHUD`, `Lobby`, `ResultCard` all wrap in
`panel clip-notch`); use sparingly — it's a texture accent, not a default.

### `eyebrow` — the one label treatment app-wide

Squared mono, uppercase, wide-tracked (`0.18em`), semibold, `11px`. Color is
left to the caller — `text-muted-foreground` by default, or an identity/
verdict hue where the label is semantic (a "Champion"/"Challenger" tag, a
"Codeforces not linked" line). See **eyebrow discipline** below for where it
does and doesn't belong.

### `shell` / `shell-narrow`

The shared spacing rhythm: `shell` (`max-w-6xl`) for standard page width,
`shell-narrow` (`max-w-3xl`) for copy-heavy pages. Both are `mx-auto w-full`
with responsive `px-6 md:px-8`.

Buttons/badges keep the existing shadcn components (they already read from
`primary`/`destructive`/verdict tokens); do not restyle them per-surface.
Buttons inherit `--radius` (`0.5rem`), the softer glass rounding — leave it.

## Eyebrow discipline

**Page-level eyebrows default OFF.** Don't add a redundant page-title kicker
("DASHBOARD", "SETTINGS") above every `h1` just because `eyebrow` exists —
the nav and the URL already say what page this is, and a page-wide eyebrow
just adds noise above the real heading. The `eyebrow` utility is for
**panel, tile, and field labels**: a `stat-plate`'s "Elo"/"Record"/"CF
Rating" caption, a `panel`'s section header ("Elo history", "Recent races",
"Problem filters"), a `ticker`'s own type, a VS lockup's "Champion"/
"Challenger" tag. The landing hero's small kicker line ("1v1 competitive
programming, out loud") and the dashboard main-menu section label ("Main
menu") are the narrow exception — a single content flourish above a hero
heading, not a repeated page-titling pattern — use that pattern sparingly,
at most once per view, never as a per-page template element.

## Retired motifs (v2 → v3)

The following v2 "battle stage" motifs are retired. Do not reintroduce them:

- **Anton** (the tall condensed poster face) — replaced by **Chakra Petch**
  everywhere `font-display`/`font-heading` is used.
- **Gold / crimson identity** (`--player-self` gold ~hue 90, `--player-
  opponent` crimson ~hue 18) — replaced by **electric cyan (~hue 200) /
  hot magenta (~hue 350)**.
- **Halftone / comic-panel energy, speech bubbles, rotation/sticker
  treatments** — never were shipped as a real motif but were explicitly
  banned in v2 and remain banned in v3; the system is a HUD, not a comic.
- **Terminal-prompt motif** (`$ cd`, a blinking cursor wordmark) — retired
  in favor of the cyan-underlined Chakra Petch wordmark (`src/components/
  nav.tsx`).
- **Hard `0.25rem` edges** — `--radius` is now `0.5rem` (softer glass
  rounding) on both themes; panels/plates/buttons all round from it via
  `--radius-sm/md/lg/xl/2xl/3xl/4xl`.
- **Matte panels + gold hairline** (`panel` drawing its border from
  `--player-self` at 30%) — replaced by the neutral translucent-white
  hairline (`color-mix(in oklch, white 12%, transparent)`) used by both
  glass tiers; identity color now lives in glows/washes/menu-row accents,
  not the panel border itself.

**Changelog note.** v2 shipped a warm near-black stage with gold/crimson
identity, Anton display type, and hard `0.25rem` panels (issues up to ~#100).
The v3 rewrite (issues #124–#137) replaced the whole visual language with a
cool blue-violet-tinted dark ground, an ambient cyan/magenta glow field,
liquid-glass panels at `0.5rem` radius, Chakra Petch as the display/UI face,
and the tetr.io-style game-menu slab as the primary navigation idiom on the
landing and dashboard screens. The brand voice, canonical copy, and the
verdict-token/numeral-rule *shapes* carried over unchanged — only their
color/font values and (for verdicts) their scope of use changed.

## Per-surface sketches

Layout uses the `shell`/`shell-narrow` width utilities. Section dividers are
`border-t border-border`. A thin cyan rule (`bg-player-self/40`) splits the
two corners on a VS surface.

- **Nav (`src/components/nav.tsx`, built).** Wordmark: "cph2h" in
  `font-display uppercase` with a 3px cyan underline rule (the terminal-
  cursor motif is retired). On the two full-viewport game-menu routes (`/`
  and `/dashboard`) the nav collapses to just the wordmark + auth chip —
  the big menu-row slabs already carry navigation, so there's no competing
  link bar. Everywhere else: a top versus-gradient hairline (`from-player-
  self via-border to-player-opponent`), simplified IA — Play, Race,
  Challenge, The Ladder — in `eyebrow` style, hovering to `text-player-
  self`.
- **Landing (`src/app/page.tsx`, signed-out and signed-in, built).** A
  `spotlight` hero: `font-display uppercase` lockup with "Catch these bars."
  in `text-player-self`, the tagline, and entry actions rendered as
  `MenuRowLink` game-menu slabs (Find a race / Main menu when signed in;
  Sign up / Sign in when signed out) — not a single button. Beside it, the
  `VersusPoster` reference lockup: a `panel` with top/bottom `ticker`
  lower-thirds, a center "VS" chip on a cyan-ringed background, and two
  corners (Champion cyan / Challenger magenta) split by a `bg-player-self/40`
  rule, live rating/clock in `font-mono tabular-nums`. Below: a numbered
  "how it works" list (`font-display` step index, static) and `panel`
  feature tiles.
- **Dashboard / Play hub (`src/app/dashboard/page.tsx`, built).** The
  game-menu screen: a stack of `MenuRowLink` slabs (Quick match — cyan;
  Challenge a friend — a disclosure row; Leaderboard — pending-amber accent;
  Settings — neutral when CF is linked, fail-red accent when it isn't) as
  the hero column. A side rail carries the supporting cast: an
  `IdentityPlate` panel (username, CF handle link, a 2×2 grid of
  `stat-plate`s — Elo/Record/CF Rating/Races, all `font-mono tabular-nums`
  except Record's static W–L in `font-display`), an Elo-history panel with
  an SVG sparkline (`stroke`/`fill` in `text-player-self`/`fill-player-
  self`), and a `panel`-row list of recent races with an outcome `Badge`
  (`verdict-ok`/`verdict-fail`/`outline` for a draw) and a colored Elo delta.
- **Lobby (`src/components/race/Lobby.tsx`, built).** A `panel clip-notch`
  shell: a `ticker` status bar, a status heading, a big broadcast countdown
  once both are ready (`font-mono text-6xl tabular-nums`), then a VS lockup
  (`PlayerRow` × 2, Champion cyan / Challenger magenta, split by the cyan
  rule and a center "VS" chip) with a ready `Badge` per player, in-lobby
  problem filters in a `stat-plate`, a `CompeteGate` checklist ("Mic on.
  Volume up. No excuses.") in a `stat-plate`, the share-link row, and
  `SlabButton`s for "I'm ready" (`tone="self"`) and "Throw in the towel"
  (`tone="destructive"`).
- **Active race room / HUD (`src/components/race/RaceHUD.tsx`, built).** A
  `panel clip-notch` frame: a top `ticker` (problem id + live state), a
  countdown-then-timer in `font-mono tabular-nums` (flips to `text-verdict-
  fail` under 2 minutes remaining), an elapsed readout, and a compact
  `PresenceRow` per player. A live verdict feed elsewhere in the race room
  renders each row `text-verdict-ok/fail/pending` per the judge's actual
  verdict.
- **Result card (`src/components/race/ResultCard.tsx`, built).** A `panel
  clip-notch` hero: a `ticker` header, a `stamp` heading for win/loss
  ("Bodied." in `text-player-self` for a win, plain foreground for a loss;
  draw/aborted fall back to a plain `font-display` heading, no stamp), a
  two-column player tile grid with the winner's side washed
  `bg-player-self/10` / `bg-player-opponent/10` and the loser dimmed
  (`opacity-60`), Elo deltas in `font-mono tabular-nums` colored by
  `verdict-ok`/`verdict-fail`, the winning submission linked out to
  Codeforces, and `SlabButton`s for "Rematch" (`tone="self"`) and "Back to
  dashboard" (`tone="neutral"`).

## Do / Don't

**Do**

- Use identity tokens for *who* (self cyan / opponent magenta) and verdict
  tokens for **judge outcomes only** — always. Presence, readiness,
  permission, and mute states get neutral/identity/destructive treatment
  instead (see the codified rule above).
- Reach for `panel` (glass, most surfaces) or `panel-solid` (near-opaque,
  long-form text with no blur) before writing a new surface style; never a
  third ad-hoc card style.
- Reach for `menu-row`/`MenuRowLink` for a full-width navigating action and
  `menu-row-sm`/`SlabButton` for a significant CTA; leave small utility
  controls on the plain `ui/button`.
- Set every **live** number in `font-mono tabular-nums`; keep static display
  numbers in `font-display` only when they never move and don't share a
  column with a live one.
- Set headings, lockups, stamps, and menu-row/slab labels in `font-display
  uppercase tracking-tight`; keep eyebrows/tickers `font-mono uppercase`.
- Keep the `eyebrow` utility to panel/tile/field labels; don't template a
  page-level kicker onto every route.
- Reserve the `spotlight` for hero surfaces and the `stamp` for verdict
  moments. Spend boldness once per view — one lockup, one stamp, one
  spotlight pool.
- Design and verify against **dark** (the grid); sanity-check light doesn't
  break.

**Don't**

- Don't use raw palette colors (`emerald-*`, `amber-*`, `green-600`,
  `red-600`, `text-white`) or hex literals in components — only tokens.
- Don't use a verdict color to mean presence, readiness, permission, or
  mute state, and don't use a player color to mean a verdict.
- Don't set a **live** number in `font-display` (it jitters — numeral rule),
  and don't set HUD headings in `font-sans` or sentence case.
- Don't reintroduce Anton, gold/crimson identity, halftone/comic energy,
  the terminal-prompt wordmark, or hard `0.25rem` edges — see Retired
  motifs above.
- Don't scatter the `stamp`; it marks a verdict moment — nowhere else.
- Don't restyle shared `Button`/`Badge` per surface; extend tokens instead.
