"use client";

/**
 * Client half of the create-challenge page (issue #16). Calls `POST
 * /api/races` (issue #7) — the only place a challenge race is actually
 * created — then shows the returned `joinUrl` with a copy button and a link
 * into the race room, where the new `Lobby` component takes over.
 */

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Loader2, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DEFAULT_TIME_LIMIT_SEC, type CreateRaceResponse } from "@/lib/types";

const TIME_LIMIT_OPTIONS = [
  { label: "20 min", seconds: 1200 },
  { label: "40 min", seconds: 2400 },
  { label: "60 min", seconds: 3600 },
  { label: "90 min", seconds: 5400 },
];

export function NewChallengeForm() {
  const [timeLimitSec, setTimeLimitSec] = useState(DEFAULT_TIME_LIMIT_SEC);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateRaceResponse | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/races", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeLimitSec }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(createErrorMessage(data?.error));
        return;
      }
      setResult(data as CreateRaceResponse);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable — fail silently.
    }
  }

  if (result) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Swords className="size-4 text-primary" aria-hidden />
            Challenge created
          </CardTitle>
          <CardDescription>
            Share this link with your opponent — it works until someone joins.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
            <code className="flex-1 truncate font-mono text-xs">
              {result.joinUrl}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={copyLink}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button render={<Link href={`/race/${result.raceId}`} />} nativeButton={false}>
            Go to race room
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Create a challenge</CardTitle>
        <CardDescription>
          Pick a time limit, then share the link with a friend.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Time limit
          </span>
          <div className="flex flex-wrap gap-2">
            {TIME_LIMIT_OPTIONS.map((opt) => (
              <Button
                key={opt.seconds}
                type="button"
                size="sm"
                variant={timeLimitSec === opt.seconds ? "default" : "outline"}
                aria-pressed={timeLimitSec === opt.seconds}
                onClick={() => setTimeLimitSec(opt.seconds)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="button" onClick={handleCreate} disabled={creating}>
          {creating ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Creating…
            </>
          ) : (
            "Create challenge"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function createErrorMessage(error?: string): string {
  if (error === "cf_not_linked") return "Link your Codeforces account first.";
  if (error === "unauthorized") return "Please sign in to create a challenge.";
  return "Could not create the challenge. Try again.";
}
