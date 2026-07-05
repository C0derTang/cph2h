"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CfLinkResponse } from "@/lib/types";

interface CfLinkFormProps {
  linkedHandle: string | null;
  linkedRating: number | null;
  linkedAt: string | null;
}

export function CfLinkForm({
  linkedHandle,
  linkedRating,
  linkedAt,
}: CfLinkFormProps) {
  const router = useRouter();
  const [relinking, setRelinking] = useState(false);
  const [handle, setHandle] = useState(linkedHandle ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLinked = Boolean(linkedHandle);
  const showForm = !isLinked || relinking;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/cf/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, password }),
      });
      const data = (await response.json()) as CfLinkResponse;
      if (!response.ok || !data.ok) {
        setError(data.error ?? "Could not link your account. Try again.");
        return;
      }
      setPassword("");
      setRelinking(false);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {isLinked && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2
                className="size-4 text-emerald-500"
                aria-hidden
              />
              Linked to {linkedHandle}
            </CardTitle>
            <CardDescription>
              {linkedRating != null
                ? `Rating ${linkedRating}`
                : "Rating unavailable"}
              {linkedAt
                ? ` · linked ${new Date(linkedAt).toLocaleDateString()}`
                : ""}
            </CardDescription>
          </CardHeader>
          {!relinking && (
            <CardContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRelinking(true);
                  setPassword("");
                  setError(null);
                }}
              >
                Re-link account
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-xl border border-border bg-card/40 p-6"
        >
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cf-handle"
              className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase"
            >
              Codeforces handle or email
            </label>
            <input
              id="cf-handle"
              name="handle"
              type="text"
              autoComplete="username"
              required
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cf-password"
              className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase"
            >
              Codeforces password
            </label>
            <input
              id="cf-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              Your password is stored encrypted (AES-256-GCM) so cph2h can
              submit your solutions to Codeforces during a race. It is never
              shown to anyone and never logged.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting
                ? "Linking…"
                : isLinked
                  ? "Update link"
                  : "Link account"}
            </Button>
            {relinking && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={submitting}
                onClick={() => {
                  setRelinking(false);
                  setPassword("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
