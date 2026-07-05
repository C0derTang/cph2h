# cph2h

Head-to-head Codeforces races: challenge a friend or quick-match by Elo, then race to solve the same problem first — with voice and video chat, an in-platform C++ editor, and direct submission to Codeforces.

## Features

- **Challenge or Quick-Match**: Invite a friend directly or get matched by Elo rating for a fair fight
- **Real-time Voice & Video**: Integrated LiveKit for voice and video chat during races
- **In-Browser C++ Editor**: Monaco editor with syntax highlighting, inline compilation via Piston, and personal C++ templates
- **Direct Codeforces Integration**: Submit solutions directly to Codeforces and see verdicts in real-time
- **Elo Rating System**: Provisional (10 races) and standard K-factors track your skill over time
- **Race Leaderboard**: See top racers and your own progress

## Stack

- **Frontend**: Next.js 16 (App Router) on Vercel
- **Database**: Neon Postgres with Drizzle ORM
- **Auth**: Clerk
- **Real-time**: LiveKit Cloud (voice/video + race event broadcasts)
- **Code Execution**: Piston (free, keyless sample test compilation & runs)
- **Code Editor**: Monaco (C++ syntax, per-user template)

## Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- A Clerk account
- A Neon Postgres database
- LiveKit Cloud credentials
- A Codeforces account (to link in the app)
- No signup needed for sample test compilation — Piston is free and keyless (see [`docs/deployment.md`](./docs/deployment.md))

### Local Development

1. **Clone and install:**

```bash
git clone https://github.com/C0derTang/cph2h.git
cd cph2h
pnpm install
```

2. **Set up environment variables:**

```bash
cp .env.example .env.local
```

Then fill in the values. See [`docs/deployment.md`](./docs/deployment.md#environment-variables) for details on each variable and where to obtain it. Alternatively, pull from Vercel:

```bash
vercel link   # link to your Vercel project
vercel env pull .env.local
```

3. **Run migrations:**

```bash
pnpm exec drizzle-kit migrate
```

4. **Start the development server:**

```bash
pnpm dev
```

Visit `http://localhost:3000` and sign in with Clerk.

5. **Optional: Seed test data**

If you want to populate the database with test problems and races, run:

```bash
pnpm exec tsx scripts/seed.ts   # if a seed script exists
```

## Commands

### Development

```bash
pnpm dev                    # Start dev server on :3000
```

### Testing & Linting

```bash
pnpm exec eslint .          # Lint the codebase
pnpm exec tsc --noEmit      # Type check without emitting
pnpm exec vitest run        # Run tests once
pnpm exec vitest            # Run tests in watch mode
```

### Database

```bash
pnpm exec drizzle-kit migrate          # Run pending migrations
pnpm exec drizzle-kit generate         # Generate migration files from schema changes
pnpm exec drizzle-kit studio           # Open Drizzle Studio (DB explorer)
```

## Architecture Overview

The app is organized by **pure logic + thin routes**:

- **`src/lib/`**: All business logic is pure (no I/O, no side effects)
  - `src/lib/race/`: Race lifecycle (create, finish, poll verdicts)
  - `src/lib/matchmaking.ts`: Quick-match pairing with SKIP LOCKED
  - `src/lib/cf/`: Codeforces integration (login, submit, fetch problems)
  - `src/lib/livekit.ts`: LiveKit room + event publishing
- **`src/app/api/`**: Thin I/O shells that apply pure results atomically
- **`src/lib/types.ts`**: Shared contracts (RaceSnapshot, LiveKit events, DTOs)

Key principle: **Events are hints; `GET /api/races/[id]` is the source of truth.** Clients refetch the race snapshot whenever they receive a LiveKit event and cannot apply it cleanly.

See [`docs/architecture.md`](./docs/architecture.md) for more detail on the race lifecycle, verdict polling, and matchmaking.

## Deployment

Full deployment instructions (Vercel, Neon, Clerk, LiveKit, Piston setup, cron config) are in [`docs/deployment.md`](./docs/deployment.md).

Before deploying to production, review the [production checklist](./docs/deployment.md#production-checklist).

## Screenshots & GIFs

[Placeholders for screenshots showing the race interface, chat, editor, etc.]

## Contributing

This is a personal project; feel free to fork and extend!

## License

MIT
