# CLAUDE.md — how agents work on cph2h

cph2h is a head-to-head Codeforces race platform. This file defines how AI agents build it. Read it before doing anything.

## The build model: master → builders → reviewers

Work is orchestrated, not free-for-all. There are three roles:

- **Master** (the main session). Owns planning, scaffolding, GitHub issues, dispatching subagents, reviewing their PRs via reviewer agents, merging, and deployment. Master does NOT implement features by hand — it delegates. The only things master edits directly are repo-wide scaffold/config (`CLAUDE.md`, `eslint.config.mjs`, `vercel.json`, `src/lib/types.ts` contract, CI) and merge/deploy glue.
- **Builder subagent**. Implements exactly one GitHub issue in an isolated git worktree, on its own branch, and opens one PR. Nothing more.
- **Reviewer subagent**. Reviews one PR read-only and returns APPROVE / REQUEST_CHANGES with concrete findings. Never edits code, never posts to GitHub — it reports to master.

Every change reaches `main` through: **issue → builder PR → reviewer → master merges.** No direct-to-main feature commits.

## Issues

- One issue = one PR = one agent. Right-size accordingly; if an issue needs 3+ agents, it's too big — split it.
- Label every issue with a wave (`wave-1`…`wave-4`) and a model tier (`model:haiku` | `model:sonnet` | `model:opus`).
- Waves gate dependencies: a wave only starts when the issues it depends on are merged. Issues within a wave must be independent enough to run in parallel; where a soft dependency exists, the depended-on interface is stubbed behind an injected hook so both can proceed (see `src/lib/race/hooks.ts` for the pattern).

## Model tiers (pick by complexity)

- **haiku** — trivial/mechanical: config, copy, pure single-purpose modules, docs.
- **sonnet** — standard features: routes, UI, integrations with a clear spec.
- **opus** — load-bearing logic: concurrency, the race engine, matchmaking, auth/crypto, cross-module integration.

## Builder rules

- Work in your assigned isolated worktree. Create branch `issue/<n>-<slug>`. `pnpm install` first (worktrees have no `node_modules`; the registry is occasionally flaky — retry).
- Read the shared contract `src/lib/types.ts` and the modules you depend on before writing. **Reuse** existing modules; do not reimplement crypto, the CF client, the DB schema, etc.
- Do NOT modify `src/lib/types.ts` or `src/lib/db/schema.ts` unless the issue is explicitly about them — flag needed contract changes to master instead.
- Keep cross-issue couplings behind injected/optional hooks so your PR merges without the other issue.
- All three checks must pass before you open the PR: `pnpm exec eslint .`, `pnpm exec tsc --noEmit`, `pnpm exec vitest run`.
- Tests live in `tests/**/*.test.ts` — that is the only glob vitest runs. A test file anywhere else (e.g. colocated in `src/`) silently never runs. e2e lives in `e2e/` and is deliberately outside that glob.
- PR body: `Closes #<n>`, what changed, how verified, notes for reviewers, any deviations.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Reviewer rules

- Read-only from the main repo dir; do not check out the branch or edit.
- `gh pr view/diff/checks <n>`, read the issue spec, verify against the actual code (not the PR's self-report).
- Scrutinize the issue's load-bearing invariant hardest (concurrency safety, no-double-Elo, no-problem-leak-before-start, credential safety, output-comparison correctness, test discovery).
- Verify claims against installed dependency versions when an API is in question (e.g. Clerk v7). Don't trust training data.
- Return APPROVE or REQUEST_CHANGES with `file:line`, the problem, and a concrete fix. Skip style nits. Report to master; do not comment on the PR.

## Master merge flow

- On REQUEST_CHANGES: send the finding back to the same builder (resume it) to fix on its branch; re-verify CI.
- Merge with `gh pr merge <n> --squash`. Do NOT `--delete-branch` (worktree lock on Windows) — clean up after the wave.
- Dep-adding PRs conflict on `pnpm-lock.yaml`. Merge one, then have the next builder `git merge origin/main` and regenerate the lock with `pnpm install` (never hand-merge the lockfile).
- After each wave: `git checkout main && git pull`, remove `.claude/worktrees`, `git worktree prune`, delete merged branches, then verify integrated main (all three checks) before starting the next wave.
- File non-blocking review findings as follow-up issues rather than blocking a merge.

## Architecture (respect these)

- **Pure logic in `src/lib/`, thin I/O shells in `src/app/api/`.** Decision logic is pure and unit-tested; routes just validate, call pure functions, and persist.
- **`src/lib/types.ts` is the shared contract** — race lifecycle, `RaceEvent` union, DTOs. Everything codes against it.
- **Events are hints; `GET /api/races/[id]` is the source of truth.** Clients refetch the snapshot on mount/reconnect/any unapplyable LiveKit event.
- **Race lifecycle**: `pending → ready → active → finished|aborted`; countdown is derived (`active && now < startedAt`), not stored. All transitions are atomic: `UPDATE ... WHERE id=$1 AND status='<expected>' RETURNING *`; zero rows = lost the race, re-read.
- **`finishRace` is idempotent** via its own atomic claim — it is the sole Elo-application mutex. Default claim is `WHERE status='active'`; the matchmade ready-deadline walkover (`readyWalkover` input) claims `WHERE status='ready' AND ready_deadline_at < now AND exact ready flags` instead. The two claims are mutually exclusive (one status at a time).
- **Matchmade races** (quick match) are discriminated by non-null `races.ready_deadline_at` (pairing time + `READY_DEADLINE_SEC`). Past the deadline: one player ready → walkover win via `finishRace` (full Elo, `startedAt` stays null — that's the client's walkover marker); zero ready → abort, no Elo. Enforcement is lazy (snapshot GET / ready POST resolve-then-re-read; daily sweep backstop). Matchmade filters = intersection of both players' queue filters, locked (`PATCH filters` → 409). Queue rows carry filters + a `last_seen_at` poll heartbeat — the sweep purges on heartbeat staleness, never `enqueued_at`.
- **Never leak the problem before `startedAt`** (server-side gate in the snapshot builder).

## Stack gotchas

- **Neon HTTP driver has no interactive transactions.** Use a single atomic SQL statement / CTE for claim-and-mutate (matchmaking pairing uses `FOR UPDATE SKIP LOCKED` + a self-lock guard), and `db.batch([...])` for all-or-nothing multi-write finalize.
- **Clerk v7**: middleware is `src/proxy.ts`; use `<Show when="signed-in">` (there is no `<SignedIn>`/`<SignedOut>` in v7); `auth()` from `@clerk/nextjs/server` for the Clerk id — resolve the DB user via `eq(users.clerkId, clerkId)`, never compare `auth().userId` to `users.id`.
- **Isolation worktrees** nest full repo copies under `.claude/worktrees/`; `.claude/**` is eslint-ignored so the parent lint isn't polluted. Remove stale worktree dirs after each wave.
- **No in-platform code execution.** The IDE, Piston sample-runner, and template settings were all removed (#98–#100 + cleanup) — users code locally and submit on codeforces.com. No Judge0, no Piston, no Monaco.
- **Codeforces Cloudflare-blocks server-side login/submit.** `/enter` and `/submit` return a 403 JS challenge to any serverless `fetch` (the user's own browser passes it). So there is NO password login and NO in-platform submission. Account linking uses **Codeforces OpenID Connect** (#173; replaced the old compile-error challenge in #179): `GET /api/cf/oauth/start` → CF `oauth/authorize` → `/api/cf/oauth/callback` exchanges the code (`client_secret_post`) and verifies the **HS256** id_token with the client secret via `jose` (claims include `handle`/`rating`/`avatar`; discovery at `codeforces.com/.well-known/openid-configuration`). Needs `CF_OAUTH_CLIENT_ID`/`CF_OAUTH_CLIENT_SECRET` (app registered at codeforces.com/settings/api). The `handle_verifications` table is orphaned pending cleanup (#180). During a race the user submits on codeforces.com themselves; verdicts are detected by polling `user.status` (the poll upserts `race_submissions` rows for observed verdicts). The public CF **API** and problem-statement pages (browser UA) work fine server-side. There is no `crypto.ts` / `cf_credentials` / `cf_sessions` — all removed in #55/#56.
- **Migrations auto-apply on deploy**: `vercel-build` runs `drizzle-kit migrate && next build`, so merging a migration to main migrates prod. Apply to the dev DB manually (`pnpm exec drizzle-kit migrate` with `.env.local`'s `DATABASE_URL`).
- **Admin surface** (#175/#176): `users.is_admin` gates `/admin` + `/api/admin/**` via `requireAdmin` (non-admins get 404, never 403). Flip admins by SQL only — there is deliberately no UI/API to grant admin.
- **Vercel Hobby caps crons at once/day** — the sweep cron is daily; minute-level needs Pro or an external scheduler hitting `/api/cron/sweep` with the `CRON_SECRET` bearer.
- **Setting Vercel env vars**: a PowerShell pipe appends a trailing newline (breaks header-valued secrets). Use bash `printf '%s' "$VAL" | vercel env add NAME <env>`.

## Commands

```bash
pnpm install
pnpm dev
pnpm exec eslint .          # lint
pnpm exec tsc --noEmit      # typecheck
pnpm exec vitest run        # unit tests (tests/**/*.test.ts only)
pnpm exec drizzle-kit generate   # create migration from schema change
pnpm exec drizzle-kit migrate    # apply migrations (needs DATABASE_URL)
pnpm test:e2e               # Playwright smoke (not a CI gate; needs a running app)
```

CI gate = lint + typecheck + unit tests. e2e is never a CI gate (flaky by nature). See `docs/architecture.md` and `docs/deployment.md` for deeper detail.
