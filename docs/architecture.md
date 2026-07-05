# Architecture Guide

This document describes the core architecture of cph2h: the race lifecycle, verdict polling, matchmaking, and the design principles that guide implementation.

## Design Principles

### 1. Pure Logic + Thin Routes

All business logic is **pure** (no I/O, no side effects):

```
src/lib/
├── race/
│   ├── create.ts        # Pure: construct new race
│   ├── machine.ts       # Pure: state transitions (no DB, no Date.now())
│   ├── finish.ts        # Pure: resolve race outcomes
│   ├── poll.ts          # Pure: CF submission logic + verdict detection
│   └── ...
├── matchmaking.ts       # Pure: pairing logic + ELO calculation
├── cf/                  # Pure: Codeforces submission & parsing
└── livekit.ts           # Pure & side-effect: publish events
```

API routes in `src/app/api/` are thin I/O shells that:
1. Extract parameters from the request
2. Call pure functions with explicit dependencies
3. Apply the result atomically to the database (e.g., `UPDATE ... WHERE id=$1 AND status='pending' RETURNING *`)
4. Return the result as JSON

**Benefit**: All state transitions are exhaustively testable without mocking I/O.

### 2. Events Are Hints; GET Is Truth

Race state is published to clients over LiveKit data channels **as hints only**. The canonical state lives in the database.

```
Client A (P1)
├─ Receives: { type: "verdict", userId: "p2", verdict: "OK" }
├─ Hint: "P2 may have solved the problem"
├─ Action: Refetch GET /api/races/[id] to verify
└─ Render the canonical race snapshot

Client B (P2)
├─ Sends: verdict event
├─ Waits for other client to refetch (or polls itself)
└─ If either client is offline, the cron sweep catches it
```

**Why hints?**: Network reordering, client crashes, and offline periods mean events can arrive stale or out-of-order. A single source of truth avoids conflicting state.

### 3. Shared Contracts in `src/lib/types.ts`

All modules code against the shapes in `types.ts`:

- `RaceStatus`, `RaceOutcome`, `RaceSnapshot`: the canonical race model
- `RaceEvent`: the set of events clients can receive
- `PublicUser`, `ProblemRef`: user & problem identities
- Constants: `COUNTDOWN_SEC`, `DEFAULT_TIME_LIMIT_SEC`, ELO factors, etc.

**Change carefully**: Every wave of work depends on these shapes. Update tests when types change.

## Race Lifecycle

A race progresses through five states:

```
pending ──join──> ready ──both-ready──> active ──verdict/timeout──> finished
                                          │                              ▲
                                          └──────── aborted ─────────────┘
```

### State Descriptions

| State | Meaning | Duration | Notes |
|-------|---------|----------|-------|
| **pending** | Created but opponent has not joined | 24 hours (then auto-abort) | Only p1 is set initially (challenge mode) |
| **ready** | Both players joined; waiting to start | 10-second countdown | Transition to `active` happens when countdown expires |
| **active** | Race in progress; timer counting down | 40 minutes (default) | Problem visible; submissions accepted; LiveKit room active |
| **finished** | Race resolved (someone solved, timed out, or aborted) | Forever | Elo deltas calculated; room closed |
| **aborted** | Manually aborted or auto-aborted | Forever | Both players get 0 Elo delta |

### Transitions

#### `pending` → `ready`

```
POST /api/races/join/
├─ Input: raceId (from challenge token), userId
├─ Guards: race exists, status is pending, p2Id is null, userId ≠ p1Id
├─ Action: Set p2Id = userId, status = "ready"
├─ Output: RaceSnapshot (both players visible, ready state)
└─ Event: "opponent_joined" (LiveKit hint)
```

#### `ready` → `active`

```
Automatic (client-side countdown timer)
├─ Trigger: Client countdown reaches 0 (10 seconds from ready state)
├─ Action: Client requests POST /api/races/[id]/ready
│           Server verifies both p1Ready & p2Ready are true
│           Sets status = "active", startedAt = now(), problem assigned
├─ Output: RaceSnapshot with problem details
└─ Event: "race_start" (LiveKit hint)
```

#### `active` → `finished`

```
Triggered by verdict polling (two paths):

1. Participant Poll (client-driven)
   └─ POST /api/races/[id]/poll (from the in-app UI)

2. Sweep Cron (safety net)
   └─ GET /api/cron/sweep (every minute)

Both call the same pure function: pollActiveRace()
├─ Fetch CF submissions for both players
├─ findRaceVerdicts() searches for OK submissions since startedAt
├─ If OK found: winner is earliest submitter, status = "finished"
├─ If no OK and now > endsAt: draw, status = "finished"
├─ If verdict but not OK: update race_submissions.verdict, publish hint
└─ All finishes go through finishRace(), which is idempotent
   ├─ Calculate Elo deltas (provisional or standard K-factor)
   ├─ Update user.elo and user.racesPlayed
   ├─ Insert eloHistory record
   ├─ Close LiveKit room
   └─ Set outcome, winnerId, eloDeltaP1/P2, finishedAt
```

#### `active` → `aborted`

```
POST /api/races/[id]/abort/
├─ Input: userId (must be p1 or p2)
├─ Action: Set status = "aborted", outcome = "aborted"
├─ Elo: Both players get delta = 0 (no change)
└─ Event: "aborted" (LiveKit hint)
```

## Verdict Polling Design

The race resolution system has two components:

### 1. Client-Driven Poll

```
Racing User (in-app UI)
├─ POST /api/races/[id]/poll (e.g., every 6 seconds)
├─ Route handler:
│   ├─ Lock: SELECT ... FROM races WHERE id = $1 AND status = 'active' FOR UPDATE
│   ├─ Check: now - lastPolledAt > POLL_MIN_INTERVAL_SEC (5 sec cooldown)
│   ├─ Update: Set lastPolledAt = now
│   ├─ Call: pollActiveRace(race) (pure function)
│   │   └─ Fetches CF submissions, finds verdicts, resolves if done
│   └─ Return: RaceSnapshot with updated submissions & verdict info
└─ Client: Show live verdicts as they arrive
```

**Advantage**: Immediate feedback; racing users see verdicts as soon as CF processes them.

**Limitation**: Fails if both users go offline or close their tabs.

### 2. Sweep Safety Net

```
Vercel Cron: GET /api/cron/sweep (every minute)
├─ Query: active races WHERE now > endsAt OR now - lastPolledAt > 60 sec
├─ For each:
│   ├─ Lock: SELECT ... FOR UPDATE (no participant polling during sweep)
│   ├─ Call: pollActiveRace(race) (same pure function as #1)
│   │   └─ Updates submissions, resolves if done
│   └─ Commit: Race is finished or pending next poll
├─ Also cleanup:
│   ├─ Abort pending races > 24 hours old
│   └─ Purge queue_entries > 5 minutes old (stale matchmaking)
└─ Result: Every race is guaranteed to finish, even if clients disappear
```

**Advantage**: Guarantees no race hangs (failsafe).

**Idempotency**: `finishRace()` is idempotent (UPDATE ... WHERE status='active' returns 0 rows if already finished), so concurrent participant & cron polls are safe.

## Matchmaking (Quick-Match)

Quick-match pairing happens in a single atomic SQL statement:

```
POST /api/queue
├─ Input: userId (must have linked Codeforces account)
├─ Call: tryPair(userId, band)
│   └─ SQL:
│       SELECT u2.id FROM queue_entries q
│       WHERE q.elo BETWEEN $band_min AND $band_max
│       AND q.user_id != $userId
│       ORDER BY q.enqueued_at ASC
│       LIMIT 1
│       FOR UPDATE SKIP LOCKED
│       ── Locked: prevents concurrent picks of the same opponent
│       ── SKIP LOCKED: if q2 is being picked by another thread, skip to next
│
├─ If hit (opponent found):
│   ├─ Delete q1 & q2 from queue_entries
│   ├─ Create a `ready` race with p1=userId, p2=opponent
│   └─ Return: raceId
│
└─ If miss (no opponent in band):
│   ├─ Upsert userId into queue_entries with current elo & enqueued_at
│   ├─ Return: queued status
```

### Band Widening

The search band widens by wait time:

```
BAND_BASE = 100  (Elo points)

band_width(wait_sec) = BAND_BASE + wait_sec

Example:
├─ 0 sec wait:   band = [1100, 1300]  (narrow, close opponents only)
├─ 60 sec wait:  band = [1000, 1400]  (wide, more likely match)
└─ 300+ sec wait: band = [800, 1600]  (very wide, almost anyone)
```

### GET /api/queue (Status Check)

```
GET /api/queue
├─ Check: Does the caller still have a queue_entry?
│
├─ If yes (still queued):
│   ├─ Recalculate band based on wait time
│   ├─ Try pairing again (tryPair)
│   │   ├─ If hit: Delete entries, create race, return raceId
│   │   └─ If miss: Update enqueued_at, return waiting status
│   └─ Return: { state: "queued", waitedSec: ..., currentBand: ... }
│
└─ If no (entry gone):
    ├─ Query: Newest ready/active race for this user
    └─ Return: { state: "matched" or "idle", raceId: ... }
```

## Data Model Highlights

### Race State & Submissions

```
races
├─ id, status (pending|ready|active|finished|aborted)
├─ p1Id, p2Id (UUIDs, FK to users)
├─ p1Ready, p2Ready (booleans for countdown)
├─ problemId (FK to problems, set when active)
├─ startedAt, endsAt, finishedAt (ISO timestamps)
├─ outcome (p1_win|p2_win|draw|aborted), winnerId (FK to users)
├─ eloDeltaP1, eloDeltaP2 (final Elo adjustment)
├─ lastPolledAt (timestamp, for sweep staleness check)
├─ livekitRoom (for voice/video)
└─ challengeToken (unique, for challenge-mode invite links)

race_submissions
├─ id (PK), raceId, userId
├─ code (C++ source)
├─ verdict (CF verdict string: "OK", "WRONG_ANSWER", null while pending)
├─ cfSubmissionId (CF submission ID, once known)
└─ submittedAt (ISO timestamp)
```

### Indexes for Performance

```
races
├─ (status) — for "find all active"
├─ (status, endsAt) — for "find overdue races" (sweep query)
└─ (challengeToken) — for "find by invite link"

queue_entries
├─ (elo) — for band-range queries in matchmaking

user_problems
├─ (userId) — for "find solved problems by user"

elo_history
├─ (userId, createdAt) — for leaderboard & historical queries
```

## Example: A Complete Race

```
1. Alice (P1) creates a race, gets challengeToken "abc123def456"
   ├─ Status: pending, p2Id = null
   ├─ Event sent: (none yet, only Alice sees it)

2. Bob (P2) joins via challenge link + token
   ├─ Status: ready, p2Id = Bob's ID
   ├─ Event: "opponent_joined"
   ├─ Countdown: 10 seconds

3. Countdown expires (client-side timer)
   ├─ POST /api/races/[id]/ready called by one or both clients
   ├─ Status: active
   ├─ startedAt = now + 0, endsAt = now + 40 min
   ├─ Problem fetched & assigned
   ├─ LiveKit room created
   ├─ Event: "race_start"

4. Alice submits solution, Bob still working
   ├─ POST /api/submit (Alice's code)
   ├─ Route: Submits to CF, gets cfSubmissionId
   ├─ Verdict polled repeatedly (client + cron)
   ├─ After ~5 seconds: verdict = "OK"
   ├─ Event: "verdict" (LiveKit hint)
   ├─ Client B refetches, sees Alice's verdict

5. pollActiveRace() (from Alice's client poll) resolves the race
   ├─ Finds Alice's OK submission earliest
   ├─ Status: finished, outcome = p1_win, winnerId = Alice
   ├─ Elo: Alice +16, Bob -16 (assuming standard K-factor)
   ├─ Event: "race_finished"
   ├─ LiveKit room closed

6. Both clients see the finished race with Elo deltas
```

## Key Invariants

1. **Only the cron can finish a race past its time limit** (client polls have a 5-sec cooldown to avoid excessive CF requests)

2. **finishRace() is idempotent** — multiple concurrent calls are safe (only one succeeds via `WHERE status='active'`)

3. **LiveKit events are always best-effort hints** — clients always verify state by fetching the snapshot

4. **All mutations are atomic** — Database rows are updated with `WHERE` guards to prevent race conditions (e.g., status check on transitions)

5. **Passwords are encrypted** — Codeforces credentials are stored as AES-256-GCM ciphertext, never plaintext

6. **ELO is computed once per race** — eloHistory is append-only; user.elo is updated atomically with the race finish

## Glossary

| Term | Meaning |
|------|---------|
| **RaceSnapshot** | Complete immutable view of a race at a point in time (sent by GET /api/races/[id]) |
| **Verdict** | CF result string: "OK", "WRONG_ANSWER", "TIME_LIMIT_EXCEEDED", etc. |
| **Challenge Mode** | P1 creates race with P2 = null, generates link, P2 joins via token |
| **Quick-Match** | Both players in queue; system pairs them automatically by Elo band |
| **Band** | ELO range for matchmaking (widens over time to guarantee pairing) |
| **Sweep** | Cron job that force-polls stalled/overdue races and cleans up old entries |
| **Hint** | A LiveKit event; not guaranteed to be consistent with DB state |
| **Idempotent** | Safe to call multiple times; result is the same as calling once |
| **K-Factor** | ELO adjustment multiplier: 64 (provisional), 32 (standard) |
| **Provisional** | First 10 races; higher K-factor (±64) to stabilize rating faster |

