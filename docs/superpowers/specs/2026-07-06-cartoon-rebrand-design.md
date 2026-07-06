# cph2h rebrand — "shittalk while doing Codeforces", rap-battle edition

Approved 2026-07-06; REVISED same day: the cartoonish/comic-book direction is dead — replaced with a **serious rap-battle / battle-stage** aesthetic. Trash-talk branding stays and hits harder. Name stays **cph2h**. Profanity: **full explicit** where it lands hardest (hero, taglines, result screens), seasoning not wallpaper. This file supersedes the comic-brawler spec that briefly lived here.

## 1. Brand voice

- Tagline: **"Shittalk your way to a higher rating."**
- Voice: battle-rap confidence — cold, superior, funny because it's deadpan. Not cartoonish, not jokey.
- Canonical copy (writers extend this voice):
  - Landing hero: "Same problem. Same clock. Catch these bars."
  - Win result: **"BODIED."** / Loss result: "You got bodied."
  - Empty leaderboard: "Nobody's stepped up."
  - No-match banner: "No problems match. Widen the filters or keep hiding."
  - Forfeit: "Throw in the towel"
  - Waiting for opponent: "They're stalling."
  - Leaderboard is called **"The Ladder"**; taunt picker action is **"Spit a bar"**.
- Data stays data: CF verdict strings, ratings, timestamps never rewritten.

## 2. Design system v2 (full replace of the esports v1)

`docs/design.md` rewritten as canonical spec. Token **names** survive (`--player-self/-opponent` + fg, `--verdict-ok/-fail/-pending` + fg, panel utilities); values/shapes replaced.

- **Stage-dark first.** Near-black stage base, warm spotlight treatments (subtle radial gradients on hero surfaces). Light theme defined but secondary ("daytime cypher" — warm paper, same inks).
- **Identity:** self = **gold/champagne** (champion), opponent = **crimson** (challenger). Versus surfaces are poster lockups: two corners, names in tall caps, a thin gold rule between.
- **Type:** tall condensed poster display via next/font/google (Anton / Archivo Black / Oswald class — builder picks for timer legibility; uppercase for headings/lockups; timers keep `tabular-nums` or fall back to mono per documented rule). Clean sans body, mono for code/data.
- **Motifs:** VS poster lockups; lower-third bars (broadcast-meets-stage) for tickers/status; stage panels — matte near-black with hairline gold borders, hard edges, minimal radius; stamp/stencil treatment for verdict moments ("BODIED." stamp on result hero, stencil AC/WA moments in the feed); mic iconography where an icon is earned (taunt picker), never scattered.
- **Wordmark:** cph2h in tall caps with a gold underline-rule; terminal cursor motif retired.
- No halftone, no speech bubbles, no rotation/sticker energy — this is a stage, not a comic.

## 3. Taunt feature (unchanged wire, restyled render)

- ~12 preset taunts + 6 emotes (💀 🔥 🤡 😭 🐐 🗑️). Presets only — no free text, no moderation surface. (Preset TEXTS in types.ts may be revoiced to battle-rap flavor in a later copy pass; ids stable.)
- Wire: existing LiveKit data channel, `RaceEvent` `{ type: "taunt"; byUserId; tauntId }`. Ephemeral, zero DB.
- Render: **"bar" card** — lower-third style text card that slides in anchored to the sender's video tile, mic glyph, auto-dismisses ~4s (`TAUNT_DISPLAY_MS`). Emotes large-glyph. Same-sender replaces previous.
- Cooldown 3s client-enforced. Taunt events never trigger snapshot refetch.
- Picker labeled "Spit a bar".

## 4. Site structure changes

- **Play hub:** signed-in home replaces the stats-dump dashboard. Composition: big PLAY actions front and center (quick match + challenge-a-friend with the filter form INLINE — `/challenge/new` becomes redundant; keep the route as a redirect or slim page), recent-races strip and compact stat plates beside/below. Stats remain, demoted from hero to supporting cast.
- **Nav/IA:** simplified to **Play** (hub) / **The Ladder** (leaderboard) / wordmark home; settings/profile stays wherever Clerk userButton lives. Entries in brand voice.
- **Race room:** 3-col grid bones stay; retheme only (stage panels, lower-third HUD treatment allowed within the existing column structure).
- **Landing (signed-out):** battle poster — hero lockup, tagline, one CTA.

## 5. Delivery

Master → builder → reviewer flow:

- Scaffold: taunt contract (landed pre-pivot; unchanged).
- **Wave 1 (parallel):**
  - #83 (opus): design system v2 per §2 + landing/nav exemplar per §4 — REDIRECTED from comic to rap-battle mid-flight.
  - #84 (sonnet): taunt feature per §3 — wire/logic unchanged by the pivot; minimal styling, wave 2 rethemes.
- **Wave 2 (parallel):**
  - L (sonnet): race surfaces retheme + race copy pass (stage panels, poster lockup lobby, BODIED result, bar-card taunts).
  - M (sonnet): **play hub restructure** (dashboard → hub, inline challenge form, redirect old route) + The Ladder retheme + remaining pages copy/metadata.

Verification: three checks per PR; screenshot review (landing, hub, ladder, lobby, race, result) in dark primary; two-browser taunt smoke; no off-token colors.
