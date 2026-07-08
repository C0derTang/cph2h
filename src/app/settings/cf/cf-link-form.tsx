"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SlabButton } from "@/components/menu/slab-button";
import type { CfLinkResponse, CfVerifyStartResponse } from "@/lib/types";

interface CfLinkFormProps {
  linkedHandle: string | null;
  linkedRating: number | null;
  linkedAt: string | null;
}

/** The `ok: true` branch of {@link CfVerifyStartResponse} — the active challenge. */
type ActiveChallenge = Extract<CfVerifyStartResponse, { ok: true }>;

export function CfLinkForm({
  linkedHandle,
  linkedRating,
  linkedAt,
}: CfLinkFormProps) {
  const router = useRouter();
  const [relinking, setRelinking] = useState(false);
  const [handle, setHandle] = useState(linkedHandle ?? "");
  const [challenge, setChallenge] = useState<ActiveChallenge | null>(null);
  const [starting, setStarting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLinked = Boolean(linkedHandle);
  const showForm = !isLinked || relinking;

  function resetFlow() {
    setChallenge(null);
    setError(null);
  }

  async function handleStart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/cf/verify/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const data = (await response.json()) as CfVerifyStartResponse;
      if (!response.ok || !data.ok) {
        const message =
          (!data.ok && data.error) || "Could not start verification. Try again.";
        setError(message);
        toast.error(message);
        return;
      }
      setChallenge(data);
      toast.success(`Verifying ${data.handle} — submit a compile error to continue.`);
    } catch {
      setError("Network error — please try again.");
      toast.error("Network error — please try again.");
    } finally {
      setStarting(false);
    }
  }

  async function handleCheck() {
    if (!challenge) return;
    setChecking(true);
    setError(null);
    try {
      const response = await fetch("/api/cf/verify/check", { method: "POST" });
      const data = (await response.json()) as CfLinkResponse;
      if (data.ok) {
        setChallenge(null);
        setRelinking(false);
        toast.success(`Linked to ${data.cfHandle ?? challenge.handle}.`);
        router.refresh();
        return;
      }
      if (data.error === "not_found_yet") {
        const message =
          "No compile-error submission found yet. Submit one to the problem above, then check again.";
        setError(message);
        toast.info(message);
        return;
      }
      const message = data.error ?? "Verification failed. Try starting again.";
      setError(message);
      toast.error(message);
    } catch {
      setError("Network error — please try again.");
      toast.error("Network error — please try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {isLinked && (
        <div className="panel p-5">
          {/* Link state is a permission state, not a judge outcome — neutral
              ink, never verdict tokens (docs/design.md codified rule). */}
          <p className="flex items-center gap-2 font-display text-lg tracking-tight uppercase">
            <CheckCircle2 className="size-4 text-muted-foreground" aria-hidden />
            Linked to {linkedHandle}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {linkedRating != null ? (
              <>
                Rating{" "}
                <span className="font-mono tabular-nums">{linkedRating}</span>
              </>
            ) : (
              "Rating unavailable"
            )}
            {linkedAt ? (
              <>
                {" · linked "}
                <span className="font-mono">
                  {new Date(linkedAt).toLocaleDateString()}
                </span>
              </>
            ) : null}
          </p>
          {!relinking && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setRelinking(true);
                resetFlow();
              }}
            >
              Re-link account
            </Button>
          )}
        </div>
      )}

      {showForm && !challenge && (
        <form
          onSubmit={handleStart}
          className="panel bracket-frame flex flex-col gap-4 p-5"
        >
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cf-handle"
              className="eyebrow text-muted-foreground"
            >
              Codeforces handle
            </label>
            <input
              id="cf-handle"
              name="handle"
              type="text"
              autoComplete="username"
              required
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              disabled={starting}
              className="h-9 rounded-[var(--radius)] border border-border bg-background px-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div className="flex items-start gap-2 rounded-[var(--radius)] border border-dashed border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              No password needed. We verify you own this handle by asking you to
              submit a solution that fails to compile — nothing else is stored.
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-destructive"
            >
              <span className="warning-glyph mt-0.5" aria-hidden>
                !
              </span>
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <SlabButton
              type="submit"
              tone="self"
              disabled={starting}
              data-testid="verify-start-btn"
            >
              {starting ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {starting ? "Starting…" : "Start verification"}
            </SlabButton>
            {relinking && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={starting}
                onClick={() => {
                  setRelinking(false);
                  resetFlow();
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}

      {showForm && challenge && (
        <div
          data-testid="cf-verify-instructions"
          className="panel bracket-frame flex flex-col gap-4 p-5"
        >
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-lg tracking-tight uppercase">
              Verify {challenge.handle}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Submit a solution that <strong>fails to compile</strong> (e.g. a
              single line like <code className="font-mono">this is not code</code>
              ) to the problem below on Codeforces, then click Check. Your real
              browser passes Codeforces&rsquo; Cloudflare check.
            </p>
          </div>

          {/* Step markers are hud-meta HUD chrome — aria-hidden, the <ol>
              itself carries the ordering for assistive tech. */}
          <ol className="flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
            <li className="flex items-baseline gap-3">
              <span className="hud-meta shrink-0" aria-hidden>
                01
              </span>
              <span>
                Open{" "}
                <a
                  href={challenge.problemUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-player-self hover:underline"
                >
                  <span className="font-mono">{challenge.problemId}</span> ·{" "}
                  {challenge.problemName}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </span>
            </li>
            <li className="flex items-baseline gap-3">
              <span className="hud-meta shrink-0" aria-hidden>
                02
              </span>
              <span>Submit any source that will not compile.</span>
            </li>
            <li className="flex items-baseline gap-3">
              <span className="hud-meta shrink-0" aria-hidden>
                03
              </span>
              <span>
                Wait for the <strong>Compilation error</strong> verdict, then
                click Check below.
              </span>
            </li>
          </ol>

          <p className="text-xs text-muted-foreground">
            Challenge expires{" "}
            <span className="font-mono tabular-nums">
              {new Date(challenge.expiresAt).toLocaleTimeString()}
            </span>
            .
          </p>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-destructive"
            >
              <span className="warning-glyph mt-0.5" aria-hidden>
                !
              </span>
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <SlabButton
              type="button"
              tone="self"
              onClick={handleCheck}
              disabled={checking}
              data-testid="verify-check-btn"
            >
              {checking ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {checking ? "Checking…" : "Check"}
            </SlabButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={checking}
              onClick={resetFlow}
            >
              Start over
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
