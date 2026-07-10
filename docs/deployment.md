# Deployment Guide

This guide covers deploying cph2h to production on Vercel with full integration for Neon, Clerk, and LiveKit.

## Vercel Setup

1. **Link your repository:**
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repository (`C0derTang/cph2h`)
   - Select Next.js as the framework
   - Deploy!

2. **Environment variables** (see [Environment Variables](#environment-variables) below)

## Service Integration

### 1. Neon Postgres

Neon provides the database for user accounts, races, problems, and more.

#### Setup via Vercel Marketplace

1. In your Vercel project dashboard, go to **Settings** > **Integrations**
2. Search for **Neon** and click **Add**
3. Authorize Neon and create a new project, or select an existing one
4. Neon will automatically set `DATABASE_URL` in your environment

#### Manual Setup

If not using the marketplace:
1. Go to [neon.tech](https://neon.tech) and create a project
2. Copy the connection string: `postgresql://user:password@host/dbname`
3. Add it as `DATABASE_URL` in Vercel environment variables

#### Running Migrations

Migrations run **automatically on every Vercel deployment** before your functions start. Drizzle Kit is configured to:
1. Check for pending migrations in `drizzle/migrations/`
2. Apply them sequentially to your Postgres database
3. Report any errors to the deployment logs

To manually run migrations locally:

```bash
DATABASE_URL=<your_neon_url> pnpm exec drizzle-kit migrate
```

### 2. Clerk (Authentication)

Clerk handles user sign-up, login, and session management.

#### Setup via Vercel Marketplace

1. In your Vercel project, go to **Settings** > **Integrations**
2. Search for **Clerk** and click **Add**
3. Authorize Clerk and create a new application, or select an existing one
4. Clerk will automatically set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`

#### Manual Setup

If not using the marketplace:
1. Go to [clerk.com](https://clerk.com) and create an application
2. Copy your **Publishable Key** and **Secret Key**
3. Add them to Vercel:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (can be public)
   - `CLERK_SECRET_KEY` (secret; use preview/production overrides as needed)

#### Local Development

In `.env.local`, set both keys to your Clerk test or development keys.

### 3. LiveKit Cloud

LiveKit powers real-time voice, video, and data channels for race events.

#### Setup

1. Go to [livekit.io/cloud](https://livekit.io/cloud)
2. Create a new project or use an existing one
3. In your project settings, find:
   - **API Key** (e.g., `DEVKEY...`)
   - **API Secret** (a long random string)
   - **WebSocket URL** (e.g., `wss://your-workspace.livekit.cloud`)

4. Add to Vercel environment variables:
   - `LIVEKIT_API_KEY` (the API key from step 3)
   - `LIVEKIT_API_SECRET` (the secret from step 3)
   - `LIVEKIT_URL` (the WebSocket URL; clients receive it from `/api/livekit/token`)

#### Local Development

In `.env.local`, use the same LiveKit credentials.

## Environment Variables

The complete list of environment variables required for deployment:

| Variable | Origin | Visibility | Purpose | Example |
|----------|--------|------------|---------|---------|
| `DATABASE_URL` | Neon (Marketplace) | Secret | Drizzle ORM connection to Postgres | `postgresql://user:pass@host/cph2h` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk (Marketplace) | Public | Clerk frontend token | `pk_test_abc123...` |
| `CLERK_SECRET_KEY` | Clerk (Marketplace) | Secret | Clerk backend token | `sk_test_xyz789...` |
| `LIVEKIT_API_KEY` | LiveKit Cloud | Secret | LiveKit server API key | `DEVKEY...` |
| `LIVEKIT_API_SECRET` | LiveKit Cloud | Secret | LiveKit server API secret | `long-random-string...` |
| `LIVEKIT_URL` | LiveKit Cloud | Secret | LiveKit WebSocket URL (server-side room management; also handed to clients via `/api/livekit/token`) | `wss://your-workspace.livekit.cloud` |
| `CRON_SECRET` | Manual (generate) | Secret | Bearer token protecting `/api/cron/*` routes | (see below) |
| `RACE_TEST_MODE` | Manual | Secret | Set to `0` in production; `1` only in dev for testing (enables `/api/dev/inject-verdict`) | `0` |

### Generating Secrets

For `CRON_SECRET`, generate a strong random value:

```bash
# On macOS/Linux:
openssl rand -hex 32     # 64 hex chars = 32 bytes

# On Windows (PowerShell):
[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Store these in a secure location (e.g., 1Password, LastPass) and add them to Vercel.

## Cron Jobs

Vercel Cron integrates two scheduled background jobs:

### 1. **Sweep** (`/api/cron/sweep`)

- **Schedule**: Every minute (`* * * * *`)
- **Purpose**: 
  - Force-poll active races idle for >60 seconds (catch stalled verdict checks)
  - Force-poll races past their time limit (ensure timeout draws are resolved)
  - Abort pending races older than 24 hours (cleanup stale challenges)
  - Purge queue entries older than 5 minutes (cleanup abandoned matchmaking)
- **Protection**: `CRON_SECRET` header

### 2. **Problemset Sync** (`/api/cron/problemset`)

- **Schedule**: Every Monday at 4 AM UTC (`0 4 * * 1`)
- **Purpose**: Fetch the latest Codeforces problem set and update the local cache
- **Protection**: `CRON_SECRET` header

Both are configured in [`vercel.json`](../vercel.json).

#### Testing Crons Locally

To test a cron endpoint locally without waiting:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sweep
```

Set `CRON_SECRET` in `.env.local` to a test value for this.

## Deploying

1. **Push to your repository:**
   ```bash
   git checkout -b my-feature
   # ... make changes ...
   git add .
   git commit -m "My changes"
   git push origin my-feature
   ```

2. **Open a pull request** on GitHub. Vercel will automatically:
   - Build a preview deployment
   - Run type checks and linting
   - Make the preview URL available in the PR

3. **Merge to main** when ready. Vercel will:
   - Build and test
   - Run any pending Drizzle migrations
   - Deploy to production

## Database Migrations

Migrations are stored in `drizzle/migrations/` and are applied **automatically during Vercel deployment**.

To generate a new migration after schema changes:

```bash
pnpm exec drizzle-kit generate
```

This creates a SQL migration file that will run the next time you deploy.

To roll back (if needed):

```bash
# Revert the last migration by removing it from drizzle/migrations/
# (This is manual and risky; avoid in production without testing first)
```

## Preview & Production Deployments

Vercel supports environment variable overrides per deployment:

- **Preview** (pull requests & dev branches): Use development/test credentials
  - Test Clerk project, test Neon database, test LiveKit workspace, etc.
  - Set `RACE_TEST_MODE=1` to enable `/api/dev/inject-verdict` for testing

- **Production** (main branch): Use production credentials
  - Production Clerk project, production Neon database, production LiveKit workspace
  - Set `RACE_TEST_MODE=0` (or empty) to disable test endpoints

## Troubleshooting

### "DATABASE_URL is undefined"

- Verify the Neon integration is active in Vercel
- If using manual setup, double-check the connection string
- Local dev: Ensure `.env.local` has a valid `DATABASE_URL`

### "Clerk API key invalid"

- In Clerk dashboard, verify the Publishable & Secret keys match your Vercel environment
- Check that preview/production overrides are set correctly if using them

### "LiveKit connection failed"

- Verify `LIVEKIT_URL` is correct and publicly accessible
- Check that `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` match your LiveKit project
- Ensure the LiveKit workspace is active

### "Cron jobs not running"

- Check Vercel logs for the cron endpoint: **Deployments** > **Logs**
- Verify `CRON_SECRET` is set correctly
- Ensure the cron path matches exactly (e.g., `/api/cron/sweep`)

### Migrations failing on deploy

- Check Vercel Function logs for the error
- If a migration is broken, remove it from `drizzle/migrations/`, fix the schema, generate a new migration, and redeploy
- For emergency rollbacks, consider maintaining manual migration scripts

## Production Checklist

Before deploying to production:

- [ ] **`RACE_TEST_MODE` is off** (unset or `0`)
  - Disables `/api/dev/inject-verdict` and other dev endpoints
  - Verifies production account linking logic

- [ ] **`CF_CRED_KEY` is set and backed up**
  - Stored securely (1Password, LastPass, etc.)
  - If lost, Codeforces credential encryption is compromised; users must re-link

- [ ] **`CRON_SECRET` is set**
  - Used to authorize `/api/cron/*` routes
  - Prevents unauthorized cron execution

- [ ] **Dev routes are inaccessible**
  - `/api/dev/inject-verdict` must 403 when `RACE_TEST_MODE` is off
  - Verify this in staging before production

- [ ] **Secrets are NOT in the repository**
  - No `.env.local` or `.env` files committed
  - `.gitignore` includes `*.local` and `.env*`
  - Check Git history for accidental commits: `git log --all -S 'CF_CRED_KEY'`

- [ ] **Database backups are configured**
  - Neon auto-backup or manual snapshots
  - Test recovery procedure

- [ ] **LiveKit room cleanup is working**
  - Old rooms >24 hours should be deleted by cleanup code
  - Monitor LiveKit dashboard for orphaned rooms

- [ ] **All services are in production tier**
  - Clerk production application
  - Neon production database
  - LiveKit production workspace

- [ ] **Monitoring & alerts are set up**
  - Vercel deployment alerts
  - Database connection monitoring
  - LiveKit API health checks

