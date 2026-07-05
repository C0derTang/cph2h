"use client";

/**
 * Client half of the join page (issue #16). Calls `POST /api/races/join`
 * (issue #7) — the only place a challenge race actually transitions
 * `pending -> ready` — then redirects into the race room on success.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PublicUser, RaceSnapshot } from "@/lib/types";

interface JoinChallengeFormProps {
  token: string;
  challenger: PublicUser;
  timeLimitSec: number;
}

export function JoinChallengeForm({
  token,
  challenger,
  timeLimitSec,
}: JoinChallengeFormProps) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setJoining(true);
    setError(null);
    try {
      const res = await fetch("/api/races/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(joinErrorMessage(data?.error));
        return;
      }
      const snapshot = data as RaceSnapshot;
      router.push(`/race/${snapshot.id}`);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>{challenger.username}</CardTitle>
        <CardDescription>
          Elo {challenger.elo}
          {challenger.cfHandle ? ` · ${challenger.cfHandle}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Badge variant="outline">
          {Math.round(timeLimitSec / 60)} min race
        </Badge>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="button" onClick={handleJoin} disabled={joining}>
          {joining ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Joining…
            </>
          ) : (
            "Join race"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function joinErrorMessage(error?: string): string {
  switch (error) {
    case "self_join":
      return "You can't join your own challenge.";
    case "already_has_opponent":
    case "conflict":
      return "Someone already joined this challenge.";
    case "not_pending":
      return "This challenge is no longer open.";
    case "not_found":
      return "This challenge link is invalid.";
    case "cf_not_linked":
      return "Link your Codeforces account first.";
    default:
      return "Could not join the race. Try again.";
  }
}
