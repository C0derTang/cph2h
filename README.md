# cph2h

Head-to-head Codeforces races: challenge a friend or quick-match by Elo, then race to solve the same problem first — with voice and video chat, an in-platform C++ editor, and direct submission to Codeforces.

## Stack

- Next.js (App Router) on Vercel
- Neon Postgres + Drizzle ORM
- Clerk (auth)
- LiveKit Cloud (voice/video + realtime race events)
- Judge0 CE (sample-test runs)
- Monaco editor (C++, per-user template)

## Development

```bash
pnpm install
cp .env.example .env.local   # fill in values (or `vercel env pull .env.local`)
pnpm dev
```

## Checks

```bash
pnpm exec eslint .
pnpm exec tsc --noEmit
pnpm exec vitest run
```

## Architecture notes

- All decision logic lives in pure functions under `src/lib/`; API routes are thin I/O shells.
- `src/lib/types.ts` holds the shared contracts (race lifecycle, LiveKit event union, DTOs) that every module codes against.
- Race state is pushed to clients over LiveKit data channels; `GET /api/races/[id]` is the source of truth.
