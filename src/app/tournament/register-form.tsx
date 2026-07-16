"use client";

/**
 * Tournament registration form (issue #209). Calls `POST
 * /api/tournament/register` with optional GitHub/LinkedIn profile URLs and
 * `termsAccepted`. Modeled on
 * `src/app/challenge/[token]/join-challenge-form.tsx` for the error-code ->
 * message mapping and CTA pattern.
 *
 * First registration requires ticking the terms checkbox (linking to
 * `/tournament/terms`); editing an existing registration sends
 * `termsAccepted: true` implicitly (no checkbox — the user already agreed).
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SlabButton } from "@/components/menu/slab-button";

const inputClassName =
  "h-9 rounded-[var(--radius)] border border-border bg-background px-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";

interface RegisterFormProps {
  cfHandle: string | null;
  registered: boolean;
  initialGithubUrl: string | null;
  initialLinkedinUrl: string | null;
}

export function RegisterForm({
  cfHandle,
  registered,
  initialGithubUrl,
  initialLinkedinUrl,
}: RegisterFormProps) {
  const router = useRouter();
  const [githubUrl, setGithubUrl] = useState(initialGithubUrl ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(initialLinkedinUrl ?? "");
  const [termsChecked, setTermsChecked] = useState(registered);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await fetch("/api/tournament/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          githubUrl,
          linkedinUrl,
          termsAccepted: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = registerErrorMessage(data?.error);
        setError(message);
        setErrorCode(data?.error ?? null);
        toast.error(message);
        return;
      }
      toast.success(registered ? "Links updated." : "You're registered.");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
      toast.error("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const submitDisabled = submitting || (!registered && !termsChecked);

  return (
    <div className="panel bracket-frame max-w-lg p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg tracking-tight uppercase">
          {registered ? "You're registered" : "Register to compete"}
        </h2>
        {registered && cfHandle && (
          <p className="text-sm text-muted-foreground">
            You&apos;re registered as{" "}
            <span className="font-mono">{cfHandle}</span>.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="github-url" className="eyebrow text-muted-foreground">
            GitHub (optional)
          </label>
          <input
            id="github-url"
            type="text"
            className={inputClassName}
            placeholder="github.com/you"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            disabled={submitting}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="linkedin-url" className="eyebrow text-muted-foreground">
            LinkedIn (optional)
          </label>
          <input
            id="linkedin-url"
            type="text"
            className={inputClassName}
            placeholder="linkedin.com/in/you"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            disabled={submitting}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Links you provide are shared with tournament sponsors only.
        </p>

        {!registered && (
          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0"
              checked={termsChecked}
              onChange={(e) => setTermsChecked(e.target.checked)}
              disabled={submitting}
              required
            />
            <span>
              I agree to the{" "}
              <Link
                href="/tournament/terms"
                className="text-player-self hover:underline"
              >
                tournament terms
              </Link>
              .
            </span>
          </label>
        )}

        {error && (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            {errorCode === "cf_not_linked" && (
              <Button
                render={<Link href="/settings/cf" />}
                nativeButton={false}
                variant="outline"
                size="sm"
                className="self-start"
              >
                Link Codeforces account
              </Button>
            )}
            {errorCode === "unauthorized" && (
              <Button
                render={<Link href="/sign-in" />}
                nativeButton={false}
                variant="outline"
                size="sm"
                className="self-start"
              >
                Sign in
              </Button>
            )}
          </div>
        )}

        <SlabButton
          type="button"
          tone="self"
          className="w-fit"
          onClick={handleSubmit}
          disabled={submitDisabled}
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {registered ? "Updating…" : "Registering…"}
            </>
          ) : registered ? (
            "Update links"
          ) : (
            "Register"
          )}
        </SlabButton>
      </div>
    </div>
  );
}

function registerErrorMessage(error?: string): string {
  switch (error) {
    case "unauthorized":
      return "Please sign in to register.";
    case "cf_not_linked":
      return "Link your Codeforces account first.";
    case "terms_not_accepted":
      return "You must agree to the tournament terms.";
    case "invalid_github_url":
      return "That doesn't look like a valid GitHub profile URL.";
    case "invalid_linkedin_url":
      return "That doesn't look like a valid LinkedIn profile URL.";
    case "not_enough_rated_contests":
      return "You need at least 3 rated Codeforces contests to enter.";
    case "cf_unavailable":
      return "Couldn't reach Codeforces to verify eligibility — try again in a minute.";
    case "invalid_body":
      return "Could not read that request. Try again.";
    default:
      return "Could not save your registration. Try again.";
  }
}
