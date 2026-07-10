# cph2h

**Head-to-head Codeforces racing.** Challenge a friend or quick-match by Elo, get the same problem at the same instant, and race to the first `Accepted` — face to face over voice and video.

**Live at [cph2h.vercel.app](https://cph2h.vercel.app).**

## How it works

1. **Link your Codeforces handle.** Ownership is proven with a compile-error challenge — you submit a deliberate `COMPILE_ERROR` to an assigned problem and the platform confirms it via the public CF API. No password is ever collected.
2. **Find an opponent.** Send a challenge link to a friend, or join the quick-match queue and get paired by Elo.
3. **Ready up.** Both players confirm, a countdown runs, and the problem is revealed to both at the same instant — never earlier.
4. **Race.** Solve locally and submit on codeforces.com as usual. The platform polls the public CF API and picks up your verdict within seconds — no manual reporting.
5. **Win.** First `Accepted` takes the race. Elo updates exactly once, atomically. Leaving mid-race forfeits after a grace period.

## Features

- **Challenge links & quick-match** — direct invites, or Elo-based pairing with rating and contest-date problem filters
- **Live voice & video** — LiveKit-powered opponent spotlight while you race
- **Automatic verdicts** — detected straight from Codeforces via API polling
- **Elo ladder** — provisional and standard K-factors, public leaderboard
- **Fair problems** — server-side gated until the synchronized start; filters exclude problems either player has already solved

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, deployed on Vercel |
| Database | Neon Postgres + Drizzle ORM (HTTP driver; atomic single-statement state transitions) |
| Auth | Clerk |
| Real-time | LiveKit Cloud — voice/video and race events (events are hints; the REST snapshot is the source of truth) |
| Codeforces | Public CF API only — verdict polling, handle verification, problem metadata |

## Local development

Prerequisites: Node.js 20+, pnpm, and free-tier accounts for Neon, Clerk, and LiveKit Cloud.

```bash
git clone https://github.com/C0derTang/cph2h.git
cd cph2h
pnpm install
cp .env.example .env.local   # fill in values — see docs/deployment.md
pnpm exec drizzle-kit migrate
pnpm exec tsx --env-file=.env.local scripts/populate-problems.ts   # seed the CF problem pool
pnpm dev
```

Open `http://localhost:3000` and sign in with Clerk. Every environment variable and where to get it is documented in [`docs/deployment.md`](./docs/deployment.md).

## Commands

```bash
pnpm dev                         # dev server on :3000
pnpm exec eslint .               # lint
pnpm exec tsc --noEmit           # typecheck
pnpm exec vitest run             # unit tests (tests/**/*.test.ts)
pnpm test:e2e                    # Playwright smoke test (needs a running app + e2e env vars)
pnpm exec drizzle-kit generate   # create a migration from a schema change
pnpm exec drizzle-kit migrate    # apply migrations
```

CI runs lint, typecheck, and unit tests. The Playwright smoke test is deliberately not a CI gate.

## Architecture

Pure logic lives in `src/lib/`; routes in `src/app/api/` are thin shells that validate, call pure functions, and persist.

- `src/lib/race/` — race lifecycle (`pending → ready → active → finished|aborted`), verdict polling, presence/forfeit
- `src/lib/matchmaking.ts` — quick-match pairing (single-statement claim with `FOR UPDATE SKIP LOCKED`)
- `src/lib/cf/` — Codeforces API client, handle verification, solve-history import
- `src/lib/types.ts` — the shared contract: race DTOs and the LiveKit event union

Invariants worth knowing before touching anything:

- Every state transition is an atomic compare-and-swap: `UPDATE ... WHERE status='<expected>' RETURNING *`; zero rows means you lost the race — re-read.
- `finishRace` is idempotent and is the sole place Elo is applied.
- The problem statement is never served before `startedAt`.
- LiveKit events are hints; clients refetch `GET /api/races/[id]` whenever an event can't be applied cleanly.

Deep dives: [`docs/architecture.md`](./docs/architecture.md) · [`docs/deployment.md`](./docs/deployment.md) · [`docs/design.md`](./docs/design.md)

## Contributing

Personal project — issues and PRs welcome, or fork and extend.

## License

[MIT](./LICENSE)
