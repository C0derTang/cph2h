import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, UserPlus } from "lucide-react";
import { eq } from "drizzle-orm";
import { currentUser } from "@clerk/nextjs/server";
import { SlabButton } from "@/components/menu/slab-button";
import { db } from "@/lib/db";
import { tournamentRegistrations } from "@/lib/db/schema";
import { ensureUser } from "@/lib/user";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "register — cph2h tournament",
  description: "Register for the CPH2H Launch Tournament.",
};

type ViewState = "signed_out" | "cf_not_linked" | "form";

export default async function TournamentRegisterPage() {
  // Provisions the `users` row on first authenticated access (issue #48).
  const user = await ensureUser();

  let viewState: ViewState;
  let registration: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    location: string | null;
    githubUrl: string | null;
    linkedinUrl: string | null;
  } | null = null;
  let registered = false;

  if (!user) {
    viewState = "signed_out";
  } else if (!user.cfLinkedAt) {
    viewState = "cf_not_linked";
  } else {
    viewState = "form";
    const [row] = await db
      .select()
      .from(tournamentRegistrations)
      .where(eq(tournamentRegistrations.userId, user.id))
      .limit(1);
    registration = row ?? null;
    registered = Boolean(row);
  }

  // Clerk prefill (issue #239): existing registration value wins; Clerk
  // fills in the rest for a first-time registrant; empty string is the
  // final fallback. Only needed when the form is actually shown.
  let clerkFirstName = "";
  let clerkLastName = "";
  let clerkEmail = "";
  if (viewState === "form") {
    const clerkUserData = await currentUser();
    clerkFirstName = clerkUserData?.firstName ?? "";
    clerkLastName = clerkUserData?.lastName ?? "";
    clerkEmail = clerkUserData?.emailAddresses[0]?.emailAddress ?? "";
  }

  return (
    <main className="shell-narrow flex-1 py-16 md:py-24">
      <Link
        href="/tournament"
        className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to tournament
      </Link>

      <p className="mt-8 eyebrow text-muted-foreground">Register</p>
      <h1 className="mt-2 font-display text-3xl tracking-tight uppercase md:text-4xl">
        Sign up for the bracket
      </h1>

      <div className="mt-8">
        {viewState === "signed_out" && (
          <div className="flex flex-col gap-4">
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              Create a CPH2H account to register for the launch tournament.
            </p>
            <SlabButton
              tone="self"
              className="w-fit"
              render={<Link href="/sign-up" />}
              nativeButton={false}
            >
              <UserPlus className="size-5" aria-hidden />
              Sign up to compete
            </SlabButton>
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/sign-in" className="text-player-self hover:underline">
                Sign in
              </Link>
              .
            </p>
          </div>
        )}

        {viewState === "cf_not_linked" && (
          <div className="flex flex-col gap-4">
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              You&apos;ll need to link a Codeforces account before you can
              register.
            </p>
            <SlabButton
              tone="self"
              className="w-fit"
              render={<Link href="/settings/cf" />}
              nativeButton={false}
            >
              Link Codeforces account
            </SlabButton>
          </div>
        )}

        {viewState === "form" && (
          <>
            {!registered && (
              <p className="mb-4 max-w-xl text-sm leading-6 text-muted-foreground">
                Entry requires a peak rating of 1900+ (Candidate Master) on
                your linked handle. We check when you register.
              </p>
            )}
            <RegisterForm
              cfHandle={user?.cfHandle ?? null}
              registered={registered}
              initialFirstName={registration?.firstName ?? clerkFirstName}
              initialLastName={registration?.lastName ?? clerkLastName}
              initialEmail={registration?.email ?? clerkEmail}
              initialLocation={registration?.location ?? ""}
              initialGithubUrl={registration?.githubUrl ?? null}
              initialLinkedinUrl={registration?.linkedinUrl ?? null}
            />
          </>
        )}
      </div>
    </main>
  );
}
