/**
 * Local-only e2e prerequisites: create the two Clerk test users the race
 * smoke test signs in as, and guarantee one in-band problem exists so the
 * picker resolves for two unrated (1200) players. Idempotent. Not committed.
 *
 * Usage: pnpm exec tsx scripts/e2e-setup.ts
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { createClerkClient } from "@clerk/backend";
import { db } from "@/lib/db";
import { problems, problemStatements } from "@/lib/db/schema";

const EMAILS = [
  process.env.E2E_USER_A_EMAIL ?? "racer-a+clerk_test@example.com",
  process.env.E2E_USER_B_EMAIL ?? "racer-b+clerk_test@example.com",
];
const PASSWORD = "cph2h-e2e-Test-424242!";

async function main() {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });

  for (const email of EMAILS) {
    const { data } = await clerk.users.getUserList({ emailAddress: [email] });
    if (data[0]) {
      console.log(`Clerk user exists: ${email} (${data[0].id})`);
      continue;
    }
    const created = await clerk.users.createUser({
      emailAddress: [email],
      password: PASSWORD,
    });
    console.log(`Created Clerk user: ${email} (${created.id})`);
  }

  // A problem squarely in the initial pick window [1100, 1400] for two 1200
  // players, so problem selection succeeds immediately.
  await db
    .insert(problems)
    .values({
      id: "9999A",
      contestId: 9999,
      index: "A",
      name: "E2E Warmup",
      rating: 1300,
      tags: ["implementation"],
      fetchedAt: new Date(),
    })
    .onConflictDoNothing();

  // Pre-seed the statement so the race renders from cache (getOrScrapeStatement
  // checks the DB first) instead of live-scraping a non-existent CF problem.
  await db
    .insert(problemStatements)
    .values({
      problemId: "9999A",
      html: "<div class='problem-statement'><p>Print the sum of two integers.</p></div>",
      samples: [{ input: "2 2\n", output: "4\n" }],
      scrapedAt: new Date(),
    })
    .onConflictDoNothing();
  console.log("Ensured in-band problem 9999A (rating 1300) + cached statement.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("e2e-setup failed:", err);
    process.exit(1);
  });
