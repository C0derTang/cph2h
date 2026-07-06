# cph2h cartoon rebrand — "shittalk while doing Codeforces"

Approved 2026-07-06. Supersedes the broadcast/esports visual direction (docs/design.md v1); replaces it wholesale with a comic-book brawler system. Name stays **cph2h**. Profanity level: **full explicit** where it lands hardest (hero, taglines, result screens), not on every label.

## 1. Brand voice

- Tagline: **"Shittalk your way to a higher rating."**
- Voice: confident, insulting-your-friend energy. Explicit profanity is seasoning, not wallpaper — comedy needs contrast.
- Canonical copy examples (writers extend in this voice):
  - Landing hero: "Same problem. Same clock. Talk your shit."
  - Empty leaderboard: "Nobody here. Scared, probably."
  - No-match banner: "No problems match. Skill issue? Widen the filters."
  - Forfeit button: "Rage quit"
  - Waiting for opponent: "They're stalling."
  - Win result: "Told you." / Loss result: "You got cooked."
- Data stays data: real CF verdict strings, ratings, and timestamps are never rewritten — attitude lives in surrounding copy.

## 2. Design system v2 (full replace)

`docs/design.md` is rewritten as the canonical spec. Token **names** and architecture survive (`--player-self`, `--player-opponent`, `--verdict-ok/-fail/-pending`, panel utilities); values and shapes are replaced.

- **Motif: speech bubbles.** Panels are bubble surfaces with thick (~3px) solid outlines. Taunts render as literal comic bubbles pointed at video tiles. Verdict events render as burst shapes: AC = starburst, WA/RE/TLE = jagged splat.
- **Palette:** hot saturated primaries (ink red-orange for self, electric blue/cyan for opponent — hue identities preserved from v1) on a cream/off-white paper base. **Light-first flip** (comic pages are light); dark mode = "night comic" deep navy with the same saturated inks. Both themes fully defined.
- **Type:** chunky comic display font via next/font/google (Bangers, Titan One, or equivalent — builder picks for legibility at timer sizes, must have tabular-friendly numerals or timers fall back to the mono) for headings/timers/bursts; readable sans for body; mono stays for code/data.
- **Texture & depth:** halftone-dot CSS backgrounds on hero surfaces; hard offset shadows (no blur) instead of glows; slight rotation (±1-3deg) on badges/bursts/stickers.
- **Wordmark:** cph2h inside a speech bubble; the old terminal cursor becomes the bubble tail.

## 3. Taunt feature (the one new feature)

- ~12 preset text taunts + 6 emotes (💀 🔥 🤡 😭 🐐 🗑️). Presets only — no free text, so no moderation surface.
- Wire: existing LiveKit data channel, new `RaceEvent` variant `{ type: "taunt"; byUserId: string; tauntId: string }`. Ephemeral: zero DB, zero persistence.
- Render: comic speech bubble anchored to the sender's video tile; pops in, auto-dismisses ~4s. Emote taunts render large-glyph.
- Cooldown: 3s, client-enforced (`TAUNT_COOLDOWN_MS`). Available in lobby and during the race (pending → active → finished).
- Taunt events must NOT trigger the snapshot refetch that other RaceEvents cause (they are pure presentation); the in-room event handler filters them out before the refetch path.
- Contract additions (master scaffold): the event variant, `TAUNT_PRESETS`/`TAUNT_EMOTES`, `TAUNT_COOLDOWN_MS` in `src/lib/types.ts`.

## 4. Delivery

Established master → builder → reviewer flow:

- **Scaffold (master, direct):** types.ts taunt contract; commit this spec.
- **Wave 1 (parallel):**
  - J (opus): design system v2 — design.md rewrite, globals.css token/shape/texture overhaul, fonts, light-first flip, nav + landing rebuilt as exemplar with explicit brand copy.
  - K (sonnet): taunt feature end-to-end (picker, send, bubble render, cooldown, event-filter so taunts don't refetch), minimally styled; wave 2 rethemes it.
- **Wave 2 (parallel):**
  - L (sonnet): race surfaces retheme (Lobby, RaceHUD, ResultCard, VerdictFeed, RaceRoom shell, VideoTiles, taunt bubbles) + race-surface copy pass.
  - M (sonnet): dashboard, leaderboard, challenge flow retheme + copy pass + remaining misc pages + site metadata (title/description in brand voice).

Verification: three checks per PR; screenshot review of landing/dashboard/race; two-browser taunt smoke (bubble appears on opponent's screen, no snapshot refetch storm); light + dark.
