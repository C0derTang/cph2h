# cph2h design system — the Battle Stage

This is the canonical visual spec (v2, rap-battle / battle-stage — supersedes the
v1 broadcast/esports direction wholesale). Every UI issue codes against it. If a
surface you are building isn't sketched here, derive it from the tokens and
surface recipes below rather than inventing new colors, shapes, or one-off cards.

## Direction

**Rap battle on a dark stage.** cph2h is a 1v1 duel with cameras on and mouths
running: two people, one problem, one clock, one winner, and a stream of trash
talk. The interface is a battle poster come to life — **a near-black stage under
a warm spotlight, a champion and a challenger squared off, tall poster type, and
hard-edged matte panels trimmed in gold.** Serious, not cartoonish: the swagger
comes from restraint and contrast, not decoration.

Three ideas carry the whole system:

1. **The versus axis.** You are always the **Champion** (`--player-self`, gold /
   champagne). Your opponent is always the **Challenger** (`--player-opponent`,
   crimson). These two never swap and never appear as decoration — a color on
   screen means an identity. Versus surfaces are poster lockups: two corners,
   names in tall caps, a thin gold rule between them.
2. **The stage.** Content lives on matte near-black panels with a **hairline gold
   border**, hard edges, and minimal radius — lit set dressing, not soft app
   cards. Hero surfaces sit under a warm **spotlight** (a subtle radial gold
   wash). Status runs along **lower-third bars** (broadcast-meets-stage tickers).
3. **The stamp.** Verdict moments are stamped, not animated with confetti: a
   stencil/rubber-stamp frame reads **"BODIED."** on a result hero, **AC / WA**
   in the feed. A mic icon appears only where it's earned (the taunt picker) —
   never scattered.

Dark ("the stage") is the hero and the default (`<html class="dark">`). Light
("daytime cypher") is warm paper with the same inks — fully defined and
accessible for a future toggle, but design and screenshot against dark. **No
halftone, no speech bubbles, no rotation/sticker energy — this is a stage, not a
comic.**

## Brand voice

cph2h talks like a battle rapper who already knows they've won: **cold, superior,
funny because it's deadpan.** Not cartoonish, not jokey. The tagline is
**"Shittalk your way to a higher rating."**

Profanity is **seasoning, not wallpaper** — full explicit where it lands hardest
(the hero, taglines, win/loss result screens), clean-but-cutting everywhere else.

### Canonical copy (writers extend in this voice)

| Surface | Copy |
| --- | --- |
| Landing hero | **Same problem. Same clock. Catch these bars.** |
| Tagline | **Shittalk your way to a higher rating.** |
| Win result | **BODIED.** |
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
- **Deadpan and superior, not loud.** The line is funnier delivered flat. "Nobody's
  stepped up." beats an exclamation. Let the confidence sit.
- **Active, second-person.** "Step up," "Throw in the towel," "Spit a bar" — aimed
  at *you* or *them*, never at "the user."
- **One explicit beat per surface, max.** Pick the moment that hits hardest and let
  the rest play straight.
- **Errors and empties still do their job.** Say what happened and how to fix it,
  in-voice ("No problems match. Widen the filters or keep hiding." names the fix
  and keeps the register). Never vague, never an apology.
- **Never punch at protected traits** — the target is always skill/effort/nerve.

## Typography

Three roles, three faces. Load via `next/font/google` in `layout.tsx`.

| Role | Face | Tailwind | Use for |
| --- | --- | --- | --- |
| Display / poster | **Anton** | `font-display`, `font-heading` | `h1`–`h3`, the wordmark, VS names, stamps — **uppercase** |
| Body | **Geist Sans** | `font-sans` (default) | paragraphs, descriptions, form labels, buttons |
| Data / mono | **Geist Mono** | `font-mono` | problem IDs, verdict feed, eyebrows, tickers, code, **and every live number** |

`font-heading` and `font-display` are the same face (Anton) — `font-heading`
exists for the shadcn `CardTitle` contract; prefer `font-display` in new code.
Anton is a single-weight (400), tall, condensed poster face; it needs no bold and
**must be set uppercase** (`uppercase`) — it's a marquee letterform, not a
sentence face. Track it tight (`tracking-tight`) on big lockups.

### The numeral rule (load-bearing)

**Anton numerals are not tabular** — the digits are uneven width and jitter when
a value changes in place. Therefore:

- **Live / animated numbers use `font-mono tabular-nums`, never `font-display`.**
  This means the race clock, countdown, live sample counts, and any number that
  ticks or updates while you watch it. The mono is the fallback face the spec
  calls for.
- **Static display numbers may use `font-display`** for poster punch — a step
  index ("01"…"04"), a headline figure that never changes on screen. When in
  doubt, or when the number sits in a scoreboard column next to a live one, use
  mono so the column stays aligned.
- Ratings and Elo deltas in scoreboards/history: **mono tabular-nums** (aligned
  columns that update between races).

### Type scale & rules

| Token | Size / leading | Notes |
| --- | --- | --- |
| Hero `h1` | `text-6xl`→`text-8xl` / `leading-[0.9]` | `font-display uppercase tracking-tight`; set the decisive line in `text-player-self` |
| Section `h2` | `text-3xl`→`text-4xl` | `font-display uppercase tracking-tight` |
| Panel title `h3` | `text-lg`→`text-xl` | `font-display uppercase tracking-tight` |
| VS name | `text-2xl`+ | `font-display uppercase`, in a poster lockup |
| Live number (clock/count) | `text-lg`+ | **`font-mono tabular-nums`** — see numeral rule |
| Eyebrow / ticker | `text-[11px]` | `font-mono uppercase tracking-[0.18em] font-semibold` |
| Body | `text-sm`→`text-base` / `leading-6`–`leading-7` | `text-muted-foreground` for secondary copy |
| Data inline | `text-[11px]`→`text-xs` | `font-mono` — ratings, sample counts, IDs |

Rules: headings and lockups are never `font-sans` and always `uppercase`. Numbers
that update live are `font-mono tabular-nums`. Eyebrows and tickers are
`font-mono uppercase` with wide tracking — never sentence-case body.

## Color tokens

All defined in `globals.css` on `.dark` (the stage — hero) and `:root` (light —
secondary), surfaced to Tailwind via `@theme inline` as `--color-*`. Use the
utility, never a raw hex or a Tailwind palette color (`emerald-500`, `amber-400`,
`text-white`, …).

### Neutrals & core (existing shadcn contract — kept)

`background`, `foreground`, `card`, `card-foreground`, `popover`, `muted`,
`muted-foreground`, `secondary`, `accent`, `border`, `input`, `ring`,
`destructive`.

| Token | Dark (stage — hero) | Light ("daytime cypher") | Meaning |
| --- | --- | --- | --- |
| `--background` | `oklch(0.145 0.006 60)` near-black | `oklch(0.95 0.014 85)` warm paper | the stage |
| `--foreground` | `oklch(0.95 0.01 85)` | `oklch(0.2 0.014 60)` | text |
| `--card` | `oklch(0.19 0.008 60)` matte | `oklch(0.98 0.008 85)` | panel fill |
| `--border` | `oklch(1 0 0 / 9%)` | `oklch(0 0 0 / 10%)` | neutral hairline |
| `--primary` | `oklch(0.82 0.12 90)` gold | `oklch(0.62 0.11 80)` | = Champion / self; CTAs, focus |
| `--muted-foreground` | `oklch(0.68 0.014 75)` | `oklch(0.46 0.014 60)` | secondary copy |

`--primary` is the same value as `--player-self` (gold). Panels draw their
**hairline gold border** from `--player-self` via `color-mix` (see the `panel`
recipe) — the neutral `--border` is for plain dividers.

### Player identity — the versus axis

| Token | Dark | Light | Meaning | Utilities |
| --- | --- | --- | --- | --- |
| `--player-self` | `oklch(0.82 0.12 90)` | `oklch(0.66 0.12 82)` | Champion (gold) — you | `bg/text/border-player-self` |
| `--player-self-foreground` | `oklch(0.17 0.02 80)` | `oklch(0.18 0.02 80)` | text on gold | `text-player-self-foreground` |
| `--player-opponent` | `oklch(0.64 0.19 18)` | `oklch(0.5 0.2 18)` | Challenger (crimson) | `bg/text/border-player-opponent` |
| `--player-opponent-foreground` | `oklch(0.16 0.03 20)` | `oklch(0.98 0.02 20)` | text on crimson | `text-player-opponent-foreground` |

Always put text on a filled identity chip with its `-foreground` pair, never
`text-white`. Opacity modifiers are fine for rules/washes: `bg-player-self/10`,
`border-player-self/40` (the gold rule between poster corners is
`bg-player-self/40`).

**Identity contrast rule (dark/stage).** Both identity inks are calibrated to
clear WCAG AA 4.5:1 as *normal-size text* on the stage: crimson is 5.36:1 on
`--background` and 5.00:1 on `--card` (gold: 11.33:1), so bare
`text-player-self` / `text-player-opponent` labels are safe at any size on
those two surfaces. Both `-foreground` pairs are **dark inks on bright fills**
(5.28:1 on crimson, 10.94:1 on gold) — the two corners of a versus lockup
follow the same pattern. Don't dim identity-colored *copy* with opacity
(`text-player-opponent/70` fails; opacity is for rules and washes), and don't
put identity-colored text on a surface darker than `--card` without
re-checking 4.5:1.

### Verdict semantics — the single source for judge outcomes

Later issues must replace **all** ad-hoc `emerald/green-600` (accepted),
`red-600/destructive` (rejected), and `amber/sky` (running/pending) usages in
race and dashboard code with these.

| Token | Dark | Light | Meaning | Utilities |
| --- | --- | --- | --- | --- |
| `--verdict-ok` | `oklch(0.75 0.16 150)` | `oklch(0.58 0.15 150)` | Accepted / passing | `text/bg-verdict-ok` |
| `--verdict-fail` | `oklch(0.62 0.22 27)` | `oklch(0.55 0.22 27)` | WA / RE / TLE / rejected | `text/bg-verdict-fail` |
| `--verdict-pending` | `oklch(0.76 0.15 65)` | `oklch(0.7 0.14 65)` | running / queued / awaiting | `text/bg-verdict-pending` |

Each has a `-foreground` pair for text sitting on the filled color. Two identity
clashes are handled by hue and saturation on purpose — **fail red (hue ~27) is
hotter (orange-lean) and more saturated than the rosier Challenger crimson
(hue ~18)**; **pending amber (hue ~65) leans warmer than Champion gold
(hue ~90)** — but never lean on hue alone: verdict colors describe **what
happened**, identity colors describe **who**. A pending opponent shows
*Challenger crimson* for their name and *verdict-pending* for their status.

### Radius & fonts

`--radius: 0.25rem` (hard edges — a stage, not a rounded app). `--radius-sm/md/lg…`
derive from it. Font vars: `--font-display` / `--font-heading` → Anton,
`--font-sans` → Geist Sans, `--font-mono` → Geist Mono.

## Surface recipes

Named utilities replace ad-hoc `rounded-xl border bg-card`. Reach for these
first. All carry the battle-stage signature: matte fill, hairline gold trim, hard
edges.

### `panel` — matte stage panel (primary surface)

The workhorse: minimal radius, a **hairline gold border** (`--player-self` at
30%), a whisper of gold top-light, and a deep soft floor shadow so it reads as
lit set dressing. Use for feature tiles, poster lockups, content cards, result
cards, lobby cards.

```html
<div class="panel p-5"> … </div>
```

### `stat-plate` — recessed matte plate

A darker, inset plate for a single number + label (Elo, rank, streak, race
count). Neutral hairline, no gold — it recedes.

```html
<div class="stat-plate px-3 py-2">
  <p class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Elo</p>
  <p class="font-mono text-2xl font-semibold tabular-nums">1540</p>
</div>
```

### `ticker` — lower-third bar

A broadcast lower-third: mono/uppercase, wide-tracked, with a **thin gold rule
along its top edge**. Full-width header/footer of a HUD (problem id, live state,
clock). Ships its own type + background; add padding + `justify-between`. Put
live numbers inside in `font-mono tabular-nums`.

```html
<div class="ticker justify-between px-4 py-2.5">
  <span>race · 1794C</span>
  <span class="flex items-center gap-1.5 text-verdict-pending">
    <span class="size-1.5 rounded-full bg-verdict-pending animate-pulse"></span>live
  </span>
</div>
```

### `spotlight` — warm overhead stage light

A subtle radial gold wash pooling from the top-center into the stage dark. Layer
behind hero content (`-z-10`); it's atmosphere, not a surface.

```html
<div aria-hidden class="spotlight pointer-events-none absolute inset-0 -z-10"></div>
```

### `stamp` — verdict stencil / rubber stamp

An upright boxed uppercase frame for verdict moments — **"BODIED."** on a result
hero, an **AC / WA** stamp in the feed. Sets the display face; the caller sets
the ink via text color.

```html
<span class="stamp text-verdict-fail text-3xl">Bodied.</span>
<span class="stamp text-verdict-ok text-sm">AC</span>
```

Buttons/badges keep the existing shadcn components (they already read from
`primary`/`destructive`/verdict tokens); do not restyle them per-surface. Buttons
inherit the tight `--radius`, which is the hard-edged stage look — leave it.

## Per-surface sketches

Layout uses the existing `shell` / `shell-narrow` width utilities. Section
dividers are `border-t border-border`. A thin gold rule (`bg-player-self/40`)
splits the two corners on a versus surface.

- **Nav (built, reference).** Wordmark: "cph2h" in `font-display uppercase` with a
  3px gold champion **underline rule** (the terminal-cursor motif is retired);
  simplified IA — **Play** (the hub) and **The Ladder** (leaderboard) in
  mono-uppercase, going `text-player-self` on hover; a top versus rule
  (`from-player-self via-border to-player-opponent`). See `src/components/nav.tsx`.
- **Landing (signed-out, built, reference).** Battle poster: a `spotlight` hero,
  `font-display uppercase` lockup with `Catch these bars.` in `text-player-self`,
  the tagline, and **one** CTA; a `VersusPoster` lockup (matte panel, lower-third
  tickers, Champion-gold vs Challenger-crimson corners split by a gold rule,
  live clock in `font-mono tabular-nums`); numbered process; `panel` feature
  tiles. See `src/app/page.tsx`.
- **Play hub (signed-in home).** Replaces the stats-dump dashboard (wave 2). Big
  **PLAY** actions front and center — quick match + challenge-a-friend with the
  filter form **inline** (`/challenge/new` collapses to a redirect/slim page); a
  recent-races strip and compact `stat-plate` tiles beside/below as supporting
  cast, not the hero. Stats stay, demoted. Primary action reads "Find a race";
  the challenge lockup names the opponent field plainly.
- **The Ladder (leaderboard).** A full-width `panel`; rows split with `divide-y
  divide-border`; rank in `font-display` (static, punchy); rating in `font-mono
  tabular-nums`; the signed-in user's own row washed `bg-player-self/10` with a
  left `border-l-2 border-player-self`. Empty state: "Nobody's stepped up."
- **Lobby / challenge.** A VS poster lockup: two facing corners (you = Champion
  gold, them = Challenger crimson) split by a gold rule, names in
  `font-display uppercase`, a center `VS`; ready chips use verdict tokens
  (`verdict-pending` waiting → `verdict-ok` ready); waiting copy "They're
  stalling." Big countdown in **`font-mono tabular-nums`** (live). Forfeit action
  labeled "Throw in the towel."
- **Active race room.** 3-col grid bones stay; retheme only. HUD frame: top
  `ticker` (problem id + live state), two player columns outlined in their
  identity color (`border-player-self` / `-player-opponent`), a live verdict feed
  where each row is `text-verdict-ok/fail/pending` (a small `stamp` for the
  verdict token reads as stenciled). Sample/progress bars are `bg-muted` tracks
  filled with the matching verdict color. The clock is the loudest element on
  screen: **`font-mono tabular-nums`**, large, `text-verdict-fail` under ~2 min
  left. Taunts render as **bar cards** (see below).
- **Bar-card taunts (the taunt motif).** A lower-third-style text card that slides
  in anchored to the sender's video tile, carries a **mic glyph**, and
  auto-dismisses (~4s). Preset text renders `font-display uppercase`; emote
  taunts render as one large glyph. The card tints toward the sender's identity
  (a left `border-l-2 border-player-self` / `-player-opponent`). Same sender
  replaces the previous card. Pure presentation — never trigger a snapshot
  refetch. The picker action is labeled "Spit a bar."
- **Result card.** A hero `panel`; the winner side washed in their identity color,
  loser dimmed; the outcome as a large `stamp` — **"BODIED."** in
  `text-player-self` for a win, "You got bodied." for a loss; Elo before → after
  with the delta in `font-mono tabular-nums`.

## Do / Don't

**Do**

- Use identity tokens for *who* (Champion gold / Challenger crimson) and verdict
  tokens for *what happened* — always.
- Reach for `panel` / `stat-plate` / `ticker` before writing a new surface style.
- Set every **live** number in `font-mono tabular-nums`; keep static display
  numbers in `font-display` only when they never move and don't share a column.
- Set headings, lockups, and stamps in `font-display uppercase tracking-tight`;
  keep eyebrows/tickers `font-mono uppercase`.
- Reserve the `spotlight` for hero surfaces and the `stamp` for verdict moments.
- Spend boldness once per view — one lockup, one stamp, one spotlight pool.
- Design and verify against **dark** (the stage); sanity-check light doesn't break.

**Don't**

- Don't use raw palette colors (`emerald-*`, `amber-*`, `green-600`, `red-600`,
  `text-white`) or hex literals in components — only tokens.
- Don't use a player color to mean a verdict, or a verdict color to mean an
  identity.
- Don't set a **live** number in `font-display` (it jitters — numeral rule), and
  don't set poster headings in `font-sans` or sentence case.
- Don't reintroduce comic energy — no halftone, speech bubbles, rotation, or
  stickers. This is a stage.
- Don't scatter the mic icon or the `stamp`; a mic is earned (the taunt picker),
  a stamp marks a verdict — nowhere else.
- Don't restyle shared `Button` / `Badge` per surface; extend tokens instead.
