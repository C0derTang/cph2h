/**
 * Local dev seed script — inserts a handful of fake users and problems so
 * the app has data to render against a freshly migrated database.
 *
 * Usage: `pnpm exec tsx scripts/seed.ts`
 * Requires `DATABASE_URL` to point at a real (migrated) Postgres instance.
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { db } from "@/lib/db";
import { problems, users } from "@/lib/db/schema";

const SEED_USERS = [
  {
    clerkId: "seed_clerk_1",
    username: "alice",
    cfHandle: "alice_cf",
    cfRating: 1650,
    elo: 1300,
    racesPlayed: 4,
  },
  {
    clerkId: "seed_clerk_2",
    username: "bob",
    cfHandle: "bob_cf",
    cfRating: 1420,
    elo: 1180,
    racesPlayed: 2,
  },
  {
    clerkId: "seed_clerk_3",
    username: "carol",
    cfHandle: null,
    cfRating: null,
    elo: 1200,
    racesPlayed: 0,
  },
];

const SEED_PROBLEMS = [
  {
    id: "1794C",
    contestId: 1794,
    index: "C",
    name: "Scoring Subsequences",
    rating: 1600,
    tags: ["binary search", "data structures", "dp", "greedy"],
    fetchedAt: new Date(),
  },
  {
    id: "4A",
    contestId: 4,
    index: "A",
    name: "Watermelon",
    rating: 800,
    tags: ["brute force", "math"],
    fetchedAt: new Date(),
  },
  {
    id: "1B",
    contestId: 1,
    index: "B",
    name: "Spreadsheets",
    rating: 1600,
    tags: ["implementation", "math"],
    fetchedAt: new Date(),
  },
];

async function main() {
  console.log("Seeding users...");
  await db.insert(users).values(SEED_USERS).onConflictDoNothing();

  console.log("Seeding problems...");
  await db.insert(problems).values(SEED_PROBLEMS).onConflictDoNothing();

  console.log(`Done. Seeded ${SEED_USERS.length} users and ${SEED_PROBLEMS.length} problems.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
