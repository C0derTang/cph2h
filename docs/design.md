# cph2h design system — the Match Arena

This is the canonical visual spec. Every UI issue codes against it. If a surface
you are building isn't sketched here, derive it from the tokens and panel recipes
below rather than inventing new colors or one-off card styles.

## Direction

**Broadcast / esports match arena.** cph2h is a 1v1 duel: two people, one
problem, one clock, one winner. The interface should feel like the on-air HUD of
a live competitive broadcast — a dark arena, dramatic contrast, and two identity
colors that *clash* across every versus surface.

Two ideas carry the whole system:

1. **The versus axis.** You are always Ember (`--player-self`). Your opponent is
   always Signal cyan (`--player-opponent`). These two never swap and never
   appear as decoration — a color on screen means an identity.
2. **The HUD plate.** Content lives on lit, hairline-framed broadcast panels, not
   soft rounded cards. The signature surface (the scoreboard) is *chamfered* — its
   top-right and bottom-left corners are clipped, echoing the cut letterforms of
   the display face.

Dark is the hero and the default (`<html class="dark">`). Light ("studio
daylight") is fully defined and accessible for a future toggle, but design and
screenshot against dark.

## Typography

Three roles, three faces. Load via `next/font/google` in `layout.tsx`.

| Role | Face | Tailwind | Use for |
| --- | --- | --- | --- |
| Display / scoreboard | **Chakra Petch** | `font-display`, `font-heading` | `h1`–`h3`, the wordmark, player names in HUDs, ratings, **every timer and scoreboard number** |
| Body | **Geist Sans** | `font-sans` (default) | paragraphs, descriptions, form labels, buttons |
| Data / mono | **Geist Mono** | `font-mono` | problem IDs, verdict feed, eyebrows, tickers, code |

`font-heading` and `font-display` are the same face (Chakra Petch) — `font-heading`
exists for the shadcn `CardTitle` contract; prefer `font-display` in new code.

### Type scale & rules

| Token | Size / leading | Weight | Notes |
| --- | --- | --- | --- |
| Display XL (hero `h1`) | `text-5xl`→`text-7xl` / `leading-[0.98]` | 600 | `font-display tracking-tight`; set the decisive word in `text-player-self` |
| Display L (`h2`) | `text-2xl`→`text-3xl` | 600 | section headers |
| Display M (`h3`, card title) | `text-base`→`text-lg` | 600 | panel titles |
| Timer / big stat | `text-lg`+ | 600 | `font-display tabular-nums` — **always `tabular-nums`** so digits don't jitter |
| Eyebrow / ticker | `text-[11px]` | 500 | `font-mono uppercase tracking-[0.18em]` |
| Body | `text-sm`→`text-base` / `leading-6`–`leading-7` | 400 | `text-muted-foreground` for secondary copy |
| Data inline | `text-[11px]`→`text-xs` | 400–500 | `font-mono` — ratings, sample counts, IDs |

Rules: headings are never `font-sans`. Numbers that update live (timers, ratings,
sample counts, Elo deltas) are `font-display tabular-nums`. Eyebrows and tickers
are `font-mono uppercase` with wide tracking — never sentence-case body.

## Color tokens

All defined in `globals.css` on `:root` (light) and `.dark` (dark), surfaced to
Tailwind via `@theme inline` as `--color-*`. Use the utility, never a raw hex or a
Tailwind palette color (`emerald-500`, `sky-400`, `text-white`, …).

### Neutrals & core (existing shadcn contract — kept)

`background`, `foreground`, `card`, `card-foreground`, `popover`, `muted`,
`muted-foreground`, `secondary`, `accent`, `border`, `input`, `ring`,
`destructive`. Dark background is deep ink navy `oklch(0.16 0.018 262)`, not pure
black; foreground is a faintly-cool near-white. `--primary` stays Ember and is the
same hue as `--player-self`.

### Player identity — the versus axis

| Token | Dark | Meaning | Utilities |
| --- | --- | --- | --- |
| `--player-self` | Ember `#ff6a3d` | you | `bg-player-self`, `text-player-self`, `border-player-self` |
| `--player-self-foreground` | `#1a0b04` | text on Ember | `text-player-self-foreground` |
| `--player-opponent` | Signal cyan `oklch(0.79 0.13 214)` | your opponent | `bg-player-opponent`, `text-player-opponent`, `border-player-opponent` |
| `--player-opponent-foreground` | ink `oklch(0.17 0.04 240)` | text on cyan | `text-player-opponent-foreground` |

Always put text on a filled identity chip with its `-foreground` pair, never
`text-white`. Opacity modifiers are fine for glows/tracks: `bg-player-self/10`,
`border-player-opponent/40`.

### Verdict semantics — the single source for judge outcomes

Later issues must replace **all** ad-hoc `emerald/green-600` (accepted),
`red-600/destructive` (rejected), and `amber/sky` (running/pending) usages in race
and dashboard code with these:

| Token | Dark | Meaning | Utilities |
| --- | --- | --- | --- |
| `--verdict-ok` | green `oklch(0.8 0.17 155)` | Accepted / passing samples | `text-verdict-ok`, `bg-verdict-ok` |
| `--verdict-fail` | red `oklch(0.68 0.2 20)` | WA / RE / TLE / rejected | `text-verdict-fail`, `bg-verdict-fail` |
| `--verdict-pending` | amber `oklch(0.83 0.15 78)` | running / queued / awaiting judge | `text-verdict-pending`, `bg-verdict-pending` |

Each has a `-foreground` pair for text sitting on the filled color.

Verdict colors describe **outcomes**, identity colors describe **who** — do not use
a player color to signal a verdict, or vice-versa. A pending opponent shows the
*opponent* color for their name/avatar and *verdict-pending* for their status.

### Radius & fonts

`--radius: 0.4rem` (tighter than default — HUD, not app card). `--radius-sm/md/lg…`
derive from it. Font vars: `--font-display` / `--font-heading` → Chakra Petch,
`--font-sans` → Geist, `--font-mono` → Geist Mono.

## Panel recipes

Three named surface utilities replace the old universal
`rounded-xl border bg-card/40`. Reach for these first.

### `panel` — broadcast panel (primary surface)

Elevated, hairline-framed, interior top highlight + deep drop shadow so it reads
as lit studio equipment. Use for feature tiles, the scoreboard shell, content
cards, result cards, lobby cards.

```html
<div class="panel p-5"> … </div>
```

Add `clip-notch` on the *signature* surface (the scoreboard / result hero) for the
chamfered corners. Use it sparingly — one notched plate per view, not every panel.

```html
<div class="panel clip-notch overflow-hidden"> … </div>
```

### `stat-plate` — recessed scoreboard tile

A darker, inset tile for a single number + label (Elo, rank, streak, race count).

```html
<div class="stat-plate px-3 py-2">
  <p class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Elo</p>
  <p class="font-display text-2xl font-semibold tabular-nums">1540</p>
</div>
```

### `ticker` — live status strip

Full-width mono/uppercase strip for headers and footers of a HUD: problem id, live
state, format, clock. Ships its own type + border; add padding + `justify-between`.

```html
<div class="ticker justify-between px-4 py-2.5">
  <span>race · 1794C</span>
  <span class="flex items-center gap-1.5 text-verdict-pending">
    <span class="size-1.5 rounded-full bg-verdict-pending animate-pulse"></span>live
  </span>
</div>
```

Buttons/badges keep the existing shadcn components (they already read from
`primary`/`destructive`); do not restyle them per-surface.

## Per-surface sketches

Layout uses the existing `shell` / `shell-narrow` width utilities. `divide-x
divide-border` splits the two players on any versus surface.

- **Landing (built, reference).** Ambient identity glows behind a `panel clip-notch`
  scoreboard; `font-display` hero with `One winner.` in `text-player-self`;
  numbered ordered process; `panel` feature tiles. See `src/app/page.tsx`.
- **Nav (built, reference).** Versus hairline (`from-player-self via-border
  to-player-opponent`) across the top edge; `> cph2h` wordmark in `font-display`
  with an Ember caret + blinking cursor; mono-uppercase links. See
  `src/components/nav.tsx`.
- **Dashboard.** Row of `stat-plate` tiles (Elo, rank, W/L, streak) above a match
  history list; Elo deltas in `font-display tabular-nums`, colored `text-verdict-ok`
  (gain) / `text-verdict-fail` (loss). One `panel` per history row.
- **Leaderboard.** Full-width `panel`; rows split with `divide-y divide-border`;
  rank in `font-display tabular-nums`; the signed-in user's own row tinted
  `bg-player-self/10` with a left `border-player-self`. Rating in mono.
- **Lobby / challenge.** Two facing `panel`s (you left / opponent right) or a
  single `panel clip-notch` with a center `VS` badge; ready-state chips use verdict
  tokens (`verdict-pending` waiting → `verdict-ok` ready). Big countdown in
  `font-display tabular-nums`.
- **Active race room.** HUD frame: top `ticker` (problem id + clock), two player
  columns bordered in their identity color (`ring-player-self` /
  `ring-player-opponent`), a live verdict feed where each row is
  `text-verdict-ok/fail/pending`. Progress/sample bars are `bg-muted` tracks filled
  with the matching verdict color. The clock is the loudest element on screen:
  `font-display tabular-nums`, large, `text-verdict-fail` under ~2 min left.
- **Result card.** `panel clip-notch` hero; winner side glows in their identity
  color, loser dimmed; final verdict in a large verdict-token badge; Elo before →
  after with the delta in `font-display tabular-nums`.

## Do / Don't

**Do**

- Use identity tokens for *who* and verdict tokens for *what happened* — always.
- Reach for `panel` / `stat-plate` / `ticker` before writing a new surface style.
- Set every live-updating number in `font-display tabular-nums`.
- Keep headings on `font-display`; keep eyebrows/tickers `font-mono uppercase`.
- Reserve `clip-notch` for the one signature plate in a view.
- Design and verify against dark; sanity-check light doesn't break.

**Don't**

- Don't use raw palette colors (`emerald-*`, `sky-*`, `green-600`, `red-600`,
  `text-white`) or hex literals in components — only tokens.
- Don't use a player color to mean a verdict, or a verdict color to mean an
  identity.
- Don't set headings or numbers in `font-sans`.
- Don't reintroduce the universal `rounded-xl border bg-card/40` card.
- Don't scatter `clip-notch` / glows across every element — spend boldness once
  per view.
- Don't restyle shared `Button` / `Badge` per surface; extend tokens instead.
