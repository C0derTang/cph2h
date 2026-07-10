# cph2h

Head-to-head Codeforces races: challenge a friend or quick-match by Elo, then race to solve the same problem first — face to face over voice and video.

**Live at [cph2h.vercel.app](https://cph2h.vercel.app).**

## How a race works

1. Link your Codeforces handle (ownership proven via a compile-error challenge — no password ever collected).
2. Challenge a friend by link or hop in the quick-match queue (paired by Elo).
3. Both players ready up, a countdown runs, and the problem unlocks for both at the same instant.
4. Solve locally and submit on codeforces.com as usual — the platform polls the public CF API and detects your verdict within seconds.
5. First `Accepted` wins. Elo updates atomically; closing the tab mid-race forfeits after a grace period.

## Features

- **Challenge or Quick-Match** — direct invite links, or Elo-based pairing with rating/contest-date problem filters
- **Live voice & video** — LiveKit-powered opponent spotlight during the race
- **Verdict detection** — no manual reporting; verdicts come from Codeforces itself via API polling
- **Elo ladder** — provisional and standard K-factors, public leaderboard
- **Problem fairness** — the problem is never revealed before the synchronized start, and filters exclude problems either player has already solved

## Stack

- **Framework**: Next.js 16 (App Router) + React 19, deployed on Vercel
- **Database**: Neon Postgres + Drizzle ORM (HTTP driver, atomic single-statement state transitions)
- **Auth**: Clerk
- **Real-time**: LiveKit Cloud (voice/video; race events as hints — the REST snapshot is the source of truth)
- **Codeforces**: public CF API only (verdict polling, handle verification, problem metadata)

## Local development

Prerequisites: Node.js 20+, pnpm, plus free-tier accounts for Neon, Clerk, and LiveKit Cloud.

```bash
git clone https://github.com/C0derTang/cph2h.git
cd cph2h
pnpm install
cp .env.example .env.local   # fill in values — see docs/deployment.md
pnpm exec drizzle-kit migrate
pnpm exec tsx --env-file=.env.local scripts/populate-problems.ts   # seed the CF problem pool
pnpm dev
```

Visit `http://localhost:3000` and sign in with Clerk. See [`docs/deployment.md`](./docs/deployment.md) for every environment variable and where to obtain it.

## Commands

```bash
pnpm dev                    # dev server on :3000
pnpm exec eslint .          # lint
pnpm exec tsc --noEmit      # typecheck
pnpm exec vitest run        # unit tests (tests/**)
pnpm test:e2e               # Playwright smoke (needs a running app)
pnpm exec drizzle-kit generate   # migration from schema change
pnpm exec drizzle-kit migrate    # apply migrations
```

## Architecture

Pure logic in `src/lib/`, thin I/O shells in `src/app/api/`:

- `src/lib/race/` — race lifecycle (`pending → ready → active → finished|aborted`), verdict polling, presence/forfeit
- `src/lib/matchmaking.ts` — quick-match pairing (`FOR UPDATE SKIP LOCKED` single-statement claim)
- `src/lib/cf/` — Codeforces API client, handle verification, solve-history import
- `src/lib/types.ts` — shared contract: race DTOs, LiveKit event union

Key invariants: all state transitions are atomic compare-and-swap SQL (`UPDATE ... WHERE status='expected'`); `finishRace` is idempotent and is the sole Elo-application mutex; the problem is server-side gated until `startedAt`. LiveKit events are hints — clients refetch `GET /api/races/[id]` whenever an event can't be applied cleanly.

More detail in [`docs/architecture.md`](./docs/architecture.md).

## Deployment

Vercel + Neon + Clerk + LiveKit; full runbook and production checklist in [`docs/deployment.md`](./docs/deployment.md).

## Contributing

Personal project — issues and PRs welcome, or fork and extend.

## License

[MIT](./LICENSE)
